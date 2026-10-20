import fs from 'node:fs/promises'
import path from 'node:path'
import type { AgentLaunchOptions, AgentModelOption, ConfiguredDefault } from '../../shared/agents'
import type { Env } from '../env/env'

const FIVE_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']
const FOUR_LEVELS = ['low', 'medium', 'high', 'max']

/** The model each built-in alias names when the configuration does not replace it. */
const ALIAS_MODELS: Readonly<Record<string, string>> = {
  fable: 'claude-fable-5-1',
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-5-5',
}

const FAMILIES = ['fable', 'opus', 'sonnet', 'haiku'] as const

type JsonObject = Record<string, unknown>

function objectOf(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null
}

function stringOf(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function stringArrayOf(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  return value.filter((entry): entry is string => typeof entry === 'string')
}

async function readJson(file: string): Promise<JsonObject | null> {
  try {
    const text = await fs.readFile(file, 'utf8')
    return objectOf(JSON.parse(text))
  } catch {
    return null
  }
}

/** Where Claude Code keeps its user settings. */
export function claudeSettingsPath(home: string): string {
  return path.join(home, '.claude', 'settings.json')
}

/** Where Claude Code keeps its managed settings, which take precedence over the user's. */
export function claudeManagedSettingsPath(platform: NodeJS.Platform = process.platform): string {
  switch (platform) {
    case 'darwin':
      return '/Library/Application Support/ClaudeCode/managed-settings.json'
    case 'win32':
      return path.join(
        process.env.ProgramData ?? 'C:\\ProgramData',
        'ClaudeCode',
        'managed-settings.json',
      )
    default:
      return '/etc/claude-code/managed-settings.json'
  }
}

/** The model ID of an alias or of a model as it is written. */
function normalizedModelId(model: string): string {
  return model
    .trim()
    .toLowerCase()
    .replace(/^anthropic\//, '')
    .replace(/\[[^\]]*\]$/, '')
    .replaceAll('_', '-')
    .replaceAll('.', '-')
}

const ALIASES: Readonly<Record<string, string>> = {
  fable: 'claude-fable-5-1',
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-5-5',
}

/** The effort levels of a model Claude Code knows, and none for any other. */
function effortsOfKnownModel(model: string): string[] {
  const configured = ALIASES[model] ?? ALIASES[normalizedModelId(model)] ?? model
  const id = normalizedModelId(configured)
  if (/fable-5-1(?:-|$)|fable-5(?:-|$)/.test(id)) return [...FIVE_LEVELS]
  if (
    /opus-5-5(?:-|$)|sonnet-5-5(?:-|$)|haiku-5-5(?:-|$)/.test(id) ||
    /opus-5(?:-|$)|sonnet-5(?:-|$)/.test(id) ||
    /opus-4-8(?:-|$)|opus-4-7(?:-|$)/.test(id)
  ) {
    return [...FIVE_LEVELS]
  }
  if (/opus-4-6(?:-|$)|sonnet-4-6(?:-|$)/.test(id)) return [...FOUR_LEVELS]
  return []
}

/** The effort levels a `_SUPPORTED_CAPABILITIES` value declares. */
function effortsOfCapabilities(capabilities: string | null): string[] {
  if (capabilities === null) return []
  const names = new Set(
    capabilities
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean),
  )
  if (!names.has('effort')) return []
  const efforts = ['low', 'medium', 'high']
  if (names.has('xhigh_effort')) efforts.push('xhigh')
  if (names.has('max_effort')) efforts.push('max')
  return efforts
}

/** The variable that declares the capabilities of a model, such as a family's. */
function capabilitiesVariable(prefix: string): string {
  return `${prefix}_SUPPORTED_CAPABILITIES`
}

/**
 * The levels of a model that a settings variable names: those of a model
 * Claude Code knows, or those its declared capabilities give.
 */
function effortsOfSpecifiedModel(model: string, capabilities: string | null): string[] {
  const known = effortsOfKnownModel(model)
  return known.length > 0 ? known : effortsOfCapabilities(capabilities)
}

function aliasModel(family: string, env: Env): string {
  return env[`ANTHROPIC_DEFAULT_${family.toUpperCase()}_MODEL`] ?? ALIAS_MODELS[family] ?? family
}

/** The option of a built-in alias: its argument, what it shows, and its effort levels. */
function aliasOption(family: string, env: Env): AgentModelOption {
  const prefix = `ANTHROPIC_DEFAULT_${family.toUpperCase()}_MODEL`
  const configured = stringOf(env[prefix])
  const model = configured ?? aliasModel(family, env)
  const label = configured ? (stringOf(env[`${prefix}_NAME`]) ?? configured) : family
  const known = effortsOfKnownModel(model)
  const efforts =
    configured === null || known.length > 0
      ? known
      : effortsOfCapabilities(stringOf(env[capabilitiesVariable(prefix)]))
  return { value: family, label, efforts }
}

/** What a modelPicker row is called, and which arguments it adds. */
interface PickerRow {
  model: string
  label: string
  behavesAs: string | null
}

function pickerRows(settings: JsonObject | null): PickerRow[] {
  const picker = objectOf(settings?.modelPicker)
  const options = Array.isArray(picker?.options) ? picker.options : []
  return options.flatMap((entry) => {
    const row = objectOf(entry)
    const model = stringOf(row?.model)
    if (row === null || model === null) return []
    return [
      {
        model,
        label: stringOf(row.label) ?? model,
        behavesAs: stringOf(row.behavesAs),
      },
    ]
  })
}

/** Whether a list of model names allows an option, by its argument or its model. */
function allowedBy(
  names: readonly string[] | null,
  option: AgentModelOption,
  model: string,
): boolean {
  if (names === null) return true
  const id = normalizedModelId(model)
  return names.some((name) => {
    const candidate = normalizedModelId(name)
    return (
      candidate === option.value.toLowerCase() ||
      normalizedModelId(option.label) === candidate ||
      id === candidate
    )
  })
}

/**
 * The models Claude Code's `/model` picker offers under this configuration,
 * and the effort levels of Default: the four aliases, a custom model option,
 * the `modelPicker` rows, filtered by `availableModels` and the managed
 * settings' `deniedModels`. Only this configuration's settings are read, not
 * the cache Claude Code keeps of gateway models.
 */
/** A setting as the managed settings, or else the user's, set it, and which of them does. */
function configuredSetting(
  managed: JsonObject | null,
  user: JsonObject | null,
  key: string,
): ConfiguredDefault | null {
  const fromManaged = stringOf(managed?.[key])
  if (fromManaged !== null) return { value: fromManaged, source: 'managed settings' }
  const fromUser = stringOf(user?.[key])
  return fromUser === null ? null : { value: fromUser, source: 'settings.json' }
}

export async function readClaudeLaunchOptions(options: {
  home: string
  env: Env
  platform?: NodeJS.Platform
  /** Where the user's settings are, replaceable for tests. */
  userSettingsPath?: string
  /** Where the managed settings are, replaceable for tests. */
  managedSettingsPath?: string
}): Promise<AgentLaunchOptions> {
  const platform = options.platform ?? process.platform
  const [user, managed] = await Promise.all([
    readJson(options.userSettingsPath ?? claudeSettingsPath(options.home)),
    readJson(options.managedSettingsPath ?? claudeManagedSettingsPath(platform)),
  ])
  const env: Env = { ...options.env }
  for (const settings of [user, managed]) {
    for (const [name, value] of Object.entries(objectOf(settings?.env) ?? {})) {
      if (typeof value === 'string') env[name] = value
    }
  }

  const managedPicker = objectOf(managed?.modelPicker)
  const picker = managedPicker === null ? user?.modelPicker : managed?.modelPicker
  const pickerObject = objectOf(picker)
  const replaceBuiltInOptions = pickerObject?.replaceBuiltInOptions === true
  const rows = pickerRows(managedPicker === null ? user : managed).map((row) => ({
    ...row,
    efforts:
      row.behavesAs !== null ? effortsOfKnownModel(row.behavesAs) : effortsOfKnownModel(row.model),
  }))

  const builtIn: AgentModelOption[] = []
  const aliasOptions = FAMILIES.map((family) => aliasOption(family, env))
  const customModel = stringOf(env.ANTHROPIC_CUSTOM_MODEL_OPTION)
  const customOption: AgentModelOption | null =
    customModel === null
      ? null
      : {
          value: customModel,
          label: stringOf(env.ANTHROPIC_CUSTOM_MODEL_OPTION_NAME) ?? customModel,
          efforts: effortsOfSpecifiedModel(
            customModel,
            stringOf(env[capabilitiesVariable('ANTHROPIC_CUSTOM_MODEL_OPTION')]),
          ),
        }
  if (!replaceBuiltInOptions) {
    builtIn.push(...aliasOptions)
    if (customOption !== null) builtIn.push(customOption)
  }

  const pickerOptions: AgentModelOption[] = []
  for (const row of rows) {
    if (pickerOptions.some((option) => option.value === row.model)) continue
    if (!replaceBuiltInOptions) {
      const covered = builtIn.some(
        (option) =>
          option.value === row.model ||
          normalizedModelId(aliasModel(option.value, env)) === normalizedModelId(row.model),
      )
      if (covered) continue
    }
    pickerOptions.push({ value: row.model, label: row.label, efforts: row.efforts })
  }

  const available = stringArrayOf(managed?.availableModels) ?? stringArrayOf(user?.availableModels)
  const denied = stringArrayOf(managed?.deniedModels)
  const models = [...builtIn, ...pickerOptions].filter(
    (option) =>
      allowedBy(available, option, aliasModel(option.value, env)) &&
      !(denied !== null && allowedBy(denied, option, aliasModel(option.value, env))),
  )

  const configuredDefault =
    stringOf(managed?.model) ??
    stringOf(user?.model) ??
    stringOf(env.ANTHROPIC_DEFAULT_MODEL) ??
    'opus'
  const defaultOptions = [
    ...aliasOptions,
    ...(customOption === null ? [] : [customOption]),
    ...pickerOptions,
  ]
  const defaultOption = defaultOptions.find(
    (option) =>
      normalizedModelId(option.value) === normalizedModelId(configuredDefault) ||
      (FAMILIES.some((family) => family === option.value) &&
        normalizedModelId(aliasModel(option.value, env)) === normalizedModelId(configuredDefault)),
  )
  const defaultEfforts =
    defaultOption?.efforts ??
    (/^(fable|opus|sonnet|haiku)$/.test(configuredDefault)
      ? aliasOption(configuredDefault, env).efforts
      : effortsOfKnownModel(configuredDefault))

  return {
    models,
    defaultEfforts,
    defaultModel: configuredSetting(managed, user, 'model'),
    defaultEffort: configuredSetting(managed, user, 'effortLevel'),
  }
}

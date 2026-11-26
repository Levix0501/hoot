import fs from 'node:fs/promises'
import path from 'node:path'
import { parse } from 'smol-toml'
import type { AgentLaunchOptions, AgentModelOption, ConfiguredDefault } from '../../shared/agents'
import type { Env } from '../env/env'
import { commandProgram } from '../tools/command-program'
import { runCommand, type CommandResult } from './processes'

/** How long Codex may take to print its model catalog. */
const MODELS_TIMEOUT_MS = 30_000

interface CodexModel {
  slug: string
  visibility: string
  levels: string[]
  priority: number
}

interface CodexCatalog {
  models: CodexModel[]
}

interface CodexConfig {
  model: string | null
  reasoningEffort: string | null
  hasCatalog: boolean
}

type JsonObject = Record<string, unknown>

function objectOf(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null
}

function stringOf(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/** Where Codex keeps its configuration. */
export function codexConfigPath(env: Env, home: string): string {
  const codexHome = stringOf(env.CODEX_HOME)
  return path.join(
    codexHome === null ? path.join(home, '.codex') : path.resolve(home, codexHome),
    'config.toml',
  )
}

/** The parts of Codex's configuration that decide its model choices. */
export async function readCodexConfig(env: Env, home: string): Promise<CodexConfig> {
  const file = codexConfigPath(env, home)
  try {
    const parsed = objectOf(parse(await fs.readFile(file, 'utf8')))
    return {
      model: stringOf(parsed?.model),
      reasoningEffort: stringOf(parsed?.model_reasoning_effort),
      hasCatalog: stringOf(parsed?.model_catalog_json) !== null,
    }
  } catch {
    return { model: null, reasoningEffort: null, hasCatalog: false }
  }
}

/** A value config.toml sets, as a default the Agents page names. */
function fromConfig(value: string | null): ConfiguredDefault | null {
  return value === null ? null : { value, source: 'config.toml' }
}

/**
 * The catalog `codex debug models` prints, its models by their priority, the
 * order Codex's `/model` lists them in, or `null` when it cannot be read.
 */
function catalogOf(output: string): CodexCatalog | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(output)
  } catch {
    return null
  }
  const models = objectOf(parsed)?.models
  if (!Array.isArray(models)) return null
  const catalog: CodexModel[] = []
  for (const entry of models) {
    const model = objectOf(entry)
    const slug = stringOf(model?.slug)
    const visibility = stringOf(model?.visibility)
    if (model === null || slug === null || visibility === null) continue
    const levels = Array.isArray(model.supported_reasoning_levels)
      ? model.supported_reasoning_levels.flatMap((level) => {
          const effort = stringOf(objectOf(level)?.effort)
          return effort === null ? [] : [effort]
        })
      : []
    const priority = typeof model.priority === 'number' ? model.priority : Number.MAX_SAFE_INTEGER
    catalog.push({ slug, visibility, levels, priority })
  }
  return { models: catalog.toSorted((a, b) => a.priority - b.priority) }
}

/**
 * The models a session of Hoot's on Codex's own sign-in offers with `/model`,
 * those Codex lists with visibility `list`, and the effort levels of the one
 * it starts with while its agent names none: as `codex debug models` prints
 * them on OpenAI's provider, which such a session runs on whatever the
 * user's configuration names (see `codexProviderLaunch`); where the
 * configuration names a catalog of its own, as a tool that runs Codex on
 * other providers does, Codex's own, which such a session takes in its
 * place, starting with Codex's own first model rather than the
 * configuration's (see `resolveLaunch`).
 */
export async function readCodexLaunchOptions(options: {
  command: string
  env: Env
  home: string
  platform?: NodeJS.Platform
  run?: (
    spec: {
      file: string
      args: string[]
      env: Env
      cwd: string
    },
    timeoutMs: number,
  ) => Promise<CommandResult>
}): Promise<AgentLaunchOptions> {
  const platform = options.platform ?? process.platform
  const [config, program] = await Promise.all([
    readCodexConfig(options.env, options.home),
    commandProgram(options.command, options.env, platform),
  ])
  const defaults = {
    defaultModel: config.hasCatalog ? null : fromConfig(config.model),
    defaultEffort: fromConfig(config.reasoningEffort),
  }

  const run = options.run ?? runCommand
  const result = await run(
    {
      file: program.file,
      args: [
        ...program.args,
        'debug',
        'models',
        ...(config.hasCatalog ? ['--bundled'] : ['-c', 'model_provider="openai"']),
      ],
      env: options.env,
      cwd: options.home,
    },
    MODELS_TIMEOUT_MS,
  ).catch(() => null)
  const catalog = result === null || result.code !== 0 ? null : catalogOf(result.stdout)
  if (catalog === null) return { models: [], defaultEfforts: [], ...defaults }

  const listed = catalog.models.filter((model) => model.visibility === 'list')
  const models: AgentModelOption[] = listed.map((model) => ({
    value: model.slug,
    label: model.slug,
    efforts: [...model.levels],
  }))
  const configured = defaults.defaultModel?.value
  const starts =
    configured === undefined ? listed[0] : catalog.models.find((model) => model.slug === configured)
  return {
    models,
    defaultEfforts: starts === undefined ? [] : [...starts.levels],
    ...defaults,
  }
}

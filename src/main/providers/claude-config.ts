import fs from 'node:fs/promises'
import path from 'node:path'
import { ownProvider, providerUrl, type GlobalConfig, type Provider } from '../../shared/providers'
import { runCommand } from '../agents/processes'
import { envVariable, type Env } from '../env/env'
import { commandProgram } from '../tools/command-program'

type JsonObject = Record<string, unknown>

/** Anthropic's own API, which a key without an address goes to. */
export const ANTHROPIC_API_URL = 'https://api.anthropic.com'

/** How long `claude auth status` may take. */
const AUTH_STATUS_TIMEOUT_MS = 20_000

/**
 * The model tiers Claude Code maps its aliases through, which a session on a
 * provider of the user's points at that provider's model. Fable's is left
 * empty, as magpie found models other than Fable to do badly in its tier.
 */
const MAPPED_TIERS = ['OPUS', 'SONNET', 'HAIKU'] as const

/**
 * The variables of Claude Code's environment that say which provider it runs
 * on and with which models: those that a provider sets or a switch clears.
 */
const PROVIDER_VARIABLES = new Set([
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_GATEWAY',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  'CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD',
  'CLAUDE_CODE_SUBAGENT_MODEL',
])

/**
 * Whether a variable of Claude Code's environment says which provider it runs
 * on or with which models: every `ANTHROPIC_` one, and those that pick
 * another cloud or a subagent's model. Those of the sign-in, such as
 * `CLAUDE_CODE_OAUTH_TOKEN`, are not: they are the subscription's own.
 */
export function isClaudeProviderVariable(name: string): boolean {
  return name.startsWith('ANTHROPIC_') || PROVIDER_VARIABLES.has(name)
}

/** The variables every session on a provider sets, empty where the provider gives none. */
const SESSION_VARIABLES = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
  ...MAPPED_TIERS.map((tier) => `ANTHROPIC_DEFAULT_${tier}_MODEL`),
  'CLAUDE_CODE_SUBAGENT_MODEL',
]

function objectOf(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** The folder Claude Code keeps its settings in: `CLAUDE_CONFIG_DIR` when set, else `~/.claude`. */
export function claudeConfigDirectory(home: string, env: Env): string {
  const configured = envVariable(env, 'CLAUDE_CONFIG_DIR')?.trim()
  return configured ? configured : path.join(home, '.claude')
}

/** The user's own settings of Claude Code, which it and Hoot's sessions of it start with. */
export function claudeSettingsFile(home: string, env: Env): string {
  return path.join(claudeConfigDirectory(home, env), 'settings.json')
}

/** The settings in a file: `null` when there is none, and an error when it is no JSON object. */
async function readSettings(file: string): Promise<JsonObject | null> {
  let text: string
  try {
    text = await fs.readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  if (text.trim() === '') return {}
  const settings = objectOf(JSON.parse(text))
  if (settings === null) throw new Error(`${file} does not hold a JSON object.`)
  return settings
}

/**
 * What Claude Code's own configuration says of its provider: the address,
 * the key and the model in the `env` of the user's settings, or else in the
 * login shell's environment, which those settings take precedence over. A
 * key without an address goes to Anthropic's own API; neither means Claude
 * Code's own sign-in, its subscription. A settings file that cannot be read
 * counts as none.
 */
export async function readClaudeGlobal(home: string, env: Env): Promise<GlobalConfig> {
  const settings = await readSettings(claudeSettingsFile(home, env)).catch(() => null)
  const settingsEnv = objectOf(settings?.env) ?? {}
  const value = (name: string): string => {
    if (Object.hasOwn(settingsEnv, name)) {
      const set = settingsEnv[name]
      return typeof set === 'string' ? set.trim() : ''
    }
    return envVariable(env, name)?.trim() ?? ''
  }
  const url = value('ANTHROPIC_BASE_URL')
  const token = value('ANTHROPIC_AUTH_TOKEN')
  const apiKey = value('ANTHROPIC_API_KEY')
  const key = token !== '' ? token : apiKey
  return {
    url: url === '' && key !== '' ? ANTHROPIC_API_URL : url,
    apiKey: key,
    keyHeader: token === '' && apiKey !== '' ? 'x-api-key' : 'bearer',
    model: textOf(value('ANTHROPIC_MODEL')) ?? textOf(settings?.model),
  }
}

/** The model a session on a provider maps Claude Code's tiers to: its own, else the provider's first. */
function mappedModel(provider: Provider, model: string | null): string | null {
  return model ?? provider.models[0] ?? null
}

/**
 * Writes a provider and a model into Claude Code's own configuration, as the
 * global that Claude Code runs on outside Hoot: in the `env` of the user's
 * settings, after taking out every variable of the provider before (see
 * `isClaudeProviderVariable`), the address, the key and the models; for its
 * own sign-in, none. The model `/model` saved is taken out too: it belongs to
 * the provider of its time. The model goes in the `env` for a provider of the
 * user's, as other switchers write it, and as `/model` writes it for the
 * subscription. The rest of the settings stay as they are. The file is read
 * again just before, and replaced at once, keeping who may read it; a file
 * that is no JSON object is left alone, with an error.
 */
export async function writeClaudeGlobal(
  home: string,
  env: Env,
  provider: Provider,
  model: string | null,
): Promise<void> {
  const file = claudeSettingsFile(home, env)
  const settings = (await readSettings(file)) ?? {}
  const next: JsonObject = { ...settings }
  const nextEnv: JsonObject = { ...objectOf(settings.env) }
  for (const name of Object.keys(nextEnv)) {
    if (isClaudeProviderVariable(name)) delete nextEnv[name]
  }
  delete next.model
  if (provider.own === null) {
    nextEnv.ANTHROPIC_BASE_URL = providerUrl(provider, 'claude')
    nextEnv[provider.keyHeader === 'x-api-key' ? 'ANTHROPIC_API_KEY' : 'ANTHROPIC_AUTH_TOKEN'] =
      provider.apiKey
    if (model !== null) nextEnv.ANTHROPIC_MODEL = model
    const mapped = mappedModel(provider, model)
    if (mapped !== null) {
      for (const tier of MAPPED_TIERS) nextEnv[`ANTHROPIC_DEFAULT_${tier}_MODEL`] = mapped
    }
  } else if (model !== null) {
    next.model = model
  }
  if (Object.keys(nextEnv).length > 0) next.env = nextEnv
  else delete next.env
  await writeFileReplacing(file, `${JSON.stringify(next, null, 2)}\n`)
}

/**
 * Replaces a file with text at once, by writing it beside the file and moving
 * it over the file, with the file's permissions, or for a new file, readable
 * by its owner alone, as it holds a key.
 */
async function writeFileReplacing(file: string, text: string): Promise<void> {
  const mode = await fs
    .stat(file)
    .then((stats) => stats.mode & 0o777)
    .catch(() => 0o600)
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.hoot-${process.pid}-${Date.now()}`
  try {
    await fs.writeFile(temporary, text, { mode })
    await fs.chmod(temporary, mode)
    await fs.rename(temporary, file)
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

/**
 * The environment of a Claude Code session on a provider, which Hoot gives it
 * in its `--settings`, where it takes precedence over the user's settings and
 * the login shell's environment: every provider variable those set (see
 * `isClaudeProviderVariable`) and every one a session sets is set, empty to
 * unset it where the provider gives none. A provider of the user's gives its
 * address, its key, in the header it takes, and its model, or else its first,
 * for Claude Code's tiers, and turns off the line Claude Code adds to the
 * system prompt for Anthropic's billing, which changes with each version and
 * keeps other providers from caching the prompt. The harness's own sign-in
 * gives none, so that the session runs on the subscription.
 */
export function claudeSessionEnv(
  provider: Provider,
  model: string | null,
  /** The variables the user's settings and the login shell's environment set. */
  userVariables: readonly string[],
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const name of [...userVariables, ...SESSION_VARIABLES]) {
    if (isClaudeProviderVariable(name)) env[name] = ''
  }
  if (provider.own !== null) return env
  env.ANTHROPIC_BASE_URL = providerUrl(provider, 'claude')
  env[provider.keyHeader === 'x-api-key' ? 'ANTHROPIC_API_KEY' : 'ANTHROPIC_AUTH_TOKEN'] =
    provider.apiKey
  const mapped = mappedModel(provider, model)
  if (mapped !== null) {
    for (const tier of MAPPED_TIERS) env[`ANTHROPIC_DEFAULT_${tier}_MODEL`] = mapped
  }
  env.CLAUDE_CODE_ATTRIBUTION_HEADER = '0'
  return env
}

/**
 * The variables of Claude Code's environment that the user's settings and
 * the login shell's environment set: those a session on a provider unsets
 * when its provider gives none of its own.
 */
export async function claudeUserVariables(home: string, env: Env): Promise<string[]> {
  const settings = await readSettings(claudeSettingsFile(home, env)).catch(() => null)
  const names = new Set([...Object.keys(objectOf(settings?.env) ?? {}), ...Object.keys(env)])
  return [...names].filter(isClaudeProviderVariable)
}

/**
 * Whether Claude Code is signed in to its subscription: `claude auth status`,
 * run with every provider variable empty, so that the sign-in alone counts,
 * says it is logged in. `false` when it cannot tell.
 */
export async function claudeSignedIn(command: string, env: Env, cwd: string): Promise<boolean> {
  try {
    const program = await commandProgram(command, env)
    const blank = JSON.stringify({ env: claudeSessionEnv(ownProvider('claude'), null, []) })
    const result = await runCommand(
      {
        file: program.file,
        args: [...program.args, '--settings', blank, 'auth', 'status', '--json'],
        env,
        cwd,
      },
      AUTH_STATUS_TIMEOUT_MS,
    )
    const status = objectOf(JSON.parse(result.stdout))
    return status?.loggedIn === true
  } catch {
    return false
  }
}

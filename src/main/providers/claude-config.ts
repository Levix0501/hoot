import fs from 'node:fs/promises'
import path from 'node:path'
import { providerUrl, type Provider } from '../../shared/providers'
import { envVariable, type Env } from '../env/env'

type JsonObject = Record<string, unknown>

/**
 * The model tiers Claude Code maps its aliases through, which a session on a
 * provider of the user's points at that provider's model. Fable's is left
 * empty, as magpie found models other than Fable to do badly in its tier.
 */
const MAPPED_TIERS = ['OPUS', 'SONNET', 'HAIKU'] as const

/**
 * The variables of Claude Code's environment that say which provider it runs
 * on and with which models, besides the `ANTHROPIC_` ones: those that a
 * provider sets, and that a session on another unsets.
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

/** The folder Claude Code keeps its settings in: `CLAUDE_CONFIG_DIR` when set, else `~/.claude`. */
export function claudeConfigDirectory(home: string, env: Env): string {
  const configured = envVariable(env, 'CLAUDE_CONFIG_DIR')?.trim()
  return configured ? configured : path.join(home, '.claude')
}

/**
 * The user's own settings of Claude Code, which it and Hoot's sessions of it
 * start with, and of which Hoot reads only the names of the variables.
 */
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

/** The model a session on a provider maps Claude Code's tiers to: its own, else the provider's first. */
function mappedModel(provider: Provider, model: string | null): string | null {
  return model ?? provider.models[0] ?? null
}

/** How many tokens of context Claude Code takes `[1m]` to tell of. */
const LONG_CONTEXT = 1_000_000

/**
 * A model as Claude Code takes it: marked `[1m]` where it takes a million
 * tokens of context, which Claude Code otherwise counts as 200,000, unless
 * it ends in such a mark already.
 */
export function claudeModel(model: string, context: number | null): string {
  if (/\[[^\]]*\]$/.test(model)) return model
  return context !== null && context >= LONG_CONTEXT ? `${model}[1m]` : model
}

/**
 * The environment of a Claude Code session on a provider, which Hoot gives it
 * in its `--settings`, where it takes precedence over the user's and the
 * project's settings and the login shell's environment: every provider
 * variable those set (see `isClaudeProviderVariable`) and every one a session
 * sets is set, empty to unset it where the provider gives none. A provider of
 * the user's gives where Claude Code reaches it: Amazon Bedrock's region and
 * API key, Vertex AI's region and project, or else its address and its key,
 * in the header it takes. It gives its model, or else its first, for Claude
 * Code's tiers, marked where it takes a million tokens of context (see
 * `claudeModel`), and turns off the line Claude Code adds to the system
 * prompt for Anthropic's billing, which changes with each version and keeps
 * other providers from caching the prompt. The harness's own sign-in gives
 * none, so that the session runs on the subscription.
 */
export function claudeSessionEnv(
  provider: Provider,
  model: string | null,
  /**
   * The variables its other settings and the login shell's environment set
   * (see `claudeUserVariables`).
   */
  userVariables: readonly string[],
  /** How many tokens of context a model of the provider takes; `null` where that is not known. */
  contextOf: (model: string) => number | null = () => null,
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const name of [...userVariables, ...SESSION_VARIABLES]) {
    if (isClaudeProviderVariable(name)) env[name] = ''
  }
  if (provider.own !== null) return env
  const cloud = provider.cloud
  if (cloud?.kind === 'bedrock') {
    env.CLAUDE_CODE_USE_BEDROCK = '1'
    // A key works in the region it was made in.
    env.AWS_REGION = cloud.region
    env.AWS_BEARER_TOKEN_BEDROCK = provider.apiKey
    // Claude Code's own models by the global prefix, which every region
    // serves, rather than the region's, which the newest lack in some.
    env.ANTHROPIC_BEDROCK_REGION_PREFIX = 'global'
  } else if (cloud?.kind === 'vertex') {
    env.CLAUDE_CODE_USE_VERTEX = '1'
    env.CLOUD_ML_REGION = cloud.region
    env.ANTHROPIC_VERTEX_PROJECT_ID = cloud.project
  } else {
    env.ANTHROPIC_BASE_URL = providerUrl(provider, 'claude')
    env[provider.keyHeader === 'x-api-key' ? 'ANTHROPIC_API_KEY' : 'ANTHROPIC_AUTH_TOKEN'] =
      provider.apiKey
  }
  const mapped = mappedModel(provider, model)
  if (mapped !== null) {
    const marked = claudeModel(mapped, contextOf(mapped))
    for (const tier of MAPPED_TIERS) env[`ANTHROPIC_DEFAULT_${tier}_MODEL`] = marked
  }
  env.CLAUDE_CODE_ATTRIBUTION_HEADER = '0'
  return env
}

/**
 * The files of settings Claude Code may read for a session in a folder,
 * besides those Hoot gives it: the user's own, and a project's, shared and
 * local, in the `.claude` of the folder or of any folder above it. Claude
 * Code reads a project's shared settings in the folder it starts in, and its
 * local ones at the root of the folder's repository too.
 */
function claudeSettingsFiles(home: string, env: Env, cwd: string): string[] {
  const files = [claudeSettingsFile(home, env)]
  for (let folder = path.resolve(cwd); ; folder = path.dirname(folder)) {
    files.push(
      path.join(folder, '.claude', 'settings.json'),
      path.join(folder, '.claude', 'settings.local.json'),
    )
    if (path.dirname(folder) === folder) return files
  }
}

/**
 * The variables of Claude Code's environment that its settings for a session
 * in `cwd` (see `claudeSettingsFiles`) and the login shell's environment set:
 * those a session on a provider unsets when its provider gives none of its
 * own. Only their names are taken, never their values.
 */
export async function claudeUserVariables(home: string, env: Env, cwd: string): Promise<string[]> {
  const files = await Promise.all(
    claudeSettingsFiles(home, env, cwd).map((file) => readSettings(file).catch(() => null)),
  )
  const names = new Set([
    ...files.flatMap((settings) => Object.keys(objectOf(settings?.env) ?? {})),
    ...Object.keys(env),
  ])
  return [...names].filter(isClaudeProviderVariable)
}

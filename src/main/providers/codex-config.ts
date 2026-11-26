import fs from 'node:fs/promises'
import path from 'node:path'
import { parse } from 'smol-toml'
import {
  bareModel,
  CODEX_PROVIDER_EFFORT,
  providerUrl,
  type GlobalConfig,
  type Provider,
} from '../../shared/providers'
import { codexConfigPath } from '../agents/codex-options'
import { envVariable, type Env } from '../env/env'
import type { GlobalReading } from './provider-service'

type JsonObject = Record<string, unknown>

/** The id under which Hoot gives Codex a provider of the user's, in its configuration or a session's. */
export const CODEX_PROVIDER_ID = 'hoot'

/** The variable a Codex session on a provider of the user's takes its key from. */
export const CODEX_KEY_VARIABLE = 'HOOT_CODEX_API_KEY'

/** OpenAI's own API, which a key Codex signed in with goes to. */
export const OPENAI_API_URL = 'https://api.openai.com/v1'

function objectOf(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

async function readToml(file: string): Promise<JsonObject | null> {
  try {
    return objectOf(parse(await fs.readFile(file, 'utf8')))
  } catch {
    return null
  }
}

async function readJson(file: string): Promise<JsonObject | null> {
  try {
    return objectOf(JSON.parse(await fs.readFile(file, 'utf8')))
  } catch {
    return null
  }
}

/** Codex's sign-in, beside its configuration. */
function codexAuthPath(env: Env, home: string): string {
  return path.join(path.dirname(codexConfigPath(env, home)), 'auth.json')
}

/**
 * What Codex's own configuration names as its global: its `model_provider`.
 * OpenAI's, the default, is its subscription while it is signed in with
 * ChatGPT, or OpenAI's API with the key it signed in with; another is that
 * provider's address and key, the key given in its table, in the variable
 * its `env_key` names, or with `requires_openai_auth`, as the key Codex
 * signed in with. `null` for one Hoot cannot run, as one without a key.
 */
export async function readCodexGlobal(env: Env, home: string): Promise<GlobalReading | null> {
  const [config, auth] = await Promise.all([
    readToml(codexConfigPath(env, home)),
    readJson(codexAuthPath(env, home)),
  ])
  const model = textOf(config?.model)
  const signedInKey = textOf(auth?.OPENAI_API_KEY)
  const providerId = textOf(config?.model_provider) ?? 'openai'
  if (providerId === 'openai') {
    if (objectOf(auth?.tokens) === null && signedInKey !== null) {
      return {
        config: { url: OPENAI_API_URL, apiKey: signedInKey, keyHeader: 'bearer', model },
        signedIn: false,
      }
    }
    return {
      config: { url: '', apiKey: '', keyHeader: 'bearer', model },
      signedIn: objectOf(auth?.tokens) !== null,
    }
  }
  const table = objectOf(objectOf(config?.model_providers)?.[providerId])
  const url = textOf(table?.base_url)
  const wire = textOf(table?.wire_api) ?? 'responses'
  const envKey = textOf(table?.env_key)
  const fromEnv = envKey === null ? null : textOf(envVariable(env, envKey))
  const key =
    textOf(table?.experimental_bearer_token) ??
    fromEnv ??
    (table?.requires_openai_auth === true ? signedInKey : null)
  if (url === null || key === null || wire !== 'responses') return null
  const global: GlobalConfig = { url, apiKey: key, keyHeader: 'bearer', model }
  return { config: global, signedIn: false }
}

/** A string as TOML writes it, in double quotes. */
function tomlString(text: string): string {
  return JSON.stringify(text)
}

/**
 * The arguments, and the variables, that run a Codex session on a provider:
 * one of the user's as Hoot's own `model_provider`, at its Responses address,
 * its key in a variable of the session's rather than among its arguments,
 * with its model, else its first, and an effort level every provider takes,
 * unless the agent picks one; for Codex's own sign-in, OpenAI's provider,
 * whatever the user's configuration names.
 */
export function codexProviderLaunch(
  provider: Provider,
  model: string | null,
  effort: string | null,
): { args: string[]; env: Record<string, string>; model: string | null; effort: string | null } {
  if (provider.own !== null) {
    return { args: ['-c', 'model_provider="openai"'], env: {}, model, effort }
  }
  const table =
    `{name=${tomlString(provider.name)},` +
    `base_url=${tomlString(providerUrl(provider, 'codex'))},` +
    `env_key=${tomlString(CODEX_KEY_VARIABLE)},wire_api="responses"}`
  const picked = model ?? provider.models[0] ?? null
  return {
    args: [
      '-c',
      `model_provider=${tomlString(CODEX_PROVIDER_ID)}`,
      '-c',
      `model_providers.${CODEX_PROVIDER_ID}=${table}`,
    ],
    env: { [CODEX_KEY_VARIABLE]: provider.apiKey },
    model: picked === null ? null : bareModel(picked),
    effort: effort ?? CODEX_PROVIDER_EFFORT,
  }
}

/** The lines of a TOML text before its first table, where its top-level keys are. */
function topLevelEnd(lines: readonly string[]): number {
  const index = lines.findIndex((line) => /^\s*\[/.test(line))
  return index === -1 ? lines.length : index
}

/** The text with a top-level key set to a value, or taken out for `null`, its other lines as they are. */
function withTopLevel(text: string, key: string, value: string | null): string {
  const lines = text.split('\n')
  const end = topLevelEnd(lines)
  const pattern = new RegExp(`^\\s*${key}\\s*=`)
  const at = lines.slice(0, end).findIndex((line) => pattern.test(line))
  if (at !== -1) {
    if (value === null) lines.splice(at, 1)
    else lines[at] = `${key} = ${value}`
    return lines.join('\n')
  }
  if (value === null) return text
  // After the last top-level line that holds something, so that a table's
  // comment above its header stays with it.
  let insert = end
  while (insert > 0 && lines[insert - 1]!.trim() === '') insert -= 1
  lines.splice(insert, 0, `${key} = ${value}`)
  return lines.join('\n')
}

/** The text with the table `[name]` replaced by `body`, or taken out for `null`, or added at its end. */
function withTable(text: string, name: string, body: string[] | null): string {
  const lines = text.split('\n')
  const header = new RegExp(`^\\s*\\[${name.replaceAll('.', '\\.')}\\]\\s*(#.*)?$`)
  const start = lines.findIndex((line) => header.test(line))
  if (start !== -1) {
    let end = lines.findIndex((line, index) => index > start && /^\s*\[/.test(line))
    if (end === -1) end = lines.length
    // The blank lines before the next table stay.
    while (end > start + 1 && lines[end - 1]!.trim() === '') end -= 1
    lines.splice(start, end - start, ...(body === null ? [] : [`[${name}]`, ...body]))
    return lines.join('\n')
  }
  if (body === null) return text
  const trimmed = text.replace(/\n*$/, '')
  return `${trimmed}${trimmed === '' ? '' : '\n\n'}[${name}]\n${body.join('\n')}\n`
}

/**
 * Writes a provider and a model into Codex's own configuration, as the
 * global Codex runs on outside Hoot, editing those lines alone and leaving
 * the rest of config.toml as it is, its comments included: for a provider of
 * the user's, `model_provider` naming Hoot's table, which holds its address
 * and its key, and the model; for Codex's own sign-in, OpenAI's provider and
 * the model. The effort level the provider before took goes, as it may be
 * one the next does not take. The file is replaced at once, keeping who may
 * read it, or made readable by its owner alone, as it can hold a key.
 */
export async function writeCodexGlobal(
  env: Env,
  home: string,
  provider: Provider,
  model: string | null,
): Promise<void> {
  const file = codexConfigPath(env, home)
  let text = await fs.readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return ''
    throw error
  })
  // Checked, so that a file Codex cannot read is not made worse.
  if (text.trim() !== '') parse(text)
  const picked = model ?? (provider.own === null ? (provider.models[0] ?? null) : null)
  text = withTopLevel(text, 'model_reasoning_effort', null)
  text = withTopLevel(text, 'model', picked === null ? null : tomlString(bareModel(picked)))
  if (provider.own !== null) {
    text = withTopLevel(text, 'model_provider', null)
    text = withTable(text, `model_providers.${CODEX_PROVIDER_ID}`, null)
  } else {
    text = withTopLevel(text, 'model_provider', tomlString(CODEX_PROVIDER_ID))
    text = withTable(text, `model_providers.${CODEX_PROVIDER_ID}`, [
      `name = ${tomlString(provider.name)}`,
      `base_url = ${tomlString(providerUrl(provider, 'codex'))}`,
      'wire_api = "responses"',
      `experimental_bearer_token = ${tomlString(provider.apiKey)}`,
    ])
  }
  // What Codex will read must still be TOML.
  parse(text)
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

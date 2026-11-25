import fs from 'node:fs/promises'
import path from 'node:path'
import { applyEdits, modify, parse, type ParseError } from 'jsonc-parser'
import type { AgentLaunchOptions } from '../../shared/agents'
import {
  canRun,
  OPENCODE_DEFAULT_FREE_MODEL,
  bareModel,
  openCodeProviderId,
  providerUrl,
  trimUrl,
  type GlobalConfig,
  type Provider,
} from '../../shared/providers'
import { runCommand } from '../agents/processes'
import type { Env } from '../env/env'
import { openCodeConfigFolder } from '../session/opencode-plugin'
import { commandProgram } from '../tools/command-program'
import type { GlobalReading } from './provider-service'

type JsonObject = Record<string, unknown>

/** The package OpenCode runs a provider at an Anthropic-compatible address with. */
export const ANTHROPIC_COMPATIBLE = '@opencode/ai/providers/anthropic-compatible'

/** How long OpenCode may take to answer through its API. */
const API_TIMEOUT_MS = 30_000

function objectOf(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/**
 * OpenCode's own configuration, in its folder (see `openCodeConfigFolder`):
 * `opencode.jsonc` when there is one, else `opencode.json`, which a write
 * makes when neither is there.
 */
export async function openCodeConfigFile(env: Env, home: string): Promise<string> {
  // The home folder given, unless the environment names one: never Hoot's own.
  const folder = openCodeConfigFolder({ HOME: home, USERPROFILE: home, ...env }, home)
  const jsonc = path.join(folder, 'opencode.jsonc')
  const exists = await fs
    .stat(jsonc)
    .then((stats) => stats.isFile())
    .catch(() => false)
  return exists ? jsonc : path.join(folder, 'opencode.json')
}

/** A configuration's text and what it holds: an empty object without one; an error for one that is no object. */
async function readConfig(file: string): Promise<{ text: string; config: JsonObject }> {
  let text: string
  try {
    text = await fs.readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { text: '{}\n', config: {} }
    throw error
  }
  if (text.trim() === '') return { text: '{}\n', config: {} }
  const errors: ParseError[] = []
  const config = objectOf(parse(text, errors, { allowTrailingComma: true }))
  if (errors.length > 0 || config === null) throw new Error(`${file} does not hold a JSON object.`)
  return { text, config }
}

/** An address at an Anthropic-compatible provider as OpenCode takes it: ending in `/v1`. */
export function openCodeBaseUrl(url: string): string {
  const trimmed = trimUrl(url)
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`
}

/** An address OpenCode takes, as Hoot keeps it: without the `/v1` it adds. */
function hootUrl(baseUrl: string): string {
  return trimUrl(baseUrl).replace(/\/v1$/, '')
}

/** A configuration that names OpenCode's free models, with a model. */
function freeModels(model: string | null): GlobalReading {
  return { config: { url: '', apiKey: '', keyHeader: 'bearer', model }, signedIn: true }
}

/**
 * What OpenCode's own configuration names as its global: its default model's
 * provider, `model` being `provider/model`. None, or one of OpenCode's own,
 * is its free models; one at an Anthropic-compatible address, Hoot's or
 * another the user wrote there with its key, is that address and key. `null`
 * for one Hoot cannot run, as one whose key OpenCode keeps elsewhere.
 */
export async function readOpenCodeGlobal(env: Env, home: string): Promise<GlobalReading | null> {
  let config: JsonObject
  try {
    ;({ config } = await readConfig(await openCodeConfigFile(env, home)))
  } catch {
    return freeModels(null)
  }
  const named = textOf(config.model)
  if (named === null) return freeModels(null)
  const slash = named.indexOf('/')
  const providerId = slash === -1 ? named : named.slice(0, slash)
  const model = slash === -1 ? null : named.slice(slash + 1) || null
  if (providerId === 'opencode') return freeModels(model)
  const entry = objectOf(objectOf(config.providers)?.[providerId])
  const settings = objectOf(entry?.settings)
  const baseUrl = textOf(settings?.baseURL)
  const apiKey = textOf(settings?.apiKey)
  if (entry?.package !== ANTHROPIC_COMPATIBLE || baseUrl === null || apiKey === null) return null
  const global: GlobalConfig = { url: hootUrl(baseUrl), apiKey, keyHeader: 'bearer', model }
  return { config: global, signedIn: false }
}

/** A provider of the user's as OpenCode's configuration holds it. */
function openCodeEntry(provider: Provider): JsonObject {
  return {
    name: provider.name,
    package: ANTHROPIC_COMPATIBLE,
    settings: {
      baseURL: openCodeBaseUrl(providerUrl(provider, 'opencode')),
      apiKey: provider.apiKey,
    },
    models: Object.fromEntries(
      provider.models.map((model) => [bareModel(model), { name: bareModel(model) }]),
    ),
  }
}

/** OpenCode's `provider/model` of a model on a provider: on its free models, the default one. */
export function openCodeModelRef(provider: Provider, model: string | null): string {
  const id =
    model === null
      ? provider.own === 'opencode'
        ? OPENCODE_DEFAULT_FREE_MODEL
        : bareModel(provider.models[0] ?? '')
      : bareModel(model)
  return `${openCodeProviderId(provider)}/${id}`
}

/**
 * Writes the user's providers that OpenCode can run into its own
 * configuration, each as `hoot-<id>`, in place of those Hoot wrote before,
 * leaving everything else in the file as it is, its comments included. With
 * a global, it is the default model too: the provider and model, or for its
 * free models, a model of theirs, or none for its own default. The file is
 * replaced at once, keeping who may read it, or made readable by its owner
 * alone, as it holds keys; a file that holds no JSON object is left alone,
 * with an error.
 */
export async function writeOpenCodeConfig(
  env: Env,
  home: string,
  providers: readonly Provider[],
  global: { provider: Provider; model: string | null } | null = null,
): Promise<void> {
  const file = await openCodeConfigFile(env, home)
  const { text, config } = await readConfig(file)
  const formatting = { formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' } }
  let next = text
  const set = (keys: string[], value: unknown) => {
    next = applyEdits(next, modify(next, keys, value, formatting))
  }
  const wanted = new Map(
    providers
      .filter((provider) => provider.own === null && canRun(provider, 'opencode'))
      .map((provider) => [openCodeProviderId(provider), openCodeEntry(provider)]),
  )
  for (const key of Object.keys(objectOf(config.providers) ?? {})) {
    if (key.startsWith('hoot-') && !wanted.has(key)) set(['providers', key], undefined)
  }
  for (const [key, entry] of wanted) set(['providers', key], entry)
  if (global !== null) {
    const { provider, model } = global
    set(
      ['model'],
      provider.own === 'opencode' && model === null ? undefined : openCodeModelRef(provider, model),
    )
  }
  if (next === text) return
  const mode = await fs
    .stat(file)
    .then((stats) => stats.mode & 0o777)
    .catch(() => 0o600)
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.hoot-${process.pid}-${Date.now()}`
  try {
    await fs.writeFile(temporary, next, { mode })
    await fs.chmod(temporary, mode)
    await fs.rename(temporary, file)
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

/** What OpenCode's API answered, as `opencode api` writes it: its data, else the answer itself. */
function apiData(stdout: string): unknown {
  const answer = objectOf(JSON.parse(stdout))
  return answer !== null && 'data' in answer ? answer.data : answer
}

/** Runs `opencode api` with an operation and its input, and returns its data. */
async function openCodeApi(
  command: string,
  env: Env,
  cwd: string,
  args: string[],
): Promise<unknown> {
  const program = await commandProgram(command, env)
  const result = await runCommand(
    { file: program.file, args: [...program.args, 'api', ...args], env, cwd },
    API_TIMEOUT_MS,
  )
  if (result.code !== 0) {
    const reason = result.output.trim().split('\n')[0] ?? ''
    throw new Error(reason === '' ? `It exited with code ${result.code}.` : reason)
  }
  return apiData(result.stdout)
}

/**
 * Makes a conversation in OpenCode, through its background service, in a
 * folder and on a model, `provider/model`, with an effort level as its
 * variant; returns its id, which a session of OpenCode's opens with `-s`.
 */
export async function createOpenCodeSession(
  command: string,
  env: Env,
  cwd: string,
  model: string,
  variant: string | null,
): Promise<string> {
  const slash = model.indexOf('/')
  const body = {
    model: {
      providerID: model.slice(0, slash),
      id: model.slice(slash + 1),
      ...(variant === null ? {} : { variant }),
    },
    location: { directory: cwd },
  }
  const data = objectOf(
    await openCodeApi(command, env, cwd, ['session.create', '-d', JSON.stringify(body)]),
  )
  const id = textOf(data?.id)
  if (id === null) throw new Error('OpenCode made no conversation.')
  return id
}

/**
 * The free models OpenCode comes with, which its own agents offer, each with
 * the effort levels it takes, its variants, as its own server lists them.
 */
export async function readOpenCodeLaunchOptions(
  command: string,
  env: Env,
  cwd: string,
): Promise<AgentLaunchOptions> {
  const data = await openCodeApi(command, env, cwd, ['--standalone', 'model.list']).catch(
    () => null,
  )
  const models = (Array.isArray(data) ? data : []).flatMap((entry) => {
    const model = objectOf(entry)
    if (model === null || model.providerID !== 'opencode') return []
    const id = textOf(model.modelID) ?? textOf(model.id)
    if (id === null) return []
    const variants = Array.isArray(model.variants) ? model.variants : []
    return [
      {
        value: id,
        label: textOf(model.name) ?? id,
        efforts: variants.flatMap((variant) => {
          const name = textOf(objectOf(variant)?.id)
          return name === null ? [] : [name]
        }),
      },
    ]
  })
  return {
    models,
    defaultEfforts: [],
    defaultModel: { value: OPENCODE_DEFAULT_FREE_MODEL, source: 'OpenCode' },
    defaultEffort: null,
  }
}

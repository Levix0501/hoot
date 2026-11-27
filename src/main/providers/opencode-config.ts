import fs from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { findNodeAtLocation, parse, parseTree, type JSONPath, type ParseError } from 'jsonc-parser'
import { major, valid } from 'semver'
import type { AgentLaunchOptions } from '../../shared/agents'
import {
  agentModels,
  bareModel,
  canRun,
  catalogModelOf,
  OPENCODE_DEFAULT_FREE_MODEL,
  openCodeProviderId,
  providerFirstModel,
  providerFormat,
  providerUrl,
  trimUrl,
  type CatalogModel,
  type ModelCatalogs,
  type Provider,
} from '../../shared/providers'
import { runCommand } from '../agents/processes'
import { setEnvVariable, type Env } from '../env/env'
import { openCodeConfigFolder } from '../session/opencode-plugin'
import { commandProgram } from '../tools/command-program'

type JsonObject = Record<string, unknown>

/** The package OpenCode runs a provider at an Anthropic-compatible address with. */
export const ANTHROPIC_COMPATIBLE = '@opencode/ai/providers/anthropic-compatible'

/** The package OpenCode runs a provider at a Responses address with. */
export const RESPONSES_COMPATIBLE = '@opencode/ai/providers/openai-compatible/responses'

/**
 * The variable that gives `opencode api`, and a window of OpenCode's, the
 * password of the server it connects to with `--server`.
 */
export const OPENCODE_PASSWORD = 'OPENCODE_PASSWORD'

/** A server of OpenCode's: where it listens, and the password it asks for. */
export interface OpenCodeServer {
  url: string
  password: string
}

/** How long OpenCode may take to answer through its API. */
const API_TIMEOUT_MS = 30_000

/** How many times Hoot asks OpenCode's service for its models while it lists none yet. */
const MODEL_LIST_TRIES = 5

/** How long Hoot waits before asking again. */
const MODEL_LIST_INTERVAL_MS = 1500

/**
 * Whether an OpenCode takes Hoot's providers, as the version it reports
 * says: OpenCode 2 does, with `providers` in its configuration and the
 * conversations `opencode api` makes. OpenCode 1 has neither, so Hoot runs
 * it as it did before it had providers and leaves its configuration alone;
 * so too one whose version Hoot cannot read.
 */
export function takesProviders(version: string | null): boolean {
  const parsed = version === null ? null : valid(version)
  return parsed !== null && major(parsed) >= 2
}

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

/**
 * A model of a provider of the user's as OpenCode's configuration holds it:
 * how many tokens of context it takes and of answer it gives, and the effort
 * levels it takes, as its variants, as models.dev lists them; OpenCode gives
 * it its own where models.dev lists none (see `OPENCODE_FORMAT_EFFORTS`).
 */
function openCodeModelEntry(id: string, listed: CatalogModel | null): JsonObject {
  const limit = {
    ...(listed?.context == null ? {} : { context: listed.context }),
    ...(listed?.output == null ? {} : { output: listed.output }),
  }
  const efforts = listed?.efforts ?? []
  return {
    name: id,
    ...(Object.keys(limit).length === 0 ? {} : { limit }),
    ...(efforts.length === 0
      ? {}
      : { capabilities: { reasoning: { supported: true, effort: [...efforts] } } }),
  }
}

/**
 * A provider of the user's as OpenCode's configuration holds it: at its
 * Anthropic-compatible address, else at its Responses one (see
 * `providerFormat`), its key in the header it asks for, a bearer token at an
 * Anthropic-compatible address taking the place of the `x-api-key` OpenCode
 * sends there, and the models its agents offer (see `agentModels`), each as
 * models.dev tells of it (see `openCodeModelEntry`). `null` for one OpenCode
 * cannot run.
 */
export function openCodeEntry(provider: Provider, catalogs: ModelCatalogs): JsonObject | null {
  const format = providerFormat(provider, 'opencode')
  if (provider.own !== null || format === null) return null
  const url = providerUrl(provider, 'opencode')
  const bearer = format === 'anthropic' && provider.keyHeader === 'bearer'
  return {
    name: provider.name,
    package: format === 'anthropic' ? ANTHROPIC_COMPATIBLE : RESPONSES_COMPATIBLE,
    settings: {
      baseURL: format === 'anthropic' ? openCodeBaseUrl(url) : trimUrl(url),
      ...(bearer ? {} : { apiKey: provider.apiKey }),
    },
    ...(bearer ? { headers: { Authorization: `Bearer ${provider.apiKey}` } } : {}),
    models: Object.fromEntries(
      agentModels('opencode', provider, catalogs).map((model) => [
        bareModel(model),
        openCodeModelEntry(bareModel(model), catalogModelOf(catalogs, 'opencode', provider, model)),
      ]),
    ),
  }
}

/**
 * Hoot's configuration of OpenCode, which the servers of OpenCode's that Hoot
 * runs take besides the user's own (see `OpenCodeServers`): the user's
 * providers that OpenCode can run, each as `hoot-<id>` (see
 * `openCodeProviderId`), as each session may pick one with `/models`.
 */
export function hootOpenCodeConfig(
  providers: readonly Provider[],
  catalogs: ModelCatalogs,
): JsonObject {
  return {
    providers: Object.fromEntries(
      providers.flatMap((provider) => {
        const entry = canRun(provider, 'opencode') ? openCodeEntry(provider, catalogs) : null
        return entry === null ? [] : [[openCodeProviderId(provider), entry]]
      }),
    ),
  }
}

/**
 * OpenCode's `provider/model` of a model on a provider: without one, on its
 * free models, the one they start with, and on a provider of the user's, the
 * one its agents start with (see `providerFirstModel`).
 */
export function openCodeModelRef(
  provider: Provider,
  model: string | null,
  catalogs: ModelCatalogs,
): string {
  const id =
    model ??
    (provider.own === 'opencode'
      ? OPENCODE_DEFAULT_FREE_MODEL
      : (providerFirstModel('opencode', provider, catalogs) ?? ''))
  return `${openCodeProviderId(provider)}/${bareModel(id)}`
}

/**
 * Replaces a file at once with the text given, keeping who may read it, or
 * making it readable by its owner alone where it is new, as it may hold
 * keys.
 */
async function replaceFile(file: string, text: string, mode?: number): Promise<void> {
  const kept =
    mode ??
    (await fs
      .stat(file)
      .then((stats) => stats.mode & 0o777)
      .catch(() => 0o600))
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.hoot-${process.pid}-${Date.now()}`
  try {
    await fs.writeFile(temporary, text, { mode: kept })
    await fs.chmod(temporary, kept)
    await fs.rename(temporary, file)
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

/**
 * Writes Hoot's configuration of OpenCode (see `hootOpenCodeConfig`) into
 * its file, readable by its owner alone, as it holds keys: replaced at once,
 * as OpenCode reads it again as it changes.
 */
export async function writeHootOpenCodeConfig(file: string, config: unknown): Promise<void> {
  await replaceFile(file, `${JSON.stringify(config, null, 2)}\n`, 0o600)
}

/**
 * A configuration's text without the property at `where`, with the comma
 * that went with it, the rest as it is; an object left without properties is
 * `{}`. `null` where there is no such property. (`modify` of jsonc-parser
 * 3.3 leaves the comma after an object's only property behind, which no
 * longer parses.)
 */
function withoutProperty(text: string, where: JSONPath): string | null {
  const root = parseTree(text, [], { allowTrailingComma: true })
  const property = root === undefined ? undefined : findNodeAtLocation(root, where)?.parent
  const object = property?.parent
  if (property?.type !== 'property' || object === undefined) return null
  const siblings = object.children ?? []
  const index = siblings.indexOf(property)
  const next = siblings[index + 1]
  const previous = siblings[index - 1]
  if (next !== undefined) return text.slice(0, property.offset) + text.slice(next.offset)
  if (previous !== undefined) {
    return (
      text.slice(0, previous.offset + previous.length) +
      text.slice(property.offset + property.length)
    )
  }
  return text.slice(0, object.offset + 1) + text.slice(object.offset + object.length - 1)
}

/**
 * Takes out of OpenCode's own configuration the providers an earlier Hoot
 * wrote into it, each as `hoot-<id>`, but the one its default model is of,
 * which OpenCode runs on outside Hoot, leaving everything else in the file as
 * it is, its comments included; `providers` goes where nothing else is left
 * in it. A file that holds no JSON object, or that would not parse after,
 * is left alone. Returns whether the file changed.
 */
export async function removeHootProviders(env: Env, home: string): Promise<boolean> {
  const file = await openCodeConfigFile(env, home)
  let read: { text: string; config: JsonObject }
  try {
    read = await readConfig(file)
  } catch {
    return false
  }
  const { text, config } = read
  const named = textOf(config.model)
  const kept = named === null ? null : named.split('/')[0]
  const entries = Object.keys(objectOf(config.providers) ?? {})
  const gone = entries.filter((key) => key.startsWith('hoot-') && key !== kept)
  if (gone.length === 0) return false
  let next = text
  for (const key of gone) next = withoutProperty(next, ['providers', key]) ?? next
  if (gone.length === entries.length) next = withoutProperty(next, ['providers']) ?? next
  const errors: ParseError[] = []
  const left = objectOf(parse(next, errors, { allowTrailingComma: true }))
  const providersLeft = Object.keys(objectOf(left?.providers) ?? {})
  if (errors.length > 0 || left === null || providersLeft.some((key) => gone.includes(key))) {
    return false
  }
  await replaceFile(file, next)
  return true
}

/** What OpenCode's API answered, as `opencode api` writes it: its data, else the answer itself. */
function apiData(stdout: string): unknown {
  const answer = objectOf(JSON.parse(stdout))
  return answer !== null && 'data' in answer ? answer.data : answer
}

/**
 * Runs `opencode api` with an operation and its input, through a server of
 * Hoot's where one is given, else through OpenCode's background service, and
 * returns its data.
 */
async function openCodeApi(
  command: string,
  env: Env,
  cwd: string,
  args: string[],
  server: OpenCodeServer | null = null,
): Promise<unknown> {
  const program = await commandProgram(command, env)
  const apiEnv = { ...env }
  if (server !== null) setEnvVariable(apiEnv, OPENCODE_PASSWORD, server.password)
  const through = server === null ? [] : ['--server', server.url]
  const result = await runCommand(
    { file: program.file, args: [...program.args, 'api', ...through, ...args], env: apiEnv, cwd },
    API_TIMEOUT_MS,
  )
  if (result.code !== 0) {
    const reason = result.output.trim().split('\n')[0] ?? ''
    throw new Error(reason === '' ? `It exited with code ${result.code}.` : reason)
  }
  return apiData(result.stdout)
}

/**
 * Makes a conversation in OpenCode, through a server of Hoot's, in a folder
 * and on a model, `provider/model`, with an effort level as its variant;
 * returns its id, which a session of OpenCode's on that server opens with
 * `-s`.
 */
export async function createOpenCodeSession(
  command: string,
  env: Env,
  server: OpenCodeServer,
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
    await openCodeApi(command, env, cwd, ['session.create', '-d', JSON.stringify(body)], server),
  )
  const id = textOf(data?.id)
  if (id === null) throw new Error('OpenCode made no conversation.')
  return id
}

/**
 * The free models OpenCode comes with, which its own agents offer, each with
 * the effort levels it takes, its variants, as the background service of the
 * user's own OpenCode lists them, which needs no server of Hoot's to be
 * started for it. A service that has just started lists none until it has
 * read them, a moment later, so an empty list is asked for again a few
 * times.
 */
export async function readOpenCodeLaunchOptions(
  command: string,
  env: Env,
  cwd: string,
  interval = MODEL_LIST_INTERVAL_MS,
): Promise<AgentLaunchOptions> {
  let data: unknown = null
  for (let attempt = 0; attempt < MODEL_LIST_TRIES; attempt += 1) {
    if (attempt > 0) await delay(interval)
    data = await openCodeApi(command, env, cwd, ['model.list']).catch(() => null)
    if (!Array.isArray(data) || data.length > 0) break
  }
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

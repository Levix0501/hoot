import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import {
  PROVIDER_PRESETS,
  planCatalog,
  presetPlans,
  type CatalogModel,
  type ModelCatalogs,
} from '../../shared/providers'
import snapshot from './models-dev-snapshot.json'

/** Where models.dev serves the models of every provider it knows. */
export const MODELS_DEV_URL = 'https://models.dev/api.json'

/** How long the models Hoot has read of models.dev stay fresh: a day. */
export const MODELS_DEV_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** How often Hoot looks whether they are still fresh. */
const CHECK_EVERY_MS = 60 * 60 * 1000

/** How long reading models.dev may take: its file is several megabytes. */
const TIMEOUT_MS = 60_000

/** The `fetch` that reads models.dev: Electron's, in Hoot. */
export type Fetch = (
  url: string,
  init: { signal: AbortSignal; headers: Record<string, string>; cache: 'no-store' },
) => Promise<Response>

/** The models.dev providers Hoot's presets name, whose models Hoot keeps. */
export const CATALOG_IDS: readonly string[] = [
  ...new Set(
    PROVIDER_PRESETS.flatMap((preset) =>
      presetPlans(preset).map((plan) => planCatalog(preset, plan)),
    ),
  ),
].toSorted()

const optional = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined)

/** What Hoot keeps of a models.dev model: what tells whether an agent can run it, and its context. */
const keptModel = z.object({
  id: z.string().min(1),
  status: optional(z.string()),
  tool_call: optional(z.boolean()),
  modalities: optional(z.object({ output: optional(z.array(z.string())) })),
  release_date: optional(z.string()),
  limit: optional(z.object({ context: optional(z.number()) })),
  /** The package and address the model is served with, when not its provider's. */
  provider: optional(z.object({ npm: optional(z.string()), api: optional(z.string()) })),
})

type KeptModel = z.infer<typeof keptModel>

/** What Hoot keeps of a models.dev provider: its address, and its models by id. */
interface KeptCatalog {
  api?: string
  models: Record<string, KeptModel>
}

/** What Hoot keeps of models.dev, as it ships with Hoot and as Hoot saves it after reading it. */
export interface ModelsDevCopy {
  /** When it was read, in milliseconds since the Unix epoch. */
  fetchedAt: number
  /** The ETag models.dev answered with, which tells whether it has changed since; `null` for none. */
  etag: string | null
  catalogs: Record<string, KeptCatalog>
}

const catalogShape = z.object({
  api: optional(z.string()),
  models: z.record(z.string(), z.unknown()),
})

/**
 * What Hoot keeps of the providers in models.dev's file: those of `ids` it
 * has, each model with the fields Hoot reads, those that do not read left
 * out; `null` for a file of another form.
 */
export function keptCatalogs(
  file: unknown,
  ids: readonly string[] = CATALOG_IDS,
): Record<string, KeptCatalog> | null {
  if (typeof file !== 'object' || file === null || Array.isArray(file)) return null
  const catalogs: Record<string, KeptCatalog> = {}
  for (const id of ids) {
    const parsed = catalogShape.safeParse((file as Record<string, unknown>)[id])
    if (!parsed.success) continue
    const models: Record<string, KeptModel> = {}
    for (const [key, value] of Object.entries(parsed.data.models)) {
      const model = keptModel.safeParse(value)
      if (model.success) models[key] = model.data
    }
    catalogs[id] = { ...(parsed.data.api === undefined ? {} : { api: parsed.data.api }), models }
  }
  return catalogs
}

/** The packages whose models Hoot's agents can run: Anthropic's API, and OpenAI's Responses API. */
const RUNNABLE_PACKAGES = new Set(['@ai-sdk/anthropic', '@ai-sdk/openai', '@ai-sdk/azure'])

function hostOf(url: string): string | null {
  try {
    return new URL(url).host || null
  } catch {
    return null
  }
}

/** The hosts each models.dev provider is reached at by Hoot's presets. */
const PRESET_HOSTS: ReadonlyMap<string, ReadonlySet<string>> = (() => {
  const hosts = new Map<string, Set<string>>()
  for (const preset of PROVIDER_PRESETS) {
    for (const plan of presetPlans(preset)) {
      const catalog = planCatalog(preset, plan)
      for (const url of Object.values(plan.urls)) {
        const host = hostOf(url ?? '')
        if (host !== null) hosts.set(catalog, (hosts.get(catalog) ?? new Set()).add(host))
      }
    }
  }
  return hosts
})()

/**
 * Whether an agent on a provider can run a model of it: one still served
 * that calls tools and answers in text, at the provider's own host, by
 * Anthropic's API or OpenAI's, not by another's, as a gateway serves some.
 */
function runnable(model: KeptModel, hosts: ReadonlySet<string>): boolean {
  if (model.status === 'deprecated' || model.tool_call !== true) return false
  if (!(model.modalities?.output ?? ['text']).includes('text')) return false
  const npm = model.provider?.npm
  if (npm !== undefined && !RUNNABLE_PACKAGES.has(npm)) return false
  const api = model.provider?.api
  return api === undefined || hosts.has(hostOf(api) ?? '')
}

/** The models an agent can run of each provider Hoot keeps, newest first (see `ModelCatalogs`). */
export function catalogsOf(copy: Pick<ModelsDevCopy, 'catalogs'>): ModelCatalogs {
  const catalogs: Record<string, CatalogModel[]> = {}
  for (const [id, catalog] of Object.entries(copy.catalogs)) {
    const hosts = new Set(PRESET_HOSTS.get(id))
    const own = hostOf(catalog.api ?? '')
    if (own !== null) hosts.add(own)
    catalogs[id] = Object.values(catalog.models)
      .filter((model) => runnable(model, hosts))
      .toSorted(
        (a, b) =>
          (b.release_date ?? '').localeCompare(a.release_date ?? '') || b.id.localeCompare(a.id),
      )
      .map((model) => ({ id: model.id, context: model.limit?.context ?? null }))
  }
  return catalogs
}

/** The copy Hoot ships with, read of models.dev as it was built. */
export const SNAPSHOT: ModelsDevCopy = snapshot as ModelsDevCopy

const savedCopy = z.object({
  fetchedAt: z.number(),
  etag: z.string().nullable(),
  catalogs: z.record(z.string(), z.unknown()),
})

/**
 * The copy Hoot saved in a file; `null` for none, one it cannot read, and one
 * an earlier Hoot saved that lacks a provider this one knows.
 */
async function readCopy(file: string): Promise<ModelsDevCopy | null> {
  try {
    const saved = savedCopy.safeParse(JSON.parse(await fs.readFile(file, 'utf8')))
    if (!saved.success) return null
    const catalogs = keptCatalogs(saved.data.catalogs)
    if (catalogs === null || CATALOG_IDS.some((id) => catalogs[id] === undefined)) return null
    return { ...saved.data, catalogs }
  } catch {
    return null
  }
}

/** Saves a copy into a file, replacing it at once. */
async function saveCopy(file: string, copy: ModelsDevCopy): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}-${Date.now()}`
  try {
    await fs.writeFile(temporary, JSON.stringify(copy))
    await fs.rename(temporary, file)
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

export interface ModelsDevOptions {
  /** The file Hoot saves what it reads of models.dev in. */
  file: string
  fetch: Fetch
  /** Hoot's clock, replaceable for tests. */
  now?(): number
  /** The copy Hoot ships with, replaceable for tests. */
  snapshot?: ModelsDevCopy
}

/**
 * The models of the providers Hoot knows, as models.dev lists them: the copy
 * Hoot ships with, until Hoot has read a newer one, which it saves. Hoot
 * reads models.dev again once a copy is a day old, asking whether it has
 * changed since, and keeps the copy it has when it cannot read it, as
 * without a network.
 */
export class ModelsDev extends EventEmitter<{ changed: [catalogs: ModelCatalogs] }> {
  private copy: ModelsDevCopy
  private current: ModelCatalogs
  private timer: NodeJS.Timeout | null = null
  private reading: Promise<void> | null = null

  constructor(private readonly options: ModelsDevOptions) {
    super()
    this.copy = options.snapshot ?? SNAPSHOT
    this.current = catalogsOf(this.copy)
  }

  catalogs(): ModelCatalogs {
    return this.current
  }

  /** How many tokens of context a model of a models.dev provider takes; `null` where it is not known. */
  context(catalog: string, model: string): number | null {
    return this.current[catalog]?.find((entry) => entry.id === model)?.context ?? null
  }

  /**
   * Takes the copy saved before when it is newer than the one Hoot ships
   * with, then reads models.dev when the copy is a day old, and looks again
   * every hour.
   */
  async start(): Promise<void> {
    const saved = await readCopy(this.options.file)
    if (saved !== null && saved.fetchedAt > this.copy.fetchedAt) this.take(saved)
    this.timer ??= setInterval(() => void this.refreshIfStale(), CHECK_EVERY_MS)
    this.timer.unref()
    await this.refreshIfStale()
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }

  /** Reads models.dev when the copy Hoot has is a day old. */
  refreshIfStale(): Promise<void> {
    if (this.now() - this.copy.fetchedAt < MODELS_DEV_MAX_AGE_MS) return Promise.resolve()
    return this.refresh()
  }

  /** Reads models.dev, once at a time. */
  refresh(): Promise<void> {
    this.reading ??= this.read().finally(() => {
      this.reading = null
    })
    return this.reading
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }

  private async read(): Promise<void> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      // Past the network stack's own cache, which would answer for models.dev.
      const response = await this.options.fetch(MODELS_DEV_URL, {
        signal: controller.signal,
        headers: this.copy.etag === null ? {} : { 'If-None-Match': this.copy.etag },
        cache: 'no-store',
      })
      if (response.status === 304) {
        await this.keep({ ...this.copy, fetchedAt: this.now() })
        return
      }
      if (!response.ok) return
      const read = keptCatalogs(await response.json())
      if (read === null || Object.keys(read).length === 0) return
      // A provider models.dev no longer lists keeps the models it listed.
      const catalogs = { ...this.copy.catalogs, ...read }
      await this.keep({ fetchedAt: this.now(), etag: response.headers.get('etag'), catalogs })
    } catch {
      // Without a network, or with a file of another form: the copy Hoot has stays.
    } finally {
      clearTimeout(timer)
    }
  }

  /** Takes a copy and saves it; a copy that cannot be saved is still taken. */
  private async keep(copy: ModelsDevCopy): Promise<void> {
    this.take(copy)
    await saveCopy(this.options.file, copy).catch(() => {})
  }

  private take(copy: ModelsDevCopy): void {
    const changed = copy.catalogs !== this.copy.catalogs
    this.copy = copy
    if (!changed) return
    this.current = catalogsOf(copy)
    this.emit('changed', this.current)
  }
}

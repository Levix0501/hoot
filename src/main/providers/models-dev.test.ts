import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CATALOG_IDS,
  catalogsOf,
  keptCatalogs,
  MODELS_DEV_MAX_AGE_MS,
  MODELS_DEV_URL,
  ModelsDev,
  SNAPSHOT,
  type Fetch,
  type ModelsDevCopy,
} from './models-dev'

let folder: string

beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-models-dev-'))
})

afterEach(() => fs.rmSync(folder, { recursive: true, force: true }))

const savedFile = () => path.join(folder, 'models-dev.json')

/** A model as models.dev lists it, calling tools and answering in text unless changed. */
function model(id: string, change: Record<string, unknown> = {}) {
  return {
    id,
    name: id,
    tool_call: true,
    modalities: { input: ['text'], output: ['text'] },
    release_date: '2026-01-01',
    limit: { context: 128_000, output: 8_000 },
    cost: { input: 1, output: 2 },
    ...change,
  }
}

/** models.dev's file, with every provider Hoot keeps, each listing `models` unless given its own. */
function modelsDevFile(
  models: Record<string, unknown>,
  own: Record<string, unknown> = {},
): Record<string, unknown> {
  return Object.fromEntries(
    CATALOG_IDS.map((id) => [id, { id, name: id, models: own[id] ?? models }]),
  )
}

/** A copy as Hoot keeps it, of models.dev's file at a time. */
function copyOf(file: Record<string, unknown>, fetchedAt: number, etag: string | null = null) {
  return { fetchedAt, etag, catalogs: keptCatalogs(file)! } satisfies ModelsDevCopy
}

const DAY = MODELS_DEV_MAX_AGE_MS

describe('models.dev', () => {
  it('keeps the providers the presets name and the fields Hoot reads', () => {
    const file = { ...modelsDevFile({ a: model('a') }), elsewhere: { models: {} } }
    const kept = keptCatalogs(file)!
    expect(Object.keys(kept).toSorted()).toEqual([...CATALOG_IDS])
    expect(kept.deepseek?.models.a).toEqual({
      id: 'a',
      tool_call: true,
      modalities: { output: ['text'] },
      release_date: '2026-01-01',
      limit: { context: 128_000 },
    })
    expect(keptCatalogs([])).toBeNull()
    expect(keptCatalogs({ deepseek: { models: { b: { name: 'no id' } } } })).toEqual({
      deepseek: { models: {} },
    })
  })

  it('lists the models an agent can run, newest first', () => {
    const models = {
      old: model('old', { release_date: '2025-06-01' }),
      new: model('new', { release_date: '2026-09-01', limit: { context: 1_000_000 } }),
      retired: model('retired', { status: 'deprecated' }),
      silent: model('silent', { tool_call: false }),
      picture: model('picture', { modalities: { output: ['image'] } }),
      // A gateway's model served by another's API, or at another host.
      gemini: model('gemini', { provider: { npm: '@ai-sdk/google' } }),
      router: model('router', { provider: { api: 'https://us.api.example.com/v1' } }),
      claude: model('claude', { provider: { npm: '@ai-sdk/anthropic' } }),
      gpt: model('gpt', {
        provider: { npm: '@ai-sdk/openai', api: 'https://api.deepseek.com/v1' },
      }),
    }
    const catalogs = catalogsOf(copyOf(modelsDevFile(models), 0))
    expect(catalogs.deepseek).toEqual([
      { id: 'new', context: 1_000_000 },
      { id: 'gpt', context: 128_000 },
      { id: 'claude', context: 128_000 },
      { id: 'old', context: 128_000 },
    ])
  })

  it('ships a copy with every provider the presets name, each with models', () => {
    const catalogs = catalogsOf(SNAPSHOT)
    expect(CATALOG_IDS.filter((id) => (catalogs[id]?.length ?? 0) === 0)).toEqual([])
  })
})

describe('ModelsDev', () => {
  const snapshot = copyOf(modelsDevFile({ shipped: model('shipped') }), 10 * DAY, '"v1"')
  let now = 10 * DAY
  let requests: Array<Record<string, string>> = []
  let answer: () => Response | Promise<Response>
  const fetch: Fetch = async (url, init) => {
    expect(url).toBe(MODELS_DEV_URL)
    requests.push(init.headers)
    return answer()
  }

  beforeEach(() => {
    now = 10 * DAY
    requests = []
    answer = () => new Response(null, { status: 500 })
  })

  function modelsDev(): ModelsDev {
    return new ModelsDev({ file: savedFile(), fetch, now: () => now, snapshot })
  }

  it('starts with the copy it ships with, and leaves models.dev alone while that is fresh', async () => {
    const models = modelsDev()
    await models.start()
    models.stop()
    expect(models.catalogs().deepseek).toEqual([{ id: 'shipped', context: 128_000 }])
    expect(models.context('deepseek', 'shipped')).toBe(128_000)
    expect(models.context('deepseek', 'missing')).toBeNull()
    expect(requests).toEqual([])
  })

  it('reads models.dev once its copy is a day old, saves it, and tells of the change', async () => {
    now = 11 * DAY
    answer = () =>
      Response.json(modelsDevFile({ fresh: model('fresh') }), { headers: { etag: '"v2"' } })
    const models = modelsDev()
    const told: unknown[] = []
    models.on('changed', (catalogs) => told.push(catalogs.deepseek))
    await models.start()
    models.stop()
    expect(requests).toEqual([{ 'If-None-Match': '"v1"' }])
    expect(models.catalogs().deepseek).toEqual([{ id: 'fresh', context: 128_000 }])
    expect(told).toEqual([[{ id: 'fresh', context: 128_000 }]])
    const saved = JSON.parse(fs.readFileSync(savedFile(), 'utf8')) as ModelsDevCopy
    expect(saved).toMatchObject({ fetchedAt: 11 * DAY, etag: '"v2"' })
    // The next Hoot takes the saved copy, newer than the one it ships with.
    now = 11 * DAY + 1
    const next = modelsDev()
    await next.start()
    next.stop()
    expect(next.catalogs().deepseek).toEqual([{ id: 'fresh', context: 128_000 }])
    expect(requests).toHaveLength(1)
  })

  it('keeps its models when models.dev has not changed, and counts the copy fresh again', async () => {
    now = 11 * DAY
    answer = () => new Response(null, { status: 304 })
    const models = modelsDev()
    const told: unknown[] = []
    models.on('changed', (catalogs) => told.push(catalogs))
    await models.start()
    await models.refreshIfStale()
    models.stop()
    expect(requests).toHaveLength(1)
    expect(told).toEqual([])
    expect(models.catalogs().deepseek).toEqual([{ id: 'shipped', context: 128_000 }])
    expect(JSON.parse(fs.readFileSync(savedFile(), 'utf8'))).toMatchObject({ fetchedAt: 11 * DAY })
  })

  it('keeps its models without a network, and asks again later', async () => {
    now = 11 * DAY
    answer = () => Promise.reject(new TypeError('Failed to fetch'))
    const models = modelsDev()
    await models.start()
    expect(models.catalogs().deepseek).toEqual([{ id: 'shipped', context: 128_000 }])
    expect(fs.existsSync(savedFile())).toBe(false)
    answer = () => Response.json(modelsDevFile({ fresh: model('fresh') }))
    await models.refreshIfStale()
    models.stop()
    expect(requests).toHaveLength(2)
    expect(models.catalogs().deepseek).toEqual([{ id: 'fresh', context: 128_000 }])
  })

  it('keeps the models of a provider models.dev no longer lists', async () => {
    now = 11 * DAY
    const fresh = modelsDevFile({ fresh: model('fresh') })
    delete fresh.openrouter
    answer = () => Response.json(fresh)
    const models = modelsDev()
    await models.start()
    models.stop()
    expect(models.catalogs().deepseek).toEqual([{ id: 'fresh', context: 128_000 }])
    expect(models.catalogs().openrouter).toEqual([{ id: 'shipped', context: 128_000 }])
  })

  it('leaves out a saved copy that lacks a provider this Hoot knows, as an earlier Hoot’s', async () => {
    const saved = copyOf(modelsDevFile({ saved: model('saved') }), 10 * DAY + 1)
    delete saved.catalogs.deepseek
    fs.writeFileSync(savedFile(), JSON.stringify(saved))
    const models = modelsDev()
    await models.start()
    models.stop()
    expect(models.catalogs().deepseek).toEqual([{ id: 'shipped', context: 128_000 }])
  })
})

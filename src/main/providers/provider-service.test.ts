import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import type { AgentLaunchSettings } from '../../shared/launch-settings'
import { OWN_PROVIDER_IDS, type GlobalConfig, type Provider } from '../../shared/providers'
import type { CodingToolId } from '../../shared/tools'
import { openDatabase } from '../database/database'
import { ProviderService, type GlobalReading } from './provider-service'
import { ProviderStore } from './provider-store'

const DEEPSEEK_URL = 'https://api.deepseek.com/anthropic'

/** What a harness's configuration names: nothing, its own models, unless a test says otherwise. */
type Configs = Partial<Record<CodingToolId, GlobalReading>>

function own(signedIn = true, model: string | null = null): GlobalReading {
  return { config: { url: '', apiKey: '', keyHeader: 'bearer', model }, signedIn }
}

function keyed(url: string, apiKey: string, model: string | null = null): GlobalReading {
  return { config: { url, apiKey, keyHeader: 'bearer', model }, signedIn: false }
}

let db: DatabaseSync
let configs: Configs
let written: Array<{ harness: CodingToolId; provider: string; model: string | null }>
let legacy: Partial<Record<CodingToolId, AgentLaunchSettings>>
let ids: number

beforeEach(() => {
  db = openDatabase(':memory:')
  configs = {}
  written = []
  legacy = {}
  ids = 0
})

afterEach(() => db.close())

function service(): ProviderService {
  return new ProviderService({
    store: new ProviderStore(db),
    readGlobal: async (harness) => configs[harness] ?? own(),
    writeGlobal: async (harness, provider, model) => {
      written.push({ harness, provider: provider.id, model })
      const config: GlobalConfig =
        provider.own === null
          ? {
              url: provider.urls.anthropic ?? '',
              apiKey: provider.apiKey,
              keyHeader: 'bearer',
              model,
            }
          : { url: '', apiKey: '', keyHeader: 'bearer', model }
      configs[harness] = { config, signedIn: configs[harness]?.signedIn ?? true }
    },
    legacyLaunchSettings: (harness) => legacy[harness] ?? null,
    now: () => 1_000 + ids,
    newId: () => `id-${++ids}`,
  })
}

const deepseek = {
  name: 'DeepSeek',
  presetId: 'deepseek',
  apiKey: 'sk-deepseek',
  keyHeader: 'bearer' as const,
  urls: { anthropic: DEEPSEEK_URL },
  models: ['deepseek-flash[1m]', 'deepseek-pro'],
}

describe('ProviderService', () => {
  it('makes an agent of each installed harness’s global as Hoot opens, and keeps them', async () => {
    configs.claude = keyed(DEEPSEEK_URL, 'sk-global', 'deepseek-pro')
    configs.codex = own(false)
    // Reading Claude Code's configuration takes a while, until which Hoot is not ready.
    const pending: { read?: () => void } = {}
    const slowDb = openDatabase(':memory:')
    const slow = new ProviderService({
      store: new ProviderStore(slowDb),
      readGlobal: (harness) =>
        new Promise((resolve) => {
          pending.read = () => resolve(configs[harness] ?? own())
        }),
      writeGlobal: async () => {},
    })
    const reading = slow.installedChanged(['claude'])
    await Promise.resolve()
    expect(slow.getState().ready).toBe(false)
    pending.read?.()
    await reading
    expect(slow.getState().ready).toBe(true)
    slowDb.close()

    const providers = service()
    expect(providers.getState().ready).toBe(false)
    const pass = await providers.installedChanged(['claude', 'codex', 'opencode'])
    expect(pass.opening).toBe(true)
    expect(providers.getState().ready).toBe(true)
    const state = providers.getState()
    // The global names no provider yet: one is made of it, from the preset of its address.
    expect(state.providers).toMatchObject([
      { name: 'DeepSeek', presetId: 'deepseek', apiKey: 'sk-global' },
    ])
    expect(state.globals.claude).toEqual({
      providerId: state.providers[0]!.id,
      model: 'deepseek-pro',
      signedIn: false,
    })
    // Codex is signed out of its subscription: no global, no agent. OpenCode's free models need none.
    expect(state.agents.map((agent) => [agent.harness, agent.providerId, agent.model])).toEqual([
      ['claude', state.providers[0]!.id, 'deepseek-pro'],
      ['opencode', OWN_PROVIDER_IDS.opencode, null],
    ])
    // Kept, also by another Hoot on the same database.
    const again = service()
    expect(again.getState().agents).toEqual(state.agents)
    expect(again.getState().providers).toEqual(state.providers)
  })

  it('never changes a provider by what a configuration names, and makes a new one instead', async () => {
    const providers = service()
    const added = providers.addProvider(deepseek)
    if (!added.ok) throw new Error(added.message)
    configs.claude = keyed(DEEPSEEK_URL, 'sk-deepseek', 'deepseek-flash[1m]')
    await providers.installedChanged(['claude'])
    expect(providers.getState().globals.claude?.providerId).toBe(added.provider.id)
    // The same address with another key is another provider.
    configs.claude = keyed(DEEPSEEK_URL, 'sk-other')
    await providers.refreshGlobals()
    const state = providers.getState()
    expect(state.providers.map((provider) => [provider.name, provider.apiKey])).toEqual([
      ['DeepSeek', 'sk-deepseek'],
      ['DeepSeek 2', 'sk-other'],
    ])
    expect(state.globals.claude?.providerId).toBe(state.providers[1]!.id)
    // Reading again finds it, and makes no third.
    await providers.refreshGlobals()
    expect(providers.getState().providers).toHaveLength(2)
    // Only the model changed: the global stays.
    configs.claude = keyed(DEEPSEEK_URL, 'sk-other', 'deepseek-pro')
    await providers.refreshGlobals()
    expect(providers.getState().globals.claude).toMatchObject({
      providerId: state.providers[1]!.id,
      model: 'deepseek-pro',
    })
  })

  it('makes no agent for a harness that has one, also one turned off, and again one that has none', async () => {
    const providers = service()
    await providers.installedChanged(['claude'])
    const [made] = providers.getState().agents
    expect(made).toMatchObject({ harness: 'claude', providerId: OWN_PROVIDER_IDS.claude })
    providers.updateAgent(made!.id, { enabled: false })
    await providers.installedChanged([])
    await providers.installedChanged(['claude'])
    expect(providers.getState().agents).toHaveLength(1)
    // Deleted, it comes back as Hoot opens again, or as the harness gets installed again.
    providers.removeAgent(made!.id)
    await providers.installedChanged(['claude'])
    expect(providers.getState().agents).toHaveLength(0)
    await providers.installedChanged([])
    const pass = await providers.installedChanged(['claude'])
    expect(pass.made).toHaveLength(1)
    expect(service().getState().agents).toHaveLength(1)
  })

  it('gives the first agent of a harness the launch settings an earlier Hoot kept for it', async () => {
    legacy.claude = { enabled: false, model: 'opus', effort: 'max', extraArgs: ['--verbose'] }
    const providers = service()
    await providers.installedChanged(['claude', 'opencode'])
    expect(providers.getState().agents).toMatchObject([
      { harness: 'claude', enabled: false, model: 'opus', effort: 'max', extraArgs: ['--verbose'] },
      { harness: 'opencode', enabled: true, model: null, effort: null, extraArgs: [] },
    ])
  })

  it('writes a global into the harness’s configuration, keeping a model the provider has', async () => {
    const providers = service()
    const added = providers.addProvider(deepseek)
    if (!added.ok) throw new Error(added.message)
    configs.claude = own(true, 'opus')
    await providers.installedChanged(['claude'])
    expect(await providers.setGlobal('claude', added.provider.id)).toEqual({ ok: true })
    // The provider has no opus: its first model.
    expect(written).toEqual([
      { harness: 'claude', provider: added.provider.id, model: 'deepseek-flash[1m]' },
    ])
    expect(providers.getState().globals.claude).toMatchObject({
      providerId: added.provider.id,
      model: 'deepseek-flash[1m]',
    })
    expect(await providers.setGlobalModel('claude', 'deepseek-pro')).toEqual({ ok: true })
    expect(written.at(-1)).toEqual({
      harness: 'claude',
      provider: added.provider.id,
      model: 'deepseek-pro',
    })
    // A global's key changed in Hoot is written there too, with its model.
    const updated = await providers.updateProvider(added.provider.id, { apiKey: 'sk-new' })
    expect(updated.ok).toBe(true)
    expect(written.at(-1)).toEqual({
      harness: 'claude',
      provider: added.provider.id,
      model: 'deepseek-pro',
    })
    expect(configs.claude?.config.apiKey).toBe('sk-new')
    // An agent cannot run a provider without an address in its format.
    const other = providers.addProvider({ ...deepseek, name: 'Gateway', urls: { responses: 'x' } })
    if (!other.ok) throw new Error(other.message)
    expect(await providers.setGlobal('claude', other.provider.id)).toMatchObject({ ok: false })
  })

  it('keeps a provider an agent runs on or a harness has for its global', async () => {
    const providers = service()
    const added = providers.addProvider(deepseek)
    if (!added.ok) throw new Error(added.message)
    await providers.installedChanged(['claude'])
    const agent = providers.addAgent({
      harness: 'claude',
      providerId: added.provider.id,
      model: 'deepseek-pro',
    })
    if (!agent.ok) throw new Error(agent.message)
    expect(providers.removeProvider(added.provider.id)).toMatchObject({ ok: false })
    providers.removeAgent(agent.agent.id)
    await providers.setGlobal('claude', added.provider.id)
    expect(providers.removeProvider(added.provider.id)).toMatchObject({ ok: false })
    await providers.setGlobal('claude', OWN_PROVIDER_IDS.claude)
    expect(providers.removeProvider(added.provider.id)).toEqual({ ok: true })
    expect(service().getState().providers).toEqual([])
  })

  it('refuses agents on providers that are gone or cannot run them', () => {
    const providers = service()
    expect(
      providers.addAgent({ harness: 'claude', providerId: 'gone', model: null }),
    ).toMatchObject({ ok: false })
    expect(
      providers.addAgent({ harness: 'codex', providerId: OWN_PROVIDER_IDS.claude, model: null }),
    ).toMatchObject({ ok: false })
    const made = providers.addAgent({
      harness: 'codex',
      providerId: OWN_PROVIDER_IDS.codex,
      model: null,
    })
    expect(made).toMatchObject({ ok: true, agent: { harness: 'codex', name: null, enabled: true } })
    if (!made.ok) return
    // Its provider changes only to one it can run.
    providers.updateAgent(made.agent.id, { providerId: OWN_PROVIDER_IDS.claude })
    expect(providers.agent(made.agent.id)?.providerId).toBe(OWN_PROVIDER_IDS.codex)
    providers.updateAgent(made.agent.id, { name: '  Plain  ', model: '  ' })
    expect(providers.agent(made.agent.id)).toMatchObject({ name: 'Plain', model: null })
  })

  it('keeps the user’s provider fields as typed, trimmed, with each model once', () => {
    const providers = service()
    const added = providers.addProvider({
      ...deepseek,
      name: '  Mine ',
      apiKey: ' sk-x ',
      urls: { anthropic: ' https://x.example/anthropic ', responses: '  ' },
      models: [' a ', 'a', '', 'b'],
    })
    expect(added).toMatchObject({
      ok: true,
      provider: {
        name: 'Mine',
        apiKey: 'sk-x',
        urls: { anthropic: 'https://x.example/anthropic' },
        models: ['a', 'b'],
      },
    })
    expect(providers.addProvider({ ...deepseek, name: ' ' })).toMatchObject({ ok: false })
    expect(providers.addProvider({ ...deepseek, urls: {} })).toMatchObject({ ok: false })
    const stored = new ProviderStore(db).providers()
    expect(stored.map((provider: Provider) => provider.name)).toEqual(['Mine'])
  })
})

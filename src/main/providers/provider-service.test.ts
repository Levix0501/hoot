import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import type { AgentLaunchSettings } from '../../shared/launch-settings'
import { OWN_PROVIDER_IDS, type GlobalConfig, type Provider } from '../../shared/providers'
import type { CodingToolId } from '../../shared/tools'
import { openDatabase } from '../database/database'
import { ProviderService, type GlobalReading } from './provider-service'
import { ProviderStore } from './provider-store'

const DEEPSEEK_URL = 'https://api.deepseek.com/anthropic'

/** DeepSeek's address for Codex. */
const DEEPSEEK_RESPONSES_URL = 'https://api.deepseek.com'

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
/** The harnesses whose configuration was read, in order. */
let read: CodingToolId[]
let written: Array<{ harness: CodingToolId; provider: string; model: string | null }>
let legacy: Partial<Record<CodingToolId, AgentLaunchSettings>>
let ids: number

beforeEach(() => {
  db = openDatabase(':memory:')
  configs = {}
  read = []
  written = []
  legacy = {}
  ids = 0
})

afterEach(() => db.close())

function service(): ProviderService {
  return new ProviderService({
    store: new ProviderStore(db),
    readGlobal: async (harness) => {
      read.push(harness)
      return configs[harness] ?? own()
    },
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
    catalogs: () => ({}),
    legacyLaunchSettings: (harness) => legacy[harness] ?? null,
    now: () => 1_000 + ids,
    newId: () => `id-${++ids}`,
  })
}

const deepseek = {
  name: 'DeepSeek',
  presetId: 'deepseek',
  planId: null,
  apiKey: 'sk-deepseek',
  keyHeader: 'bearer' as const,
  urls: { anthropic: DEEPSEEK_URL },
  models: ['deepseek-flash[1m]', 'deepseek-pro'],
  cloud: null,
}

describe('ProviderService', () => {
  it('makes an agent of each installed harness’s global as Hoot opens, and keeps them', async () => {
    configs.codex = keyed(DEEPSEEK_RESPONSES_URL, 'sk-global', 'deepseek-pro')
    // Reading OpenCode's configuration takes a while, until which Hoot is not ready.
    const pending: { read?: () => void } = {}
    const slowDb = openDatabase(':memory:')
    const slow = new ProviderService({
      store: new ProviderStore(slowDb),
      readGlobal: (harness) =>
        new Promise((resolve) => {
          pending.read = () => resolve(configs[harness] ?? own())
        }),
      writeGlobal: async () => {},
      catalogs: () => ({}),
    })
    const reading = slow.installedChanged(['opencode'])
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
    expect(state.globals.codex).toEqual({
      providerId: state.providers[0]!.id,
      model: 'deepseek-pro',
      signedIn: false,
    })
    // OpenCode's free models need no sign-in.
    expect(state.agents.map((agent) => [agent.harness, agent.providerId, agent.model])).toEqual([
      ['codex', state.providers[0]!.id, 'deepseek-pro'],
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
    configs.opencode = keyed(DEEPSEEK_URL, 'sk-deepseek', 'deepseek-flash[1m]')
    await providers.installedChanged(['opencode'])
    expect(providers.getState().globals.opencode?.providerId).toBe(added.provider.id)
    // The same address with another key is another provider.
    configs.opencode = keyed(DEEPSEEK_URL, 'sk-other')
    await providers.refreshGlobals()
    const state = providers.getState()
    expect(state.providers.map((provider) => [provider.name, provider.apiKey])).toEqual([
      ['DeepSeek', 'sk-deepseek'],
      ['DeepSeek 2', 'sk-other'],
    ])
    expect(state.globals.opencode?.providerId).toBe(state.providers[1]!.id)
    // Reading again finds it, and makes no third.
    await providers.refreshGlobals()
    expect(providers.getState().providers).toHaveLength(2)
    // Only the model changed: the global stays.
    configs.opencode = keyed(DEEPSEEK_URL, 'sk-other', 'deepseek-pro')
    await providers.refreshGlobals()
    expect(providers.getState().globals.opencode).toMatchObject({
      providerId: state.providers[1]!.id,
      model: 'deepseek-pro',
    })
  })

  it('makes no agent for a harness that has one, also one turned off, and again one that has none', async () => {
    const providers = service()
    await providers.installedChanged(['opencode'])
    const [made] = providers.getState().agents
    expect(made).toMatchObject({ harness: 'opencode', providerId: OWN_PROVIDER_IDS.opencode })
    providers.updateAgent(made!.id, { enabled: false })
    await providers.installedChanged([])
    await providers.installedChanged(['opencode'])
    expect(providers.getState().agents).toHaveLength(1)
    // Deleted, it comes back as Hoot opens again, or as the harness gets installed again.
    providers.removeAgent(made!.id)
    await providers.installedChanged(['opencode'])
    expect(providers.getState().agents).toHaveLength(0)
    await providers.installedChanged([])
    const pass = await providers.installedChanged(['opencode'])
    expect(pass.made).toHaveLength(1)
    expect(service().getState().agents).toHaveLength(1)
  })

  it('gives the first agent of a harness the launch settings an earlier Hoot kept for it', async () => {
    legacy.codex = { enabled: false, model: 'gpt-6', effort: 'high', extraArgs: ['--search'] }
    configs.codex = keyed(DEEPSEEK_RESPONSES_URL, 'sk-global')
    const providers = service()
    await providers.installedChanged(['codex', 'opencode'])
    expect(providers.getState().agents).toMatchObject([
      { harness: 'codex', enabled: false, model: 'gpt-6', effort: 'high', extraArgs: ['--search'] },
      { harness: 'opencode', enabled: true, model: null, effort: null, extraArgs: [] },
    ])
  })

  it('writes a global into the harness’s configuration, keeping a model the provider has', async () => {
    const providers = service()
    const added = providers.addProvider(deepseek)
    if (!added.ok) throw new Error(added.message)
    configs.opencode = own(true, 'big-pickle')
    await providers.installedChanged(['opencode'])
    expect(await providers.setGlobal('opencode', added.provider.id)).toEqual({ ok: true })
    // The provider has no big-pickle: its first model.
    expect(written).toEqual([
      { harness: 'opencode', provider: added.provider.id, model: 'deepseek-flash[1m]' },
    ])
    expect(providers.getState().globals.opencode).toMatchObject({
      providerId: added.provider.id,
      model: 'deepseek-flash[1m]',
    })
    expect(await providers.setGlobalModel('opencode', 'deepseek-pro')).toEqual({ ok: true })
    expect(written.at(-1)).toEqual({
      harness: 'opencode',
      provider: added.provider.id,
      model: 'deepseek-pro',
    })
    // A global's key changed in Hoot is written there too, with its model.
    const updated = await providers.updateProvider(added.provider.id, { apiKey: 'sk-new' })
    expect(updated.ok).toBe(true)
    expect(written.at(-1)).toEqual({
      harness: 'opencode',
      provider: added.provider.id,
      model: 'deepseek-pro',
    })
    expect(configs.opencode?.config.apiKey).toBe('sk-new')
    // An agent cannot run a provider without an address in its format.
    const other = providers.addProvider({ ...deepseek, name: 'Gateway', urls: { responses: 'x' } })
    if (!other.ok) throw new Error(other.message)
    expect(await providers.setGlobal('opencode', other.provider.id)).toMatchObject({ ok: false })
  })

  it('keeps a provider an agent runs on or a harness has for its global', async () => {
    const providers = service()
    const added = providers.addProvider(deepseek)
    if (!added.ok) throw new Error(added.message)
    await providers.installedChanged(['claude', 'opencode'])
    const agent = providers.addAgent({
      harness: 'claude',
      providerId: added.provider.id,
      model: 'deepseek-pro',
    })
    if (!agent.ok) throw new Error(agent.message)
    expect(providers.removeProvider(added.provider.id)).toMatchObject({ ok: false })
    providers.removeAgent(agent.agent.id)
    await providers.setGlobal('opencode', added.provider.id)
    expect(providers.removeProvider(added.provider.id)).toMatchObject({ ok: false })
    await providers.setGlobal('opencode', OWN_PROVIDER_IDS.opencode)
    expect(providers.removeProvider(added.provider.id)).toEqual({ ok: true })
    expect(service().getState().providers).toEqual([])
  })

  it('leaves Claude Code’s own settings alone: no global, no agent made of them, nothing written', async () => {
    configs.claude = keyed(DEEPSEEK_URL, 'sk-global', 'deepseek-pro')
    // Signed out of its subscription, Codex has no global either.
    configs.codex = own(false)
    legacy.claude = { enabled: true, model: 'opus', effort: null, extraArgs: [] }
    const providers = service()
    const pass = await providers.installedChanged(['claude', 'codex'])
    expect(read).toEqual(['codex'])
    expect(pass.made).toEqual([])
    expect(providers.getState()).toMatchObject({ providers: [], agents: [], ready: true })
    expect(providers.getState().globals.claude).toBeUndefined()
    // Not when the window gets the focus either.
    await providers.refreshGlobals()
    expect(read).toEqual(['codex', 'codex'])
    const added = providers.addProvider(deepseek)
    if (!added.ok) throw new Error(added.message)
    expect(await providers.setGlobal('claude', added.provider.id)).toMatchObject({ ok: false })
    expect(await providers.setGlobalModel('claude', 'deepseek-pro')).toMatchObject({ ok: false })
    expect(await providers.updateProvider(added.provider.id, { apiKey: 'sk-new' })).toMatchObject({
      ok: true,
    })
    expect(written).toEqual([])
    // Its agents are made by hand.
    expect(
      providers.addAgent({ harness: 'claude', providerId: OWN_PROVIDER_IDS.claude, model: null }),
    ).toMatchObject({ ok: true, agent: { harness: 'claude', model: null } })
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

  it('keeps the models a Claude Code agent maps Claude Code’s roles to, as Hoot opens again', () => {
    const providers = service()
    const added = providers.addProvider(deepseek)
    if (!added.ok) throw new Error(added.message)
    const made = providers.addAgent({
      harness: 'claude',
      providerId: added.provider.id,
      model: 'deepseek-pro',
      modelMap: { haiku: ' deepseek-pro ', fable: '' },
    })
    if (!made.ok) throw new Error(made.message)
    expect(made.agent.modelMap).toEqual({ haiku: 'deepseek-pro' })
    providers.updateAgent(made.agent.id, { modelMap: { opus: 'deepseek-flash[1m]' } })
    expect(service().agent(made.agent.id)?.modelMap).toEqual({ opus: 'deepseek-flash[1m]' })
    // One made without a map has every role on its model.
    const plain = providers.addAgent({
      harness: 'claude',
      providerId: added.provider.id,
      model: null,
    })
    expect(plain.ok && plain.agent.modelMap).toEqual({})
    // One made with an effort level and arguments keeps them.
    const tuned = providers.addAgent({
      harness: 'claude',
      providerId: added.provider.id,
      model: 'deepseek-pro',
      effort: 'max',
      extraArgs: ['--verbose'],
    })
    if (!tuned.ok) throw new Error(tuned.message)
    expect(service().agent(tuned.agent.id)).toMatchObject({
      effort: 'max',
      extraArgs: ['--verbose'],
    })
    // A map this Hoot cannot read counts as none, a role it does not know as left out.
    db.prepare('UPDATE agents SET model_map = ? WHERE id = ?').run('[1]', made.agent.id)
    expect(service().agent(made.agent.id)?.modelMap).toEqual({})
    db.prepare('UPDATE agents SET model_map = ? WHERE id = ?').run(
      '{"gpt": "x", "sonnet": "deepseek-pro", "haiku": 3}',
      made.agent.id,
    )
    expect(service().agent(made.agent.id)?.modelMap).toEqual({ sonnet: 'deepseek-pro' })
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

  it('keeps the cloud Claude Code reaches a provider through, which needs no address', async () => {
    const providers = service()
    const added = providers.addProvider({
      ...deepseek,
      name: 'Vertex AI',
      presetId: 'vertex',
      planId: 'global',
      apiKey: '',
      urls: {},
      cloud: { kind: 'vertex', region: ' global ', project: ' my-project ' },
    })
    expect(added).toMatchObject({
      ok: true,
      provider: {
        planId: 'global',
        cloud: { kind: 'vertex', region: 'global', project: 'my-project' },
      },
    })
    const id = added.ok ? added.provider.id : ''
    await providers.updateProvider(id, {
      presetId: 'bedrock',
      planId: 'eu-west-1',
      cloud: { kind: 'bedrock', region: 'eu-west-1' },
    })
    const stored = new ProviderStore(db).providers()
    expect(stored.find((provider) => provider.id === id)).toMatchObject({
      presetId: 'bedrock',
      planId: 'eu-west-1',
      cloud: { kind: 'bedrock', region: 'eu-west-1' },
    })
    expect(stored.every((provider) => provider.id === id || provider.cloud === null)).toBe(true)
  })
})

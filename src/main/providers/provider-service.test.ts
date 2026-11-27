import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { OWN_PROVIDER_IDS, type Provider } from '../../shared/providers'
import { openDatabase } from '../database/database'
import { ProviderService } from './provider-service'
import { ProviderStore } from './provider-store'

const DEEPSEEK_URL = 'https://api.deepseek.com/anthropic'

/** DeepSeek's address for Codex. */
const DEEPSEEK_RESPONSES_URL = 'https://api.deepseek.com'

let db: DatabaseSync
let ids: number

beforeEach(() => {
  db = openDatabase(':memory:')
  ids = 0
})

afterEach(() => db.close())

function service(): ProviderService {
  return new ProviderService({
    store: new ProviderStore(db),
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
  it('makes agents by hand on the user’s providers they can run, and none on a harness’s own models', () => {
    const providers = service()
    expect(providers.getState()).toEqual({ providers: [], agents: [] })
    const added = providers.addProvider({
      ...deepseek,
      urls: { anthropic: DEEPSEEK_URL, responses: DEEPSEEK_RESPONSES_URL },
    })
    if (!added.ok) throw new Error(added.message)
    expect(providers.getState().agents).toEqual([])
    for (const harness of ['claude', 'codex', 'opencode'] as const) {
      expect(
        providers.addAgent({ harness, providerId: added.provider.id, model: 'deepseek-pro' }),
      ).toMatchObject({ ok: true, agent: { harness, model: 'deepseek-pro', enabled: true } })
    }
    for (const harness of ['claude', 'codex', 'opencode', 'antigravity'] as const) {
      expect(
        providers.addAgent({ harness, providerId: OWN_PROVIDER_IDS[harness], model: null }),
      ).toMatchObject({ ok: false })
    }
    expect(
      service()
        .getState()
        .agents.map((agent) => agent.harness),
    ).toEqual(['claude', 'codex', 'opencode'])
  })

  it('makes the agent of each installed harness’s own models once, turned off, and keeps it', () => {
    const providers = service()
    const changes: number[] = []
    providers.on('changed', (state) => changes.push(state.agents.length))
    providers.ensureOwnAgents(['claude', 'opencode'])
    expect(providers.getState().agents).toMatchObject([
      { harness: 'claude', providerId: OWN_PROVIDER_IDS.claude, name: null, enabled: false },
      { harness: 'opencode', providerId: OWN_PROVIDER_IDS.opencode, name: null, enabled: false },
    ])
    expect(changes).toEqual([2])
    // Once made, it is not made again, turned on or not, nor as Hoot opens again.
    const claude = providers.getState().agents[0]
    if (claude === undefined) throw new Error('No agent of Claude Code’s own models.')
    providers.updateAgent(claude.id, { enabled: true, model: 'opus' })
    providers.ensureOwnAgents(['claude', 'opencode'])
    const reopened = service()
    reopened.ensureOwnAgents(['claude', 'codex', 'opencode', 'antigravity'])
    expect(reopened.getState().agents.map((agent) => [agent.providerId, agent.enabled])).toEqual([
      [OWN_PROVIDER_IDS.claude, true],
      [OWN_PROVIDER_IDS.opencode, false],
      [OWN_PROVIDER_IDS.codex, false],
      [OWN_PROVIDER_IDS.antigravity, false],
    ])
    expect(changes).toEqual([2, 2])
    // Nor can it be deleted, as its harness is uninstalled too.
    reopened.ensureOwnAgents([])
    reopened.removeAgent(claude.id)
    expect(service().agent(claude.id)).toMatchObject({ model: 'opus' })
  })

  it('makes no agent of a harness’s own models where one was made by hand before', () => {
    const insert = db.prepare(
      `INSERT INTO agents (id, harness, provider_id, name, enabled, model, effort, extra_args,
       model_map, created_at) VALUES (?, 'claude', ?, NULL, 1, ?, NULL, '[]', '{}', ?)`,
    )
    insert.run('opus', OWN_PROVIDER_IDS.claude, 'opus', 1)
    insert.run('sonnet', OWN_PROVIDER_IDS.claude, 'sonnet', 2)
    const providers = service()
    providers.ensureOwnAgents(['claude'])
    expect(providers.getState().agents.map((agent) => agent.id)).toEqual(['opus', 'sonnet'])
    // Either can be deleted, until one is left.
    providers.removeAgent('opus')
    providers.removeAgent('sonnet')
    expect(service().getState().agents).toMatchObject([{ id: 'sonnet', enabled: true }])
  })

  it('keeps an agent on its harness’s own models there, and every other agent off them', () => {
    const providers = service()
    providers.ensureOwnAgents(['claude'])
    const own = providers.getState().agents[0]
    const added = providers.addProvider(deepseek)
    if (!added.ok || own === undefined) throw new Error('No provider or agent to change.')
    const made = providers.addAgent({
      harness: 'claude',
      providerId: added.provider.id,
      model: null,
    })
    if (!made.ok) throw new Error(made.message)
    providers.updateAgent(own.id, { providerId: added.provider.id, model: 'deepseek-pro' })
    providers.updateAgent(made.agent.id, { providerId: OWN_PROVIDER_IDS.claude })
    expect(service().getState().agents).toMatchObject([
      { id: own.id, providerId: OWN_PROVIDER_IDS.claude, model: null },
      { id: made.agent.id, providerId: added.provider.id },
    ])
  })

  it('keeps a provider an agent runs on', () => {
    const providers = service()
    const added = providers.addProvider(deepseek)
    if (!added.ok) throw new Error(added.message)
    const agent = providers.addAgent({
      harness: 'claude',
      providerId: added.provider.id,
      model: 'deepseek-pro',
    })
    if (!agent.ok) throw new Error(agent.message)
    expect(providers.removeProvider(added.provider.id)).toMatchObject({ ok: false })
    providers.removeAgent(agent.agent.id)
    expect(providers.removeProvider(added.provider.id)).toEqual({ ok: true })
    expect(service().getState().providers).toEqual([])
  })

  it('changes a provider as it is asked, keeping what it is not', () => {
    const providers = service()
    const added = providers.addProvider(deepseek)
    if (!added.ok) throw new Error(added.message)
    expect(providers.updateProvider(added.provider.id, { apiKey: ' sk-new ' })).toMatchObject({
      ok: true,
      provider: { apiKey: 'sk-new', models: deepseek.models },
    })
    expect(providers.updateProvider(added.provider.id, { urls: {} })).toMatchObject({ ok: false })
    expect(providers.updateProvider('gone', { name: 'x' })).toMatchObject({ ok: false })
    expect(service().provider(added.provider.id)).toMatchObject({ apiKey: 'sk-new' })
  })

  it('refuses agents on providers that are gone or cannot run them', () => {
    const providers = service()
    expect(
      providers.addAgent({ harness: 'claude', providerId: 'gone', model: null }),
    ).toMatchObject({ ok: false })
    expect(
      providers.addAgent({ harness: 'codex', providerId: OWN_PROVIDER_IDS.claude, model: null }),
    ).toMatchObject({ ok: false })
    const added = providers.addProvider(deepseek)
    if (!added.ok) throw new Error(added.message)
    // DeepSeek here serves Claude Code alone.
    expect(
      providers.addAgent({ harness: 'codex', providerId: added.provider.id, model: null }),
    ).toMatchObject({ ok: false })
    const made = providers.addAgent({
      harness: 'claude',
      providerId: added.provider.id,
      model: null,
    })
    expect(made).toMatchObject({
      ok: true,
      agent: { harness: 'claude', name: null, enabled: true },
    })
    if (!made.ok) return
    // Its provider changes only to one it can run.
    providers.updateAgent(made.agent.id, { providerId: 'gone' })
    expect(providers.agent(made.agent.id)?.providerId).toBe(added.provider.id)
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

  it('keeps the cloud Claude Code reaches a provider through, which needs no address', () => {
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
    providers.updateProvider(id, {
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

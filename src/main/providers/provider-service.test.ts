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
  it('makes no agent by itself: each is made by hand, on a provider it can run', () => {
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
      ).toMatchObject({ ok: true, agent: { harness, model: 'deepseek-pro' } })
    }
    expect(
      providers.addAgent({
        harness: 'opencode',
        providerId: OWN_PROVIDER_IDS.opencode,
        model: null,
      }),
    ).toMatchObject({ ok: true, agent: { harness: 'opencode', model: null } })
    expect(
      service()
        .getState()
        .agents.map((agent) => agent.harness),
    ).toEqual(['claude', 'codex', 'opencode', 'opencode'])
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

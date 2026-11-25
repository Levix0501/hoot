import { describe, expect, it } from 'vitest'
import {
  agentName,
  agentsToMake,
  canRun,
  findProvider,
  freeProviderName,
  hasGlobal,
  maskKey,
  namesProvider,
  firstPicks,
  OWN_PROVIDER_IDS,
  ownProvider,
  presetById,
  presetHarnesses,
  presetPlanOfUrl,
  presetPlans,
  PROVIDER_PRESETS,
  providerFromConfig,
  providerMark,
  providerNamed,
  providerPlan,
  sessionAgent,
  usableAgents,
  type Agent,
  type GlobalConfig,
  type Provider,
} from './providers'

const deepseek: Provider = {
  id: 'p-deepseek',
  name: 'DeepSeek',
  presetId: 'deepseek',
  planId: null,
  apiKey: 'sk-deepseek',
  keyHeader: 'bearer',
  urls: { anthropic: 'https://api.deepseek.com/anthropic' },
  models: ['deepseek-flash[1m]', 'deepseek-pro'],
  cloud: null,
  own: null,
}

const kimi: Provider = {
  id: 'p-kimi',
  name: 'Kimi',
  presetId: 'kimi',
  planId: null,
  apiKey: 'sk-kimi',
  keyHeader: 'bearer',
  urls: { anthropic: 'https://api.moonshot.cn/anthropic' },
  models: ['kimi-k3.1-pro'],
  cloud: null,
  own: null,
}

function agent(id: string, change: Partial<Agent> = {}): Agent {
  return {
    id,
    harness: 'claude',
    providerId: deepseek.id,
    name: null,
    enabled: true,
    model: null,
    effort: null,
    extraArgs: [],
    createdAt: 1,
    ...change,
  }
}

/** Claude Code's global, by provider, signed in to its subscription or not. */
function claudeGlobal(providerId: string, signedIn: boolean) {
  return { providers: [deepseek], globals: { claude: { providerId, model: null, signedIn } } }
}

function config(change: Partial<GlobalConfig> = {}): GlobalConfig {
  return { url: '', apiKey: '', keyHeader: 'bearer', model: null, ...change }
}

describe('providers', () => {
  it('runs a provider only on the agents that speak one of its formats', () => {
    expect(canRun(deepseek, 'claude')).toBe(true)
    expect(canRun(deepseek, 'codex')).toBe(false)
    expect(canRun(ownProvider('claude'), 'claude')).toBe(true)
    expect(canRun(ownProvider('claude'), 'codex')).toBe(false)
    expect(canRun(ownProvider('opencode'), 'opencode')).toBe(true)
  })

  it('finds the agents’ own models by their ids, and the user’s providers by theirs', () => {
    expect(findProvider([deepseek], OWN_PROVIDER_IDS.claude)?.name).toBe('Claude subscription')
    expect(findProvider([deepseek], OWN_PROVIDER_IDS.codex)?.own).toBe('codex')
    expect(findProvider([deepseek], 'p-deepseek')).toBe(deepseek)
    expect(findProvider([deepseek], 'p-gone')).toBeUndefined()
  })

  it('draws the mark of a provider’s preset, of its own agent’s maker, or a plain one', () => {
    expect(providerMark(deepseek)).toBe('deepseek')
    expect(providerMark(ownProvider('claude'))).toBe('anthropic')
    expect(providerMark(ownProvider('codex'))).toBe('openai')
    expect(providerMark({ presetId: null, own: null })).toBe('custom')
  })

  it('tells a configuration by its address and key, not its model', () => {
    const named = config({
      url: 'https://api.deepseek.com/anthropic/',
      apiKey: 'sk-deepseek',
      model: 'other-model',
    })
    expect(namesProvider(deepseek, 'claude', named)).toBe(true)
    expect(namesProvider(deepseek, 'claude', { ...named, apiKey: 'sk-new' })).toBe(false)
    expect(namesProvider(ownProvider('claude'), 'claude', config())).toBe(true)
    expect(namesProvider(ownProvider('claude'), 'claude', named)).toBe(false)
  })

  it('keeps the global that the configuration still names, else finds another', () => {
    const twin = { ...deepseek, id: 'p-twin', name: 'DeepSeek 2' }
    const named = config({ url: deepseek.urls.anthropic, apiKey: 'sk-deepseek' })
    expect(providerNamed([deepseek, twin], 'claude', named, 'p-twin')?.id).toBe('p-twin')
    expect(providerNamed([deepseek, twin], 'claude', named, 'p-kimi')?.id).toBe('p-deepseek')
    expect(providerNamed([deepseek], 'claude', config(), 'p-deepseek')?.id).toBe(
      OWN_PROVIDER_IDS.claude,
    )
    expect(providerNamed([deepseek], 'claude', { ...named, apiKey: 'sk-new' }, null)).toBeNull()
  })

  it('makes a provider of a configuration from the preset of its address, numbered when taken', () => {
    const catalogs = {
      deepseek: [
        { id: 'deepseek-flash', context: 1_000_000 },
        { id: 'deepseek-pro', context: 128_000 },
      ],
    }
    const made = providerFromConfig(
      [deepseek],
      'claude',
      {
        url: 'https://api.deepseek.com/anthropic',
        apiKey: 'sk-new',
        keyHeader: 'bearer',
        model: 'deepseek-pro',
      },
      catalogs,
    )
    expect(made).toEqual({
      name: 'DeepSeek 2',
      presetId: 'deepseek',
      planId: null,
      apiKey: 'sk-new',
      keyHeader: 'bearer',
      urls: {
        anthropic: 'https://api.deepseek.com/anthropic',
        responses: 'https://api.deepseek.com',
      },
      models: ['deepseek-flash', 'deepseek-pro'],
      cloud: null,
    })
    const unknown = providerFromConfig(
      [],
      'claude',
      {
        url: ' https://gateway.example.com/v1 ',
        apiKey: 'sk-x',
        keyHeader: 'x-api-key',
        model: null,
      },
      catalogs,
    )
    expect(unknown).toMatchObject({
      name: 'gateway.example.com',
      presetId: null,
      planId: null,
      urls: { anthropic: 'https://gateway.example.com/v1' },
      models: [],
      keyHeader: 'x-api-key',
    })
    expect(freeProviderName([deepseek, { ...kimi, name: 'DeepSeek 2' }], 'DeepSeek')).toBe(
      'DeepSeek 3',
    )
  })

  it('counts a subscription as a global only while signed in, and OpenCode’s free models always', () => {
    expect(hasGlobal(claudeGlobal(OWN_PROVIDER_IDS.claude, true), 'claude')).toBe(true)
    expect(hasGlobal(claudeGlobal(OWN_PROVIDER_IDS.claude, false), 'claude')).toBe(false)
    expect(hasGlobal(claudeGlobal('p-deepseek', false), 'claude')).toBe(true)
    expect(hasGlobal(claudeGlobal('p-gone', true), 'claude')).toBe(false)
    expect(hasGlobal(claudeGlobal(OWN_PROVIDER_IDS.claude, true), 'codex')).toBe(false)
    expect(
      hasGlobal(
        {
          providers: [],
          globals: {
            opencode: { providerId: OWN_PROVIDER_IDS.opencode, model: null, signedIn: false },
          },
        },
        'opencode',
      ),
    ).toBe(true)
  })

  it('makes an agent of the global of each harness that has none', () => {
    const globals = {
      claude: { providerId: 'p-deepseek', model: 'deepseek-pro', signedIn: false },
      codex: { providerId: OWN_PROVIDER_IDS.codex, model: null, signedIn: true },
      opencode: { providerId: OWN_PROVIDER_IDS.opencode, model: null, signedIn: false },
    }
    expect(
      agentsToMake({ providers: [deepseek], agents: [], globals }, ['claude', 'codex', 'opencode']),
    ).toEqual([
      { harness: 'claude', providerId: 'p-deepseek', model: 'deepseek-pro' },
      { harness: 'codex', providerId: OWN_PROVIDER_IDS.codex, model: null },
      { harness: 'opencode', providerId: OWN_PROVIDER_IDS.opencode, model: null },
    ])
    // A harness with an agent, even one turned off, gets none.
    expect(
      agentsToMake({ providers: [deepseek], agents: [agent('a', { enabled: false })], globals }, [
        'claude',
      ]),
    ).toEqual([])
  })

  it('names an agent after its provider, its harness on its own models, or as the user named it', () => {
    const own = agent('own', { providerId: OWN_PROVIDER_IDS.claude })
    const pro = agent('pro', { model: 'deepseek-pro' })
    const two = { providers: [deepseek], agents: [own, pro] }
    expect(agentName(own, two)).toBe('Claude Code')
    expect(agentName(pro, two)).toBe('DeepSeek')
    const flash = agent('flash')
    const both = { providers: [deepseek], agents: [own, pro, flash] }
    expect(agentName(pro, both)).toBe('DeepSeek · deepseek-pro')
    expect(agentName(flash, both)).toBe('DeepSeek · Default')
    expect(agentName({ ...flash, name: '  Fast  ' }, both)).toBe('Fast')
    // Another harness's agent on the same provider is no sibling.
    const opencode = agent('oc', { harness: 'opencode' })
    expect(agentName(pro, { providers: [deepseek], agents: [own, pro, opencode] })).toBe('DeepSeek')
  })

  it('offers the agents turned on, of installed harnesses, on providers they can run, by harness', () => {
    const agents = [
      agent('codex', { harness: 'codex', providerId: OWN_PROVIDER_IDS.codex, createdAt: 1 }),
      agent('kimi', { providerId: 'p-kimi', createdAt: 2 }),
      agent('off', { enabled: false, createdAt: 3 }),
      agent('gone', { providerId: 'p-gone', createdAt: 4 }),
      agent('own', { providerId: OWN_PROVIDER_IDS.claude, createdAt: 5 }),
      agent('oc', { harness: 'opencode', providerId: OWN_PROVIDER_IDS.opencode, createdAt: 6 }),
    ]
    const usable = usableAgents({ providers: [deepseek, kimi], agents }, (h) => h !== 'opencode')
    expect(usable.map((entry) => entry.id)).toEqual(['kimi', 'own', 'codex'])
    expect(sessionAgent(usable, 'own')?.id).toBe('own')
    expect(sessionAgent(usable, 'own', 'codex')?.id).toBe('codex')
    expect(sessionAgent(usable, 'off')?.id).toBe('kimi')
    expect(sessionAgent([], 'own')).toBeNull()
  })

  it('shows a key by its first characters and its last four', () => {
    expect(maskKey('sk-1234567890abcd')).toBe('sk-••••abcd')
    expect(maskKey('short')).toBe('••••')
    expect(maskKey('')).toBe('')
  })
})

const harnesses = (id: string) => presetHarnesses(presetById(id)!)

/** DeepSeek's provider, changed. */
const on = (change: Partial<Provider>): Provider => ({ ...deepseek, ...change })

const models = (count: number) => Array.from({ length: count }, (_, i) => `m${i}`)

describe('presets', () => {
  it('lists makers of models and gateways, each by name, with ids and plans of their own', () => {
    const ids = PROVIDER_PRESETS.map((preset) => preset.id)
    expect(new Set(ids).size).toBe(ids.length)
    const names = PROVIDER_PRESETS.map((preset) => preset.name)
    expect(names).toEqual(
      names.toSorted((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })),
    )
    for (const preset of PROVIDER_PRESETS) {
      // Plans, or addresses of its own, never both.
      expect(preset.plans === undefined || preset.urls === undefined).toBe(true)
      const plans = presetPlans(preset)
      expect(plans.length).toBeGreaterThan(0)
      expect(new Set(plans.map((plan) => plan.id)).size).toBe(plans.length)
      for (const url of plans.flatMap((plan) => Object.values(plan.urls))) {
        expect(url).toMatch(/^https:\/\/[^\s]+$/)
      }
    }
    // Only a cloud's plans, and the user's own resource, have no address.
    const addressless = PROVIDER_PRESETS.filter(
      (preset) => preset.cloud === undefined && preset.endpoint === undefined,
    ).flatMap((preset) =>
      presetPlans(preset)
        .filter((plan) => Object.keys(plan.urls).length === 0)
        .map((plan) => `${preset.id}/${plan.id}`),
    )
    expect(addressless).toEqual([])
  })

  it('tells which agents can run a preset', () => {
    expect(harnesses('deepseek')).toEqual(['claude', 'codex', 'opencode'])
    expect(harnesses('openrouter')).toEqual(['claude', 'codex', 'opencode'])
    expect(harnesses('siliconflow')).toEqual(['claude', 'opencode'])
    expect(harnesses('openai')).toEqual(['codex'])
    expect(harnesses('azure')).toEqual(['codex'])
    expect(harnesses('vertex')).toEqual(['claude'])
  })

  it('finds the plan a provider is on: the one it names, else by its addresses or region', () => {
    const zhipu = {
      anthropic: 'https://open.bigmodel.cn/api/anthropic',
      responses: 'https://open.bigmodel.cn/api/v1',
    }
    // Zhipu's plans share their addresses: the plan named tells them apart.
    expect(providerPlan(on({ presetId: 'zhipu', planId: 'api', urls: zhipu }))?.plan.id).toBe('api')
    // One made before plans: the plan whose addresses its are, the first that has them.
    expect(providerPlan(on({ presetId: 'zhipu', urls: zhipu }))?.plan.id).toBe('coding')
    const kimiAt = (url: string) =>
      on({ presetId: 'kimi', urls: { anthropic: `${url}/anthropic/`, responses: `${url}/v1` } })
    expect(providerPlan(kimiAt('https://api.moonshot.ai'))?.plan.id).toBe('global')
    expect(providerPlan(kimiAt('https://elsewhere.example.com'))).toBeUndefined()
    // A plan its preset no longer has: by its addresses.
    expect(providerPlan({ ...kimiAt('https://api.moonshot.cn'), planId: 'gone' })?.plan.id).toBe(
      'cn',
    )
    const vertex = on({
      presetId: 'vertex',
      urls: {},
      cloud: { kind: 'vertex', region: 'eu', project: 'p' },
    })
    expect(providerPlan(vertex)?.plan.id).toBe('eu')
    expect(providerPlan(on({ presetId: null }))).toBeUndefined()
  })

  it('finds the preset and plan of an address in a harness’s formats', () => {
    const found = presetPlanOfUrl('https://api.moonshot.ai/v1/', 'codex')
    expect([found?.preset.id, found?.plan.id]).toEqual(['kimi', 'global'])
    expect(presetPlanOfUrl('https://api.moonshot.ai/v1', 'claude')).toBeUndefined()
    expect(presetPlanOfUrl(' ', 'claude')).toBeUndefined()
  })

  it('runs a cloud’s provider on Claude Code alone, without an address', () => {
    const vertex: Provider = {
      ...deepseek,
      urls: {},
      cloud: { kind: 'vertex', region: 'global', project: 'p' },
    }
    expect(canRun(vertex, 'claude')).toBe(true)
    expect(canRun(vertex, 'codex')).toBe(false)
    expect(canRun(vertex, 'opencode')).toBe(false)
  })

  it('picks a short list of models whole as a provider is made, a long one not at all', () => {
    expect(firstPicks(models(12))).toEqual(models(12))
    expect(firstPicks(models(13))).toEqual([])
  })
})

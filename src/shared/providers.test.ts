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
  OWN_PROVIDER_IDS,
  ownProvider,
  providerFromConfig,
  providerMark,
  providerNamed,
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
  apiKey: 'sk-deepseek',
  keyHeader: 'bearer',
  urls: { anthropic: 'https://api.deepseek.com/anthropic' },
  models: ['deepseek-flash[1m]', 'deepseek-pro'],
  own: null,
}

const kimi: Provider = {
  id: 'p-kimi',
  name: 'Kimi',
  presetId: 'kimi',
  apiKey: 'sk-kimi',
  keyHeader: 'bearer',
  urls: { anthropic: 'https://api.moonshot.cn/anthropic' },
  models: ['kimi-k3.1-pro'],
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
    const made = providerFromConfig([deepseek], 'claude', {
      url: 'https://api.deepseek.com/anthropic',
      apiKey: 'sk-new',
      keyHeader: 'bearer',
      model: 'deepseek-pro',
    })
    expect(made).toEqual({
      name: 'DeepSeek 2',
      presetId: 'deepseek',
      apiKey: 'sk-new',
      keyHeader: 'bearer',
      urls: { anthropic: 'https://api.deepseek.com/anthropic' },
      models: ['deepseek-pro', 'deepseek-flash[1m]'],
    })
    const unknown = providerFromConfig([], 'claude', {
      url: ' https://gateway.example.com/v1 ',
      apiKey: 'sk-x',
      keyHeader: 'x-api-key',
      model: null,
    })
    expect(unknown).toMatchObject({
      name: 'gateway.example.com',
      presetId: null,
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

import { describe, expect, it } from 'vitest'
import {
  addedClaudeModels,
  addedModels,
  agentModels,
  agentName,
  canDeleteAgent,
  canRun,
  catalogModelOf,
  claudeAgentModels,
  claudeDefaultEffort,
  claudeEffortsOf,
  cleanModelMap,
  codexDefaultEffort,
  codexEffortsOf,
  codexSessionEffort,
  findProvider,
  firstClaudeModel,
  firstCodexModel,
  isCustomProvider,
  leavesRolesToClaude,
  makerCatalog,
  maskKey,
  modelMapOn,
  openCodeDefaultEffort,
  openCodeEffortsOf,
  openCodeSessionEffort,
  firstPicks,
  OWN_PROVIDER_IDS,
  ownHarnessOf,
  ownProvider,
  presetById,
  presetHarnesses,
  presetPlans,
  PROVIDER_PRESETS,
  providerFirstModel,
  providerFormat,
  providerMark,
  providerPlan,
  providerUrl,
  sessionAgent,
  usableAgents,
  withAgentChange,
  type Agent,
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

/** A Custom provider without models of its own, as one that relays Claude's may be. */
const custom: Provider = {
  id: 'p-relay',
  name: 'Relay',
  presetId: null,
  planId: null,
  apiKey: 'sk-relay',
  keyHeader: 'bearer',
  urls: { anthropic: 'https://relay.example.com' },
  models: [],
  cloud: null,
  own: null,
}

const OPUS = {
  id: 'claude-opus-5-5',
  context: 1_000_000,
  output: 128_000,
  efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
}
const HAIKU = { id: 'claude-haiku-4-5', context: 200_000, output: 64_000, efforts: [] }

/** Claude's models, newest first, as models.dev lists them. */
const CLAUDE_MODELS = { anthropic: [OPUS, HAIKU] }

const SOL = { id: 'gpt-6.2-sol', context: 1_050_000, output: 128_000, efforts: ['low', 'high'] }
const SOL_HEALTHCARE = { ...SOL, id: 'gpt-6.2-sol-healthcare' }
/** OpenAI's models, newest first, as models.dev lists them. */
const OPENAI_MODELS = { openai: [SOL_HEALTHCARE, SOL, { ...SOL, id: 'gpt-6.2-astra' }] }

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
    modelMap: {},
    createdAt: 1,
    ...change,
  }
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

  it('names an agent after its provider, its harness’s own models included, or as the user named it', () => {
    const own = agent('own', { providerId: OWN_PROVIDER_IDS.claude })
    const pro = agent('pro', { model: 'deepseek-pro' })
    const two = { providers: [deepseek], agents: [own, pro] }
    expect(agentName(own, two)).toBe('Claude subscription')
    expect(
      agentName(agent('gpt', { harness: 'codex', providerId: OWN_PROVIDER_IDS.codex }), two),
    ).toBe('ChatGPT subscription')
    expect(
      agentName(agent('oc', { harness: 'opencode', providerId: OWN_PROVIDER_IDS.opencode }), two),
    ).toBe('OpenCode free models')
    expect(
      agentName(
        agent('agy', { harness: 'antigravity', providerId: OWN_PROVIDER_IDS.antigravity }),
        two,
      ),
    ).toBe('Google account')
    expect(agentName(agent('gone', { providerId: 'p-gone' }), two)).toBe('Claude Code')
    expect(agentName(pro, two)).toBe('DeepSeek')
    const flash = agent('flash')
    const both = { providers: [deepseek], agents: [own, pro, flash] }
    expect(agentName(pro, both)).toBe('DeepSeek · deepseek-pro')
    // One made without a model runs its provider's first.
    expect(agentName(flash, both)).toBe('DeepSeek · deepseek-flash[1m]')
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

  it('deletes any agent but the last on its harness’s own models', () => {
    const own = agent('own', { providerId: OWN_PROVIDER_IDS.claude })
    const pro = agent('pro')
    expect(canDeleteAgent(pro, [own, pro])).toBe(true)
    expect(canDeleteAgent(own, [own, pro])).toBe(false)
    // Of two made by hand before Hoot made them, either, until one is left.
    const sonnet = agent('sonnet', { providerId: OWN_PROVIDER_IDS.claude, model: 'sonnet' })
    expect(canDeleteAgent(own, [own, pro, sonnet])).toBe(true)
    expect(canDeleteAgent(sonnet, [own, pro, sonnet])).toBe(true)
    expect(ownHarnessOf(OWN_PROVIDER_IDS.antigravity)).toBe('antigravity')
    expect(ownHarnessOf(deepseek.id)).toBeNull()
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

describe('Claude Code on a provider of the user’s', () => {
  it('offers the effort levels models.dev lists for a model that Claude Code takes', () => {
    expect(claudeEffortsOf({ efforts: ['max', 'none', 'low', 'high', 'minimal'] })).toEqual([
      'low',
      'high',
      'max',
    ])
    expect(claudeEffortsOf({ efforts: [] })).toEqual([])
    expect(claudeEffortsOf(null)).toEqual([])
  })

  it('starts at high while the agent picks no level, else the highest below it the model takes', () => {
    expect(claudeDefaultEffort([])).toBe('high')
    expect(claudeDefaultEffort(['low', 'high', 'max'])).toBe('high')
    expect(claudeDefaultEffort(['low', 'medium', 'xhigh'])).toBe('medium')
    expect(claudeDefaultEffort(['xhigh', 'max'])).toBe('xhigh')
    // Claude Code's settings cannot keep max.
    expect(claudeDefaultEffort(['max'])).toBeNull()
  })

  it('maps roles to models of the provider, which another provider keeps while it offers them', () => {
    expect(cleanModelMap({ opus: ' kimi-k3 ', haiku: '  ', fable: undefined })).toEqual({
      opus: 'kimi-k3',
    })
    const map = { opus: 'kimi-k3', haiku: 'kimi-k3.1-pro' }
    expect(modelMapOn(map, { ...kimi, models: ['kimi-k3'] }, {})).toEqual({ opus: 'kimi-k3' })
    expect(modelMapOn(map, ownProvider('claude'), {})).toEqual({})
    // A Custom provider offers Claude's models too.
    const claude = { haiku: 'claude-haiku-4-5', opus: 'kimi-k3' }
    expect(modelMapOn(claude, { ...kimi, models: ['kimi-k3'] }, CLAUDE_MODELS)).toEqual({
      opus: 'kimi-k3',
    })
    expect(modelMapOn(claude, custom, CLAUDE_MODELS)).toEqual({ haiku: 'claude-haiku-4-5' })
    const changed = withAgentChange(agent('a'), { modelMap: { subagent: ' kimi-k3 ' } })
    expect(changed.modelMap).toEqual({ subagent: 'kimi-k3' })
    expect(withAgentChange(changed, { name: 'Mine' }).modelMap).toEqual({ subagent: 'kimi-k3' })
  })

  it('finds what models.dev tells of a model of a provider, by the catalog of its plan', () => {
    const flash = { id: 'deepseek-flash', context: 1_000_000, output: 384_000, efforts: ['high'] }
    const catalogs = { deepseek: [flash] }
    // At the addresses of DeepSeek's preset.
    const made = {
      ...deepseek,
      urls: { ...deepseek.urls, responses: presetById('deepseek')!.urls!.responses! },
    }
    expect(catalogModelOf(catalogs, 'claude', made, 'deepseek-flash[1m]')).toEqual(flash)
    expect(catalogModelOf(catalogs, 'codex', made, 'deepseek-flash')).toEqual(flash)
    expect(catalogModelOf(catalogs, 'claude', made, 'deepseek-next')).toBeNull()
    expect(
      catalogModelOf(catalogs, 'claude', { ...made, presetId: null }, 'deepseek-flash'),
    ).toBeNull()
    // Of a Custom provider, of the models of the maker of the format the agent runs it in alone.
    const both = { ...custom, urls: { ...custom.urls, responses: 'https://relay.example.com/v1' } }
    expect(catalogModelOf(CLAUDE_MODELS, 'claude', custom, 'claude-haiku-4-5')).toEqual(HAIKU)
    expect(catalogModelOf(CLAUDE_MODELS, 'claude', custom, 'relay-model')).toBeNull()
    expect(catalogModelOf(CLAUDE_MODELS, 'codex', both, 'claude-haiku-4-5')).toBeNull()
    expect(catalogModelOf(OPENAI_MODELS, 'codex', both, 'gpt-6.2-sol')).toEqual(SOL)
    expect(catalogModelOf(OPENAI_MODELS, 'codex', custom, 'gpt-6.2-sol')).toBeNull()
    expect(catalogModelOf(OPENAI_MODELS, 'opencode', both, 'gpt-6.2-sol')).toBeNull()
    expect(catalogModelOf(CLAUDE_MODELS, 'opencode', both, 'claude-haiku-4-5')).toEqual(HAIKU)
    expect(catalogModelOf(CLAUDE_MODELS, 'claude', deepseek, 'claude-haiku-4-5')).toBeNull()
    expect(
      catalogModelOf(CLAUDE_MODELS, 'claude', ownProvider('claude'), 'claude-haiku-4-5'),
    ).toBeNull()
  })
})

describe('Claude Code on a Custom provider', () => {
  it('offers Claude’s models after the provider’s, on a Custom provider alone', () => {
    expect(isCustomProvider(custom)).toBe(true)
    expect(isCustomProvider(deepseek)).toBe(false)
    expect(isCustomProvider(ownProvider('claude'))).toBe(false)
    expect(claudeAgentModels(custom, CLAUDE_MODELS)).toEqual([
      'claude-opus-5-5',
      'claude-haiku-4-5',
    ])
    // One the provider lists itself comes once, among its own.
    const relay = { ...custom, models: ['glm-5', 'claude-haiku-4-5'] }
    expect(addedClaudeModels(relay, CLAUDE_MODELS)).toEqual(['claude-opus-5-5'])
    expect(claudeAgentModels(relay, CLAUDE_MODELS)).toEqual([
      'glm-5',
      'claude-haiku-4-5',
      'claude-opus-5-5',
    ])
    expect(claudeAgentModels(deepseek, CLAUDE_MODELS)).toEqual(deepseek.models)
  })

  it('starts on Claude’s newest Opus, else Claude’s newest', () => {
    const newest = { ...HAIKU, id: 'claude-fable-5-2' }
    expect(firstClaudeModel({ anthropic: [newest, OPUS, HAIKU] })).toBe('claude-opus-5-5')
    expect(firstClaudeModel({ anthropic: [newest, HAIKU] })).toBe('claude-fable-5-2')
    expect(firstClaudeModel({})).toBeNull()
  })

  it('leaves the roles it does not map to Claude Code while it runs one of Claude’s models', () => {
    expect(leavesRolesToClaude(custom, 'claude-opus-5-5', CLAUDE_MODELS)).toBe(true)
    expect(leavesRolesToClaude(custom, 'claude-opus-5-5[1m]', CLAUDE_MODELS)).toBe(true)
    // With no models of its own, it runs Claude's.
    expect(leavesRolesToClaude(custom, null, CLAUDE_MODELS)).toBe(true)
    const relay = { ...custom, models: ['glm-5'] }
    expect(leavesRolesToClaude(relay, 'glm-5', CLAUDE_MODELS)).toBe(false)
    expect(leavesRolesToClaude(relay, null, CLAUDE_MODELS)).toBe(false)
    expect(leavesRolesToClaude(relay, 'claude-haiku-4-5', CLAUDE_MODELS)).toBe(true)
    // An alias, or a Claude model models.dev does not list, is none of them.
    expect(leavesRolesToClaude(relay, 'opus', CLAUDE_MODELS)).toBe(false)
    expect(leavesRolesToClaude(relay, 'anthropic/claude-opus-5-5', CLAUDE_MODELS)).toBe(false)
    // A preset's provider runs its own models for them, Claude's included.
    const anthropic = { ...custom, presetId: 'anthropic', models: ['claude-opus-5-5'] }
    expect(leavesRolesToClaude(anthropic, 'claude-opus-5-5', CLAUDE_MODELS)).toBe(false)
  })
})

describe("Codex on a provider of the user's", () => {
  /** A Custom provider at a Responses address. */
  const responses: Provider = { ...custom, urls: { responses: 'https://relay.example.com/v1' } }

  it('offers OpenAI’s models after the provider’s, on a Custom provider alone', () => {
    expect(addedModels('codex', responses, OPENAI_MODELS)).toEqual([
      'gpt-6.2-sol-healthcare',
      'gpt-6.2-sol',
      'gpt-6.2-astra',
    ])
    const relay = { ...responses, models: ['glm-5', 'gpt-6.2-sol'] }
    expect(agentModels('codex', relay, OPENAI_MODELS)).toEqual([
      'glm-5',
      'gpt-6.2-sol',
      'gpt-6.2-sol-healthcare',
      'gpt-6.2-astra',
    ])
    expect(agentModels('codex', deepseek, OPENAI_MODELS)).toEqual(deepseek.models)
  })

  it('starts on OpenAI’s newest GPT of a tier alone, else OpenAI’s newest', () => {
    expect(firstCodexModel(OPENAI_MODELS)).toBe('gpt-6.2-sol')
    expect(firstCodexModel({ openai: [SOL_HEALTHCARE] })).toBe('gpt-6.2-sol-healthcare')
    expect(firstCodexModel({})).toBeNull()
    expect(providerFirstModel('codex', responses, OPENAI_MODELS)).toBe('gpt-6.2-sol')
    expect(providerFirstModel('claude', custom, CLAUDE_MODELS)).toBe('claude-opus-5-5')
    expect(providerFirstModel('codex', { ...responses, models: ['glm-5'] }, OPENAI_MODELS)).toBe(
      'glm-5',
    )
    expect(providerFirstModel('codex', deepseek, OPENAI_MODELS)).toBe(deepseek.models[0])
  })

  it('offers the levels models.dev lists, and starts at `high`, else the highest below it', () => {
    expect(codexEffortsOf({ efforts: ['none', 'low', 'max', 'turbo'] })).toEqual([
      'none',
      'low',
      'max',
      'turbo',
    ])
    expect(codexEffortsOf(null)).toEqual([])
    expect(codexDefaultEffort([])).toBe('high')
    expect(codexDefaultEffort(['low', 'high', 'max'])).toBe('high')
    expect(codexDefaultEffort(['none', 'low', 'medium', 'xhigh'])).toBe('medium')
    expect(codexDefaultEffort(['xhigh', 'max'])).toBe('xhigh')
    expect(codexDefaultEffort(['max', 'turbo'])).toBe('max')
    // The agent's level while the model takes it, or models.dev lists none for it.
    expect(codexSessionEffort('max', ['low', 'high', 'max'])).toBe('max')
    expect(codexSessionEffort('xhigh', ['low', 'high', 'max'])).toBe('high')
    expect(codexSessionEffort('xhigh', [])).toBe('xhigh')
    expect(codexSessionEffort(null, ['low', 'medium'])).toBe('medium')
  })
})

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
    expect(harnesses('openai')).toEqual(['codex', 'opencode'])
    expect(harnesses('azure')).toEqual(['codex', 'opencode'])
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

describe("OpenCode on a provider of the user's", () => {
  const both: Provider = {
    ...custom,
    urls: { anthropic: 'https://relay.example.com', responses: 'https://relay.example.com/v1' },
  }
  const responses: Provider = { ...custom, urls: { responses: 'https://relay.example.com/v1' } }

  it('runs a provider at its Anthropic-compatible address, else at its Responses one', () => {
    expect(providerFormat(both, 'opencode')).toBe('anthropic')
    expect(providerFormat(responses, 'opencode')).toBe('responses')
    expect(providerFormat(responses, 'claude')).toBeNull()
    expect(providerUrl(responses, 'opencode')).toBe('https://relay.example.com/v1')
    expect(canRun(responses, 'opencode')).toBe(true)
    expect(canRun(responses, 'claude')).toBe(false)
  })

  it('offers on a Custom provider the models of the maker of the format it runs it in', () => {
    const catalogs = { ...CLAUDE_MODELS, ...OPENAI_MODELS }
    expect(makerCatalog('opencode', both)).toBe('anthropic')
    expect(makerCatalog('opencode', responses)).toBe('openai')
    expect(makerCatalog('opencode', { urls: {} })).toBeNull()
    expect(addedModels('opencode', both, catalogs)).toEqual(['claude-opus-5-5', 'claude-haiku-4-5'])
    expect(addedModels('opencode', responses, catalogs)).toEqual([
      'gpt-6.2-sol-healthcare',
      'gpt-6.2-sol',
      'gpt-6.2-astra',
    ])
    expect(providerFirstModel('opencode', both, catalogs)).toBe('claude-opus-5-5')
    expect(providerFirstModel('opencode', responses, catalogs)).toBe('gpt-6.2-sol')
    expect(catalogModelOf(catalogs, 'opencode', responses, 'gpt-6.2-sol')).toEqual(SOL)
    // A preset's provider offers its own models alone.
    expect(addedModels('opencode', deepseek, catalogs)).toEqual([])
  })

  it('offers the levels models.dev lists, else OpenCode’s own, and starts at `high` where it lists some', () => {
    expect(openCodeEffortsOf({ efforts: ['low', 'max'] }, 'anthropic')).toEqual(['low', 'max'])
    expect(openCodeEffortsOf({ efforts: [] }, 'anthropic')).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ])
    expect(openCodeEffortsOf(null, 'responses')).toEqual(['low', 'medium', 'high'])
    expect(openCodeDefaultEffort({ efforts: ['low', 'high', 'max'] })).toBe('high')
    expect(openCodeDefaultEffort({ efforts: ['minimal', 'medium', 'xhigh'] })).toBe('medium')
    // None where models.dev lists no levels, as the model may not reason.
    expect(openCodeDefaultEffort({ efforts: [] })).toBeNull()
    expect(openCodeDefaultEffort(null)).toBeNull()
    // The agent's level while the model takes it, else the model's.
    expect(openCodeSessionEffort('max', { efforts: ['low', 'max'] }, 'anthropic')).toBe('max')
    expect(openCodeSessionEffort('xhigh', { efforts: ['low', 'max'] }, 'anthropic')).toBe('low')
    expect(openCodeSessionEffort('xhigh', null, 'anthropic')).toBe('xhigh')
    expect(openCodeSessionEffort('xhigh', null, 'responses')).toBeNull()
    expect(openCodeSessionEffort(null, null, 'anthropic')).toBeNull()
  })
})

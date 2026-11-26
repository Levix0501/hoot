import { describe, expect, it } from 'vitest'
import { presetById, type Provider } from '../../shared/providers'
import {
  addressesOf,
  azureResource,
  canAdd,
  customMatches,
  draftOf,
  draftOfProvider,
  newProviderOf,
  presetMatches,
  providerInputOf,
  withPlan,
} from './provider-draft'

const preset = (id: string) => presetById(id)!

const ids = (count: number, prefix: string) =>
  Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    context: null,
    output: null,
    efforts: [],
  }))

const catalogs = {
  deepseek: ids(2, 'deepseek'),
  'zhipuai-coding-plan': ids(4, 'coding'),
  zhipuai: ids(18, 'glm'),
  'google-vertex-anthropic': ids(3, 'claude'),
  azure: ids(5, 'gpt'),
  'amazon-bedrock': ids(20, 'bedrock'),
}

function provider(change: Partial<Provider>): Provider {
  return {
    id: 'p-1',
    name: 'Provider',
    presetId: null,
    planId: null,
    apiKey: 'sk-1',
    keyHeader: 'bearer',
    urls: {},
    models: ['m'],
    cloud: null,
    own: null,
    ...change,
  }
}

describe('a provider being added', () => {
  it('starts on a preset’s first plan, a short list of models picked whole, a long one not at all', () => {
    expect(draftOf(preset('deepseek'), catalogs)).toMatchObject({
      presetId: 'deepseek',
      planId: 'deepseek',
      name: 'DeepSeek',
      models: ['deepseek-0', 'deepseek-1'],
      keyHeader: 'bearer',
    })
    const zhipu = draftOf(preset('zhipu'), catalogs)
    expect([zhipu.planId, zhipu.models]).toEqual([
      'coding',
      ['coding-0', 'coding-1', 'coding-2', 'coding-3'],
    ])
    expect(withPlan(zhipu, preset('zhipu'), 'api', catalogs)).toMatchObject({
      planId: 'api',
      models: [],
    })
    expect(withPlan(zhipu, preset('zhipu'), 'gone', catalogs)).toBe(zhipu)
    expect(draftOf(null, catalogs)).toMatchObject({ presetId: null, planId: null, models: [] })
  })

  it('needs a model, and what its preset asks for: a key, Azure’s endpoint, Vertex AI’s project', () => {
    const deepseek = { ...draftOf(preset('deepseek'), catalogs), apiKey: 'sk-1' }
    expect(canAdd(deepseek, preset('deepseek'))).toBe(true)
    expect(canAdd({ ...deepseek, apiKey: ' ' }, preset('deepseek'))).toBe(false)
    expect(canAdd({ ...deepseek, models: [] }, preset('deepseek'))).toBe(false)
    const azure = { ...draftOf(preset('azure'), catalogs), apiKey: 'key' }
    expect(canAdd(azure, preset('azure'))).toBe(false)
    expect(canAdd({ ...azure, endpoint: 'https://r.openai.azure.com' }, preset('azure'))).toBe(true)
    const vertex = draftOf(preset('vertex'), catalogs)
    expect(canAdd({ ...vertex, models: ['claude-0'] }, preset('vertex'))).toBe(false)
    expect(canAdd({ ...vertex, models: ['claude-0'], project: 'p' }, preset('vertex'))).toBe(true)
    const custom = { ...draftOf(null, catalogs), name: 'Mine', apiKey: 'k', models: ['m'] }
    expect(canAdd(custom, null)).toBe(false)
    expect(canAdd({ ...custom, urls: { anthropic: 'https://x.example.com' } }, null)).toBe(true)
    // One of the user's own at an Anthropic-compatible address can do without models.
    const relay = { ...custom, models: [], urls: { anthropic: 'https://relay.example.com' } }
    expect(canAdd(relay, null)).toBe(true)
    expect(canAdd({ ...relay, urls: { responses: 'https://relay.example.com/v1' } }, null)).toBe(
      false,
    )
    expect(canAdd({ ...relay, apiKey: '' }, null)).toBe(false)
  })

  it('saves a preset’s plan’s addresses, whatever the draft holds, with its cloud', () => {
    const zhipu = withPlan(draftOf(preset('zhipu'), catalogs), preset('zhipu'), 'api', catalogs)
    expect(
      providerInputOf(
        { ...zhipu, urls: { anthropic: 'https://typed.example.com' } },
        preset('zhipu'),
      ),
    ).toEqual({
      apiKey: '',
      keyHeader: 'bearer',
      models: [],
      planId: 'api',
      urls: {
        anthropic: 'https://open.bigmodel.cn/api/anthropic',
        responses: 'https://open.bigmodel.cn/api/v1',
      },
      cloud: null,
    })
    expect(
      providerInputOf(draftOf(preset('deepseek'), catalogs), preset('deepseek')).planId,
    ).toBeNull()
    const azure = {
      ...draftOf(preset('azure'), catalogs),
      endpoint: 'https://r.openai.azure.com/openai/v1/',
    }
    expect(providerInputOf(azure, preset('azure')).urls).toEqual({
      responses: 'https://r.openai.azure.com/openai/v1',
    })
    const vertex = { ...draftOf(preset('vertex'), catalogs), planId: 'eu', project: ' p ' }
    expect(providerInputOf(vertex, preset('vertex'))).toMatchObject({
      urls: {},
      cloud: { kind: 'vertex', region: 'eu', project: 'p' },
    })
    const bedrock = { ...draftOf(preset('bedrock'), catalogs), planId: 'eu-west-1' }
    expect(providerInputOf(bedrock, preset('bedrock')).cloud).toEqual({
      kind: 'bedrock',
      region: 'eu-west-1',
    })
    const custom = { ...draftOf(null, catalogs), urls: { responses: 'https://x.example.com/v1' } }
    expect(providerInputOf(custom, null)).toMatchObject({ urls: custom.urls, cloud: null })
  })

  it('names a preset’s provider after it, numbered when the name is taken', () => {
    const draft = draftOf(preset('deepseek'), catalogs)
    expect(newProviderOf(draft, preset('deepseek'), [provider({ name: 'DeepSeek' })]).name).toBe(
      'DeepSeek 2',
    )
    expect(newProviderOf({ ...draft, name: ' Mine ' }, null, []).name).toBe('Mine')
  })

  it('shows the addresses its plan fixes: Vertex AI’s in its region, none of Azure’s', () => {
    expect(addressesOf(preset('kimi'), { planId: 'global' })).toEqual({
      anthropic: 'https://api.moonshot.ai/anthropic',
      responses: 'https://api.moonshot.ai/v1',
    })
    expect(addressesOf(preset('vertex'), { planId: 'global' })).toEqual({
      anthropic: 'https://aiplatform.googleapis.com/v1',
    })
    expect(addressesOf(preset('vertex'), { planId: 'us' })).toEqual({
      anthropic: 'https://aiplatform.us.rep.googleapis.com/v1',
    })
    expect(addressesOf(preset('azure'), { planId: null })).toEqual({})
  })
})

describe('a provider being edited', () => {
  it('starts on the plan its addresses are, or its cloud’s region', () => {
    const kimi = provider({
      presetId: 'kimi',
      planId: null,
      urls: {
        anthropic: 'https://api.moonshot.ai/anthropic',
        responses: 'https://api.moonshot.ai/v1',
      },
    })
    expect(draftOfProvider(kimi)).toMatchObject({ planId: 'global', apiKey: 'sk-1', models: ['m'] })
    const vertex = provider({
      presetId: 'vertex',
      planId: null,
      cloud: { kind: 'vertex', region: 'eu', project: 'my-project' },
    })
    expect(draftOfProvider(vertex)).toMatchObject({ planId: 'eu', project: 'my-project' })
    const azure = provider({
      presetId: 'azure',
      planId: null,
      urls: { responses: 'https://r.openai.azure.com/openai/v1' },
    })
    expect(draftOfProvider(azure).endpoint).toBe('https://r.openai.azure.com')
    // Zhipu's plans share their addresses: the plan the provider names.
    const zhipu = provider({
      presetId: 'zhipu',
      planId: 'api',
      urls: {
        anthropic: 'https://open.bigmodel.cn/api/anthropic',
        responses: 'https://open.bigmodel.cn/api/v1',
      },
    })
    expect(draftOfProvider(zhipu).planId).toBe('api')
    // Addresses no plan has: the first plan, which saving gives it.
    const moved = provider({ presetId: 'kimi', urls: { anthropic: 'https://old.example.com' } })
    expect(draftOfProvider(moved).planId).toBe('cn')
    expect(draftOfProvider(provider({})).planId).toBeNull()
  })

  it('takes an Azure endpoint with or without the path Hoot adds', () => {
    expect(azureResource(' https://r.openai.azure.com/ ')).toBe('https://r.openai.azure.com')
    expect(azureResource('https://r.openai.azure.com/openai')).toBe('https://r.openai.azure.com')
    expect(azureResource('https://r.openai.azure.com/openai/v1/')).toBe(
      'https://r.openai.azure.com',
    )
  })
})

describe('a search for a provider', () => {
  it('finds a preset by its name, its id or another name of it', () => {
    expect(presetMatches(preset('doubao'), '火山')).toBe(true)
    expect(presetMatches(preset('doubao'), 'volc')).toBe(true)
    expect(presetMatches(preset('doubao'), ' ')).toBe(true)
    expect(presetMatches(preset('doubao'), 'kimi')).toBe(false)
    expect(customMatches('cus')).toBe(true)
    expect(customMatches('自定义')).toBe(true)
    expect(customMatches('kimi')).toBe(false)
  })
})

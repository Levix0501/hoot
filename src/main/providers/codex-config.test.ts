import { describe, expect, it } from 'vitest'
import { ownProvider, type ModelCatalogs, type Provider } from '../../shared/providers'
import { CODEX_KEY_VARIABLE, codexProviderLaunch } from './codex-config'

const kimi: Provider = {
  id: 'p1',
  name: 'Kimi',
  presetId: 'kimi',
  planId: null,
  apiKey: 'sk-kimi',
  keyHeader: 'bearer',
  urls: { anthropic: 'https://api.moonshot.cn/anthropic', responses: 'https://api.moonshot.cn/v1' },
  models: ['kimi-k3[1m]', 'kimi-k3.1-pro'],
  cloud: null,
  own: null,
}

/** Kimi's models as models.dev lists them: one that takes no `high`, one models.dev knows no levels of. */
const catalogs: ModelCatalogs = {
  'moonshotai-cn': [
    { id: 'kimi-k3', context: 1_048_576, output: 65_536, efforts: ['low', 'medium', 'max'] },
    { id: 'kimi-k3.1-pro', context: 262_144, output: 65_536, efforts: [] },
  ],
  openai: [
    { id: 'gpt-6.2-sol-healthcare', context: 1_050_000, output: 128_000, efforts: ['low', 'high'] },
    { id: 'gpt-6.2-sol', context: 1_050_000, output: 128_000, efforts: ['low', 'medium', 'high'] },
  ],
}

describe('codexProviderLaunch', () => {
  it('runs a session on a provider by its arguments, the key in a variable of its own', () => {
    expect(codexProviderLaunch(kimi, null, null, catalogs)).toEqual({
      args: [
        '-c',
        'model_provider="hoot"',
        '-c',
        `model_providers.hoot={name="Kimi",base_url="https://api.moonshot.cn/v1",env_key="${CODEX_KEY_VARIABLE}",wire_api="responses"}`,
      ],
      env: { [CODEX_KEY_VARIABLE]: 'sk-kimi' },
      model: 'kimi-k3',
      // The highest of its levels below `high`, which it does not take.
      effort: 'medium',
    })
    // Its subscription, whatever the user's configuration names.
    expect(codexProviderLaunch(ownProvider('codex'), null, null, catalogs)).toEqual({
      args: ['-c', 'model_provider="openai"'],
      env: {},
      model: null,
      effort: null,
    })
  })

  it("always names an effort level: the agent's where the model takes it, else the model's", () => {
    expect(codexProviderLaunch(kimi, 'kimi-k3', 'max', catalogs)).toMatchObject({
      model: 'kimi-k3',
      effort: 'max',
    })
    // A model picked with `/model` that does not take the agent's level.
    expect(codexProviderLaunch(kimi, 'kimi-k3', 'xhigh', catalogs).effort).toBe('medium')
    // One models.dev lists no levels for: the agent's as it is, else `high`.
    expect(codexProviderLaunch(kimi, 'kimi-k3.1-pro', 'xhigh', catalogs).effort).toBe('xhigh')
    expect(codexProviderLaunch(kimi, 'kimi-k3.1-pro', null, catalogs).effort).toBe('high')
    expect(codexProviderLaunch(kimi, 'kimi-k3.1-pro', null, {}).effort).toBe('high')
  })

  it("starts a Custom provider without models of its own on OpenAI's GPT of a tier alone", () => {
    const relay: Provider = {
      ...kimi,
      presetId: null,
      urls: { responses: 'https://relay.example.com/v1' },
      models: [],
    }
    expect(codexProviderLaunch(relay, null, null, catalogs)).toMatchObject({
      args: expect.arrayContaining([expect.stringContaining('https://relay.example.com/v1')]),
      model: 'gpt-6.2-sol',
      effort: 'high',
    })
    expect(codexProviderLaunch(relay, null, null, {})).toMatchObject({
      model: null,
      effort: 'high',
    })
  })
})

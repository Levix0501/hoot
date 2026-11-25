import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse } from 'smol-toml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ownProvider, type Provider } from '../../shared/providers'
import {
  CODEX_KEY_VARIABLE,
  codexProviderLaunch,
  OPENAI_API_URL,
  readCodexGlobal,
  writeCodexGlobal,
} from './codex-config'

let home: string

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-codex-config-'))
  fs.mkdirSync(path.join(home, '.codex'))
})

afterEach(() => fs.rmSync(home, { recursive: true, force: true }))

const configFile = () => path.join(home, '.codex', 'config.toml')
const writeConfig = (text: string) => fs.writeFileSync(configFile(), text, { mode: 0o644 })
const writeAuth = (auth: unknown) =>
  fs.writeFileSync(path.join(home, '.codex', 'auth.json'), JSON.stringify(auth))

const kimi: Provider = {
  id: 'p1',
  name: 'Kimi',
  presetId: 'kimi',
  apiKey: 'sk-kimi',
  keyHeader: 'bearer',
  urls: { anthropic: 'https://api.moonshot.cn/anthropic', responses: 'https://api.moonshot.cn/v1' },
  models: ['kimi-k3[1m]'],
  own: null,
}

/** A configuration as the user and another switcher left it. */
const USER_CONFIG = `# Mine.
model = "user-model"
model_provider = "custom"
model_reasoning_effort = "xhigh"
notify = ["a", "b"]

# The provider another switcher wrote.
[model_providers.custom]
name = "Custom"
base_url = "https://gateway.example/v1"
wire_api = "responses"
experimental_bearer_token = "sk-gateway"

[features]
memories = true
`

describe("Codex's own configuration", () => {
  it('names its subscription by default, signed in or not', async () => {
    const own = { url: '', apiKey: '', keyHeader: 'bearer', model: null }
    expect(await readCodexGlobal({}, home)).toEqual({ config: own, signedIn: false })
    writeAuth({ tokens: { id_token: 'x' }, OPENAI_API_KEY: null })
    writeConfig('model = "gpt-6.1-sol"\n')
    expect(await readCodexGlobal({}, home)).toEqual({
      config: { ...own, model: 'gpt-6.1-sol' },
      signedIn: true,
    })
    // Signed in with a key instead, it runs on OpenAI's API with it.
    writeAuth({ OPENAI_API_KEY: 'sk-openai' })
    expect(await readCodexGlobal({}, home)).toMatchObject({
      config: { url: OPENAI_API_URL, apiKey: 'sk-openai' },
      signedIn: false,
    })
  })

  it('names the provider its model_provider names, by address and key', async () => {
    writeConfig(USER_CONFIG)
    expect(await readCodexGlobal({}, home)).toEqual({
      config: {
        url: 'https://gateway.example/v1',
        apiKey: 'sk-gateway',
        keyHeader: 'bearer',
        model: 'user-model',
      },
      signedIn: false,
    })
    // The key in a variable its env_key names, or the one Codex signed in with.
    writeConfig(
      'model_provider = "x"\n[model_providers.x]\nbase_url = "https://x/v1"\nenv_key = "X_KEY"\n',
    )
    expect(await readCodexGlobal({ X_KEY: 'sk-x' }, home)).toMatchObject({
      config: { apiKey: 'sk-x' },
    })
    expect(await readCodexGlobal({}, home)).toBeNull()
    writeConfig(
      'model_provider = "x"\n[model_providers.x]\nbase_url = "https://x/v1"\nrequires_openai_auth = true\n',
    )
    writeAuth({ OPENAI_API_KEY: 'sk-signed' })
    expect(await readCodexGlobal({}, home)).toMatchObject({ config: { apiKey: 'sk-signed' } })
    // One that is not at a Responses address is none Hoot can run Codex on.
    writeConfig(
      'model_provider = "x"\n[model_providers.x]\nbase_url = "https://x/v1"\nwire_api = "chat"\nexperimental_bearer_token = "k"\n',
    )
    expect(await readCodexGlobal({}, home)).toBeNull()
  })

  it("writes a provider as Hoot's own table, editing those lines alone", async () => {
    writeConfig(USER_CONFIG)
    await writeCodexGlobal({}, home, kimi, null)
    const text = fs.readFileSync(configFile(), 'utf8')
    expect(text).toBe(`# Mine.
model = "kimi-k3"
model_provider = "hoot"
notify = ["a", "b"]

# The provider another switcher wrote.
[model_providers.custom]
name = "Custom"
base_url = "https://gateway.example/v1"
wire_api = "responses"
experimental_bearer_token = "sk-gateway"

[features]
memories = true

[model_providers.hoot]
name = "Kimi"
base_url = "https://api.moonshot.cn/v1"
wire_api = "responses"
experimental_bearer_token = "sk-kimi"
`)
    expect(fs.statSync(configFile()).mode & 0o777).toBe(
      process.platform === 'win32' ? 0o666 : 0o644,
    )
    expect(await readCodexGlobal({}, home)).toEqual({
      config: {
        url: 'https://api.moonshot.cn/v1',
        apiKey: 'sk-kimi',
        keyHeader: 'bearer',
        model: 'kimi-k3',
      },
      signedIn: false,
    })
    // Again, in place of itself, with another model.
    await writeCodexGlobal({}, home, { ...kimi, apiKey: 'sk-new' }, 'kimi-k3.1-pro')
    const again = parse(fs.readFileSync(configFile(), 'utf8')) as Record<string, unknown>
    expect(again).toMatchObject({
      model: 'kimi-k3.1-pro',
      model_provider: 'hoot',
      model_providers: {
        hoot: { experimental_bearer_token: 'sk-new' },
        custom: { name: 'Custom' },
      },
      features: { memories: true },
    })
    // Its subscription: OpenAI's provider, Hoot's table gone.
    await writeCodexGlobal({}, home, ownProvider('codex'), 'gpt-6.1-sol')
    const own = parse(fs.readFileSync(configFile(), 'utf8')) as Record<string, unknown>
    expect(own.model_provider).toBeUndefined()
    expect(own.model).toBe('gpt-6.1-sol')
    expect(Object.keys(own.model_providers as object)).toEqual(['custom'])
  })

  it.skipIf(process.platform === 'win32')(
    'makes a new configuration readable by its owner alone',
    async () => {
      await writeCodexGlobal({}, home, kimi, null)
      expect(fs.statSync(configFile()).mode & 0o777).toBe(0o600)
    },
  )

  it('leaves a configuration that is no TOML alone', async () => {
    writeConfig('not = [toml')
    await expect(writeCodexGlobal({}, home, kimi, null)).rejects.toThrow(/./)
    expect(fs.readFileSync(configFile(), 'utf8')).toBe('not = [toml')
  })

  it('runs a session on a provider by its arguments, the key in a variable of its own', () => {
    expect(codexProviderLaunch(kimi, null, null)).toEqual({
      args: [
        '-c',
        'model_provider="hoot"',
        '-c',
        `model_providers.hoot={name="Kimi",base_url="https://api.moonshot.cn/v1",env_key="${CODEX_KEY_VARIABLE}",wire_api="responses"}`,
      ],
      env: { [CODEX_KEY_VARIABLE]: 'sk-kimi' },
      model: 'kimi-k3',
      effort: 'high',
    })
    expect(codexProviderLaunch(kimi, 'kimi-k3.1-pro', 'low')).toMatchObject({
      model: 'kimi-k3.1-pro',
      effort: 'low',
    })
    // Its subscription, whatever the user's configuration names.
    expect(codexProviderLaunch(ownProvider('codex'), null, null)).toEqual({
      args: ['-c', 'model_provider="openai"'],
      env: {},
      model: null,
      effort: null,
    })
  })
})

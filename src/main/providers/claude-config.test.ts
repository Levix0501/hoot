import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ownProvider, type Provider } from '../../shared/providers'
import {
  ANTHROPIC_API_URL,
  claudeConfigDirectory,
  claudeSessionEnv,
  claudeSettingsFile,
  claudeUserVariables,
  isClaudeProviderVariable,
  readClaudeGlobal,
  writeClaudeGlobal,
} from './claude-config'

let home: string

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-claude-config-'))
})

afterEach(() => fs.rmSync(home, { recursive: true, force: true }))

const file = () => claudeSettingsFile(home, {})

function writeSettings(settings: unknown): void {
  fs.mkdirSync(path.dirname(file()), { recursive: true })
  fs.writeFileSync(file(), JSON.stringify(settings), { mode: 0o644 })
}

const settings = () => JSON.parse(fs.readFileSync(file(), 'utf8')) as Record<string, unknown>

const kimi: Provider = {
  id: 'p-kimi',
  name: 'Kimi',
  presetId: 'kimi',
  apiKey: 'sk-kimi',
  keyHeader: 'bearer',
  urls: { anthropic: 'https://api.moonshot.cn/anthropic' },
  models: ['kimi-k3.1-pro', 'kimi-k3'],
  own: null,
}

describe("Claude Code's own configuration", () => {
  it('lives in CLAUDE_CONFIG_DIR when it is set, else in ~/.claude', () => {
    expect(claudeConfigDirectory('/home/me', {})).toBe(path.join('/home/me', '.claude'))
    expect(claudeConfigDirectory('/home/me', { CLAUDE_CONFIG_DIR: '/elsewhere' })).toBe(
      '/elsewhere',
    )
  })

  it('names its subscription while it sets no provider', async () => {
    expect(await readClaudeGlobal(home, {})).toEqual({
      url: '',
      apiKey: '',
      keyHeader: 'bearer',
      model: null,
    })
    writeSettings({ model: 'opus', env: { DISABLE_TELEMETRY: '1' } })
    expect(await readClaudeGlobal(home, {})).toMatchObject({ url: '', apiKey: '', model: 'opus' })
    // A file that cannot be read counts as none.
    fs.writeFileSync(file(), '{ not json')
    expect(await readClaudeGlobal(home, {})).toMatchObject({ url: '', apiKey: '' })
  })

  it('reads the provider its settings set, over the login shell’s, and the model', async () => {
    writeSettings({
      model: 'sonnet',
      env: {
        ANTHROPIC_BASE_URL: 'https://api.moonshot.cn/anthropic',
        ANTHROPIC_AUTH_TOKEN: 'sk-kimi',
        ANTHROPIC_MODEL: 'kimi-k3',
      },
    })
    const shell = { ANTHROPIC_BASE_URL: 'https://shell.example', ANTHROPIC_AUTH_TOKEN: 'sk-shell' }
    expect(await readClaudeGlobal(home, shell)).toEqual({
      url: 'https://api.moonshot.cn/anthropic',
      apiKey: 'sk-kimi',
      keyHeader: 'bearer',
      model: 'kimi-k3',
    })
    // An empty value in the settings unsets the shell's.
    writeSettings({ env: { ANTHROPIC_BASE_URL: '', ANTHROPIC_AUTH_TOKEN: '' } })
    expect(await readClaudeGlobal(home, shell)).toMatchObject({ url: '', apiKey: '' })
    // Without the settings saying anything, the shell's count.
    writeSettings({})
    expect(await readClaudeGlobal(home, shell)).toMatchObject({
      url: 'https://shell.example',
      apiKey: 'sk-shell',
    })
    // A key without an address is one of Anthropic's own API, which takes it in its own header.
    writeSettings({ env: { ANTHROPIC_API_KEY: 'sk-ant' } })
    expect(await readClaudeGlobal(home, {})).toEqual({
      url: ANTHROPIC_API_URL,
      apiKey: 'sk-ant',
      keyHeader: 'x-api-key',
      model: null,
    })
  })

  it('writes a provider in place of the one before, leaving the rest of the settings alone', async () => {
    writeSettings({
      model: 'opus',
      hooks: { Stop: [] },
      env: {
        ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
        ANTHROPIC_API_KEY: 'sk-deepseek',
        ANTHROPIC_DEFAULT_FABLE_MODEL: 'deepseek-pro',
        CLAUDE_CODE_USE_BEDROCK: '1',
        DISABLE_TELEMETRY: '1',
      },
    })
    await writeClaudeGlobal(home, {}, kimi, null)
    expect(settings()).toEqual({
      hooks: { Stop: [] },
      env: {
        DISABLE_TELEMETRY: '1',
        ANTHROPIC_BASE_URL: 'https://api.moonshot.cn/anthropic',
        ANTHROPIC_AUTH_TOKEN: 'sk-kimi',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'kimi-k3.1-pro',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'kimi-k3.1-pro',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'kimi-k3.1-pro',
      },
    })
    expect(await readClaudeGlobal(home, {})).toEqual({
      url: 'https://api.moonshot.cn/anthropic',
      apiKey: 'sk-kimi',
      keyHeader: 'bearer',
      model: null,
    })
    await writeClaudeGlobal(home, {}, kimi, 'kimi-k3')
    expect(await readClaudeGlobal(home, {})).toMatchObject({ model: 'kimi-k3' })
    // Its own sign-in sets no provider, and the model as `/model` does.
    await writeClaudeGlobal(home, {}, ownProvider('claude'), 'sonnet')
    expect(settings()).toEqual({
      hooks: { Stop: [] },
      env: { DISABLE_TELEMETRY: '1' },
      model: 'sonnet',
    })
  })

  it.skipIf(process.platform === 'win32')(
    'keeps who may read the settings, and makes a new file readable by its owner alone',
    async () => {
      writeSettings({})
      await writeClaudeGlobal(home, {}, kimi, null)
      expect(fs.statSync(file()).mode & 0o777).toBe(0o644)
      fs.rmSync(file())
      await writeClaudeGlobal(home, {}, kimi, null)
      expect(fs.statSync(file()).mode & 0o777).toBe(0o600)
    },
  )

  it('leaves a settings file that holds no JSON object alone', async () => {
    writeSettings({})
    fs.writeFileSync(file(), '{ not json')
    await expect(writeClaudeGlobal(home, {}, kimi, null)).rejects.toThrow(/JSON/)
    expect(fs.readFileSync(file(), 'utf8')).toBe('{ not json')
    expect(fs.readdirSync(path.dirname(file()))).toEqual(['settings.json'])
  })

  it('knows the variables that say which provider it runs on', () => {
    expect(isClaudeProviderVariable('ANTHROPIC_CUSTOM_HEADERS')).toBe(true)
    expect(isClaudeProviderVariable('CLAUDE_CODE_USE_VERTEX')).toBe(true)
    expect(isClaudeProviderVariable('CLAUDE_CODE_OAUTH_TOKEN')).toBe(false)
    expect(isClaudeProviderVariable('CLAUDE_CODE_USE_POWERSHELL_TOOL')).toBe(false)
  })

  it('lists the provider variables the user’s settings and the login shell set', async () => {
    writeSettings({ env: { ANTHROPIC_BASE_URL: 'x', DISABLE_TELEMETRY: '1' } })
    expect(
      (await claudeUserVariables(home, { ANTHROPIC_API_KEY: 'y', PATH: '/bin' })).toSorted(),
    ).toEqual(['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL'])
  })

  it('gives a session on its subscription no provider, and unsets the user’s', () => {
    const env = claudeSessionEnv(ownProvider('claude'), null, ['ANTHROPIC_CUSTOM_HEADERS'])
    expect(env.ANTHROPIC_CUSTOM_HEADERS).toBe('')
    expect(env.ANTHROPIC_BASE_URL).toBe('')
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('')
    expect(Object.values(env).every((value) => value === '')).toBe(true)
  })
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse } from 'jsonc-parser'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ownProvider, type Provider } from '../../shared/providers'
import {
  ANTHROPIC_COMPATIBLE,
  openCodeBaseUrl,
  openCodeConfigFile,
  openCodeModelRef,
  readOpenCodeGlobal,
  writeOpenCodeConfig,
} from './opencode-config'

let home: string

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-opencode-config-'))
})

afterEach(() => fs.rmSync(home, { recursive: true, force: true }))

const folder = () => path.join(home, '.config', 'opencode')

function write(name: string, text: string): string {
  fs.mkdirSync(folder(), { recursive: true })
  const file = path.join(folder(), name)
  fs.writeFileSync(file, text, { mode: 0o644 })
  return file
}

const kimi: Provider = {
  id: 'p1',
  name: 'Kimi',
  presetId: 'kimi',
  apiKey: 'sk-kimi',
  keyHeader: 'bearer',
  urls: { anthropic: 'https://api.moonshot.cn/anthropic' },
  models: ['kimi-k3.1-pro', 'glm-5.3[1m]'],
  own: null,
}

const deepseek: Provider = {
  ...kimi,
  id: 'p2',
  name: 'DeepSeek',
  presetId: 'deepseek',
  apiKey: 'sk-deepseek',
  urls: { anthropic: 'https://api.deepseek.com/anthropic/' },
  models: ['deepseek-flash[1m]'],
}

describe("OpenCode's own configuration", () => {
  it('is opencode.jsonc where there is one, else opencode.json', async () => {
    expect(await openCodeConfigFile({}, home)).toBe(path.join(folder(), 'opencode.json'))
    write('opencode.jsonc', '{}')
    expect(await openCodeConfigFile({}, home)).toBe(path.join(folder(), 'opencode.jsonc'))
    expect(await openCodeConfigFile({ XDG_CONFIG_HOME: '/elsewhere' }, home)).toBe(
      path.join('/elsewhere', 'opencode', 'opencode.json'),
    )
  })

  it('names its free models while its default model is none of another provider', async () => {
    const free = { url: '', apiKey: '', keyHeader: 'bearer', model: null }
    expect(await readOpenCodeGlobal({}, home)).toEqual({ config: free, signedIn: true })
    write('opencode.json', '{ "model": "opencode/glm-5.3-flash-free" }')
    expect(await readOpenCodeGlobal({}, home)).toEqual({
      config: { ...free, model: 'glm-5.3-flash-free' },
      signedIn: true,
    })
  })

  it('names the provider of its default model by its address and key', async () => {
    write(
      'opencode.jsonc',
      `// Mine.
{
  "providers": {
    "mine": {
      "package": "${ANTHROPIC_COMPATIBLE}",
      "settings": { "baseURL": "https://api.moonshot.cn/anthropic/v1", "apiKey": "sk-kimi" },
    },
    "keyless": { "package": "${ANTHROPIC_COMPATIBLE}", "settings": { "baseURL": "https://x/v1" } },
  },
  "model": "mine/kimi-k3",
}`,
    )
    expect(await readOpenCodeGlobal({}, home)).toEqual({
      config: {
        url: 'https://api.moonshot.cn/anthropic',
        apiKey: 'sk-kimi',
        keyHeader: 'bearer',
        model: 'kimi-k3',
      },
      signedIn: false,
    })
    // A provider whose key OpenCode keeps elsewhere, or one Hoot cannot run OpenCode on, is none.
    write('opencode.jsonc', '{ "model": "keyless/x" }')
    expect(await readOpenCodeGlobal({}, home)).toBeNull()
    write('opencode.jsonc', '{ "model": "anthropic/claude-sonnet-5-5" }')
    expect(await readOpenCodeGlobal({}, home)).toBeNull()
  })

  it("writes the user's providers in place of Hoot's earlier ones, keeping the rest and its comments", async () => {
    const file = write(
      'opencode.jsonc',
      `// The user's own comment.
{
  "$schema": "https://opencode.ai/config.json",
  "providers": {
    "mine": { "package": "x" },
    "hoot-gone": { "package": "${ANTHROPIC_COMPATIBLE}" },
  },
}
`,
    )
    await writeOpenCodeConfig({}, home, [kimi, deepseek])
    const text = fs.readFileSync(file, 'utf8')
    expect(text.startsWith("// The user's own comment.")).toBe(true)
    const config = parse(text) as {
      providers: Record<string, unknown>
      model?: string
      $schema: string
    }
    expect(config.$schema).toBe('https://opencode.ai/config.json')
    expect(Object.keys(config.providers)).toEqual(['mine', 'hoot-p1', 'hoot-p2'])
    expect(config.providers['hoot-p1']).toEqual({
      name: 'Kimi',
      package: ANTHROPIC_COMPATIBLE,
      settings: { baseURL: 'https://api.moonshot.cn/anthropic/v1', apiKey: 'sk-kimi' },
      models: { 'kimi-k3.1-pro': { name: 'kimi-k3.1-pro' }, 'glm-5.3': { name: 'glm-5.3' } },
    })
    expect(config.providers['hoot-p2']).toMatchObject({
      settings: { baseURL: 'https://api.deepseek.com/anthropic/v1' },
    })
    expect(config.model).toBeUndefined()
    // Who may read it stays as it was.
    expect(fs.statSync(file).mode & 0o777).toBe(process.platform === 'win32' ? 0o666 : 0o644)

    // A global is its default model too; one that is gone from Hoot goes from the file.
    await writeOpenCodeConfig({}, home, [kimi], { provider: kimi, model: null })
    const next = parse(fs.readFileSync(file, 'utf8')) as typeof config
    expect(Object.keys(next.providers)).toEqual(['mine', 'hoot-p1'])
    expect(next.model).toBe('hoot-p1/kimi-k3.1-pro')
    expect(await readOpenCodeGlobal({}, home)).toMatchObject({
      config: { url: 'https://api.moonshot.cn/anthropic', apiKey: 'sk-kimi' },
    })
    // Its free models, with none picked, take its own default again.
    await writeOpenCodeConfig({}, home, [kimi], { provider: ownProvider('opencode'), model: null })
    expect((parse(fs.readFileSync(file, 'utf8')) as typeof config).model).toBeUndefined()
  })

  it('leaves a file that holds no JSON object alone', async () => {
    const file = write('opencode.json', '{ not json')
    await expect(writeOpenCodeConfig({}, home, [kimi])).rejects.toThrow(/JSON object/)
    expect(fs.readFileSync(file, 'utf8')).toBe('{ not json')
  })

  it("gives OpenCode a provider's address and models as it takes them", () => {
    expect(openCodeBaseUrl('https://api.moonshot.cn/anthropic/')).toBe(
      'https://api.moonshot.cn/anthropic/v1',
    )
    expect(openCodeBaseUrl('https://gateway.example/v1')).toBe('https://gateway.example/v1')
    expect(openCodeModelRef(deepseek, null)).toBe('hoot-p2/deepseek-flash')
    expect(openCodeModelRef(kimi, 'glm-5.3[1m]')).toBe('hoot-p1/glm-5.3')
    expect(openCodeModelRef(ownProvider('opencode'), null)).toBe('opencode/big-pickle')
  })
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse, type ParseError } from 'jsonc-parser'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ownProvider, type ModelCatalogs, type Provider } from '../../shared/providers'
import { writeNodeCommand } from '../tools/test-support'
import {
  ANTHROPIC_COMPATIBLE,
  createOpenCodeSession,
  hootOpenCodeConfig,
  openCodeBaseUrl,
  openCodeConfigFile,
  openCodeModelRef,
  readOpenCodeLaunchOptions,
  removeHootProviders,
  RESPONSES_COMPATIBLE,
  takesProviders,
  writeHootOpenCodeConfig,
} from './opencode-config'

let home: string

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-opencode-config-'))
})

afterEach(() => fs.rmSync(home, { recursive: true, force: true }))

const folder = () => path.join(home, '.config', 'opencode')

/** What a configuration holds, as OpenCode reads it: with trailing commas, and nothing else amiss. */
function strict(text: string): unknown {
  const errors: ParseError[] = []
  const value: unknown = parse(text, errors, { allowTrailingComma: true })
  expect(errors).toEqual([])
  return value
}

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
  planId: null,
  apiKey: 'sk-kimi',
  keyHeader: 'bearer',
  urls: { anthropic: 'https://api.moonshot.cn/anthropic' },
  models: ['kimi-k3.1-pro', 'glm-5.3[1m]'],
  cloud: null,
  own: null,
}

const deepseek: Provider = {
  ...kimi,
  id: 'p2',
  name: 'DeepSeek',
  presetId: 'deepseek',
  planId: null,
  apiKey: 'sk-deepseek',
  urls: { anthropic: 'https://api.deepseek.com/anthropic/' },
  models: ['deepseek-flash[1m]'],
}

/** What models.dev tells of some models. */
const catalogs: ModelCatalogs = {
  deepseek: [
    { id: 'deepseek-pro', context: 1_000_000, output: 384_000, efforts: ['high', 'max'] },
    { id: 'deepseek-chat', context: 128_000, output: null, efforts: [] },
  ],
  anthropic: [
    { id: 'claude-opus-5-5', context: 1_000_000, output: 128_000, efforts: ['low', 'high', 'max'] },
    { id: 'claude-sonnet-5-5', context: 1_000_000, output: 64_000, efforts: [] },
  ],
  openai: [
    { id: 'gpt-6.2-sol', context: 400_000, output: 128_000, efforts: ['low', 'medium', 'high'] },
  ],
}

describe("OpenCode's own configuration", () => {
  it('is opencode.jsonc where there is one, else opencode.json', async () => {
    expect(await openCodeConfigFile({}, home)).toBe(path.join(folder(), 'opencode.json'))
    write('opencode.jsonc', '{}')
    expect(await openCodeConfigFile({}, home)).toBe(path.join(folder(), 'opencode.jsonc'))
    // On Windows, on the home folder's drive.
    expect(await openCodeConfigFile({ XDG_CONFIG_HOME: '/elsewhere' }, home)).toBe(
      path.resolve(home, '/elsewhere', 'opencode', 'opencode.json'),
    )
  })

  it('loses the providers an earlier Hoot wrote into it, keeping the rest and its comments', async () => {
    const file = write(
      'opencode.jsonc',
      `// The user's own comment.
{
  "$schema": "https://opencode.ai/config.json",
  "providers": {
    "mine": { "package": "x" },
    "hoot-gone": { "package": "${ANTHROPIC_COMPATIBLE}" },
    "hoot-p1": { "package": "${ANTHROPIC_COMPATIBLE}" },
  },
}
`,
    )
    expect(await removeHootProviders({}, home)).toBe(true)
    const text = fs.readFileSync(file, 'utf8')
    expect(text.startsWith("// The user's own comment.")).toBe(true)
    const config = strict(text) as { providers: Record<string, unknown>; $schema: string }
    expect(config.$schema).toBe('https://opencode.ai/config.json')
    expect(Object.keys(config.providers)).toEqual(['mine'])
    // Who may read it stays as it was.
    expect(fs.statSync(file).mode & 0o777).toBe(process.platform === 'win32' ? 0o666 : 0o644)
    // Nothing more to take out, nothing written.
    const written = fs.statSync(file).mtimeMs
    expect(await removeHootProviders({}, home)).toBe(false)
    expect(fs.statSync(file).mtimeMs).toBe(written)
  })

  it('keeps the provider its default model is of, and drops `providers` where nothing else is left', async () => {
    const file = write(
      'opencode.json',
      JSON.stringify({
        model: 'hoot-p1/kimi-k3.1-pro',
        providers: { 'hoot-p1': { name: 'Kimi' }, 'hoot-p2': { name: 'DeepSeek' } },
      }),
    )
    await removeHootProviders({}, home)
    expect(strict(fs.readFileSync(file, 'utf8'))).toEqual({
      model: 'hoot-p1/kimi-k3.1-pro',
      providers: { 'hoot-p1': { name: 'Kimi' } },
    })
    write('opencode.json', JSON.stringify({ theme: 'x', providers: { 'hoot-p2': {} } }))
    await removeHootProviders({}, home)
    expect(strict(fs.readFileSync(file, 'utf8'))).toEqual({ theme: 'x' })
  })

  it('leaves a configuration that parses, also where its entries end in commas', async () => {
    const cases: Array<[string, unknown]> = [
      ['{\n  "providers": {\n    "hoot-p1": { "a": 1 },\n  },\n}\n', {}],
      [
        '// mine\n{\n  "$schema": "x",\n  "providers": {\n    "hoot-p1": {},\n  },\n}\n',
        { $schema: 'x' },
      ],
      [
        '{\n  "providers": {\n    "hoot-p1": {},\n    "mine": {},\n  },\n}\n',
        { providers: { mine: {} } },
      ],
      [
        '{\n  "providers": {\n    "mine": {},\n    "hoot-p1": {},\n  },\n  "theme": "x",\n}\n',
        { providers: { mine: {} }, theme: 'x' },
      ],
      [
        '{ "providers": { "mine": {}, "hoot-p1": {}, "hoot-p2": {} }, "model": "mine/m" }',
        { providers: { mine: {} }, model: 'mine/m' },
      ],
    ]
    for (const [text, left] of cases) {
      const file = write('opencode.jsonc', text)
      expect(await removeHootProviders({}, home)).toBe(true)
      expect(strict(fs.readFileSync(file, 'utf8'))).toEqual(left)
    }
  })

  it('leaves a file that holds no JSON object alone, and makes none', async () => {
    const file = write('opencode.json', '{ not json')
    expect(await removeHootProviders({}, home)).toBe(false)
    expect(fs.readFileSync(file, 'utf8')).toBe('{ not json')
    fs.rmSync(file)
    expect(await removeHootProviders({}, home)).toBe(false)
    expect(fs.existsSync(file)).toBe(false)
  })

  it('takes providers from OpenCode 2 on', () => {
    expect(takesProviders('2.0.32')).toBe(true)
    expect(takesProviders('2.4.1')).toBe(true)
    expect(takesProviders('3.0.0')).toBe(true)
    expect(takesProviders('1.19.6')).toBe(false)
    expect(takesProviders('opencode')).toBe(false)
    expect(takesProviders(null)).toBe(false)
  })

  it("asks OpenCode's service for its free models again while it lists none yet", async () => {
    const calls = path.join(home, 'calls')
    const opencode = await writeNodeCommand(
      path.join(home, 'bin', 'opencode'),
      `const fs = require('node:fs')
fs.appendFileSync(${JSON.stringify(calls)}, process.argv.slice(2).join(' ') + '\\n')
const asked = fs.readFileSync(${JSON.stringify(calls)}, 'utf8').trim().split('\\n').length
const data = asked < 3 ? [] : [
  { providerID: 'opencode', modelID: 'big-pickle', name: 'Big Pickle', variants: [{ id: 'low' }, { id: 'high' }] },
  { providerID: 'hoot-p1', modelID: 'kimi-k3.1-pro', name: 'kimi-k3.1-pro', variants: [] },
]
console.log(JSON.stringify({ location: { directory: process.cwd() }, data }))
`,
    )
    const options = await readOpenCodeLaunchOptions(opencode, {}, home, 1)
    expect(options.models).toEqual([
      { value: 'big-pickle', label: 'Big Pickle', efforts: ['low', 'high'] },
    ])
    expect(fs.readFileSync(calls, 'utf8')).toBe('api model.list\n'.repeat(3))
  })

  it('takes only the free models OpenCode offers signed out, not the paid ones a sign-in adds', async () => {
    const opencode = await writeNodeCommand(
      path.join(home, 'bin', 'opencode'),
      `const price = (input) => ({ input, output: input * 5, cache: { read: 0, write: 0 } })
const data = [
  { providerID: 'opencode', modelID: 'big-pickle', name: 'Big Pickle', variants: [], cost: [price(0)] },
  { providerID: 'opencode', modelID: 'claude-opus-5', name: 'Claude Opus 5', variants: [{ id: 'high' }], cost: [price(5)] },
  // Free up to a context size, charged beyond it.
  { providerID: 'opencode', modelID: 'gpt-6-luna', name: 'GPT 6 Luna', variants: [], cost: [price(0), { tier: { type: 'context', size: 100000 }, ...price(0.5) }] },
  { providerID: 'opencode', modelID: 'nemotron-free', name: 'Nemotron Free', variants: [], cost: [] },
  // Go's, which a session on OpenCode's free models does not reach.
  { providerID: 'opencode-go', modelID: 'beam-free', name: 'Beam Free', variants: [], cost: [price(0)] },
]
console.log(JSON.stringify({ location: { directory: process.cwd() }, data }))
`,
    )
    expect((await readOpenCodeLaunchOptions(opencode, {}, home, 1)).models).toEqual([
      { value: 'big-pickle', label: 'Big Pickle', efforts: [] },
      { value: 'nemotron-free', label: 'Nemotron Free', efforts: [] },
    ])
  })

  it('asks an OpenCode without the API once', async () => {
    const calls = path.join(home, 'calls')
    const opencode = await writeNodeCommand(
      path.join(home, 'bin', 'opencode'),
      `require('node:fs').appendFileSync(${JSON.stringify(calls)}, 'asked\\n')
console.error('Unknown command: api')
process.exitCode = 1
`,
    )
    expect((await readOpenCodeLaunchOptions(opencode, {}, home, 1)).models).toEqual([])
    expect(fs.readFileSync(calls, 'utf8')).toBe('asked\n')
  })

  it("gives OpenCode a provider's address and models as it takes them", () => {
    expect(openCodeBaseUrl('https://api.moonshot.cn/anthropic/')).toBe(
      'https://api.moonshot.cn/anthropic/v1',
    )
    expect(openCodeBaseUrl('https://gateway.example/v1')).toBe('https://gateway.example/v1')
    expect(openCodeModelRef(deepseek, null, catalogs)).toBe('hoot-p2/deepseek-flash')
    expect(openCodeModelRef(kimi, 'glm-5.3[1m]', catalogs)).toBe('hoot-p1/glm-5.3')
    expect(openCodeModelRef(ownProvider('opencode'), null, catalogs)).toBe('opencode/big-pickle')
    // A Custom provider without models starts with its address's maker's.
    const custom = {
      ...kimi,
      presetId: null,
      models: [],
      urls: { responses: 'https://x.example/v1' },
    }
    expect(openCodeModelRef(custom, null, catalogs)).toBe('hoot-p1/gpt-6.2-sol')
  })
})

describe("Hoot's configuration of OpenCode", () => {
  it('gives each provider at the address OpenCode runs it at, with its key in the header it asks for', () => {
    const anthropicKey: Provider = {
      ...kimi,
      id: 'p3',
      name: 'Anthropic',
      presetId: null,
      keyHeader: 'x-api-key',
      urls: { anthropic: 'https://api.example.com' },
      models: ['claude-opus-5-5'],
    }
    const openai: Provider = {
      ...kimi,
      id: 'p4',
      name: 'OpenAI',
      presetId: 'openai',
      apiKey: 'sk-openai',
      urls: { responses: 'https://api.openai.com/v1/' },
      models: ['gpt-6.2-sol'],
    }
    const vertex: Provider = {
      ...kimi,
      id: 'p5',
      presetId: 'vertex',
      urls: {},
      cloud: { kind: 'vertex', region: 'global', project: 'x' },
    }
    const config = hootOpenCodeConfig([kimi, anthropicKey, openai, vertex], catalogs) as {
      providers: Record<string, Record<string, unknown>>
    }
    // One OpenCode cannot run, as a cloud's, is left out.
    expect(Object.keys(config.providers)).toEqual(['hoot-p1', 'hoot-p3', 'hoot-p4'])
    // A bearer token at an Anthropic-compatible address, in place of x-api-key.
    expect(config.providers['hoot-p1']).toEqual({
      name: 'Kimi',
      package: ANTHROPIC_COMPATIBLE,
      settings: { baseURL: 'https://api.moonshot.cn/anthropic/v1' },
      headers: { Authorization: 'Bearer sk-kimi' },
      models: { 'kimi-k3.1-pro': { name: 'kimi-k3.1-pro' }, 'glm-5.3': { name: 'glm-5.3' } },
    })
    expect(config.providers['hoot-p3']).toMatchObject({
      settings: { baseURL: 'https://api.example.com/v1', apiKey: 'sk-kimi' },
    })
    expect(config.providers['hoot-p3']).not.toHaveProperty('headers')
    // At a Responses address, the key as OpenAI's API takes it.
    expect(config.providers['hoot-p4']).toEqual({
      name: 'OpenAI',
      package: RESPONSES_COMPATIBLE,
      settings: { baseURL: 'https://api.openai.com/v1', apiKey: 'sk-openai' },
      models: {
        'gpt-6.2-sol': {
          name: 'gpt-6.2-sol',
          limit: { context: 400_000, output: 128_000 },
          capabilities: { reasoning: { supported: true, effort: ['low', 'medium', 'high'] } },
        },
      },
    })
  })

  it("tells OpenCode each model's limits and effort levels as models.dev lists them", () => {
    const both: Provider = {
      ...deepseek,
      urls: {
        anthropic: 'https://api.deepseek.com/anthropic',
        responses: 'https://api.deepseek.com',
      },
      models: ['deepseek-pro', 'deepseek-chat', 'deepseek-unlisted'],
    }
    const custom: Provider = {
      ...kimi,
      id: 'p6',
      presetId: null,
      models: [],
      urls: { anthropic: 'https://relay.example/anthropic' },
    }
    const config = hootOpenCodeConfig([both, custom], catalogs) as {
      providers: Record<string, { package: string; models: Record<string, unknown> }>
    }
    // At its Anthropic-compatible address first.
    expect(config.providers['hoot-p2']!.package).toBe(ANTHROPIC_COMPATIBLE)
    expect(config.providers['hoot-p2']!.models).toEqual({
      'deepseek-pro': {
        name: 'deepseek-pro',
        limit: { context: 1_000_000, output: 384_000 },
        capabilities: { reasoning: { supported: true, effort: ['high', 'max'] } },
      },
      // Without levels, OpenCode gives its own.
      'deepseek-chat': { name: 'deepseek-chat', limit: { context: 128_000 } },
      'deepseek-unlisted': { name: 'deepseek-unlisted' },
    })
    // A Custom one without models has Claude's at an Anthropic-compatible address.
    expect(Object.keys(config.providers['hoot-p6']!.models)).toEqual([
      'claude-opus-5-5',
      'claude-sonnet-5-5',
    ])
  })

  it('is written readable by its owner alone', async () => {
    const file = path.join(home, 'hoot', 'opencode', 'opencode.json')
    await writeHootOpenCodeConfig(file, { providers: {} })
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ providers: {} })
    expect(fs.statSync(file).mode & 0o777).toBe(process.platform === 'win32' ? 0o666 : 0o600)
  })

  it("makes a conversation through Hoot's server, with its password", async () => {
    const calls = path.join(home, 'calls')
    const opencode = await writeNodeCommand(
      path.join(home, 'bin', 'opencode'),
      `const fs = require('node:fs')
fs.writeFileSync(${JSON.stringify(calls)}, JSON.stringify({ args: process.argv.slice(2), password: process.env.OPENCODE_PASSWORD }))
console.log(JSON.stringify({ data: { id: 'ses_1' } }))
`,
    )
    const server = { url: 'http://127.0.0.1:4321', password: 'pw' }
    expect(
      await createOpenCodeSession(opencode, {}, server, home, 'hoot-p2/deepseek-pro', 'high'),
    ).toBe('ses_1')
    const call = JSON.parse(fs.readFileSync(calls, 'utf8')) as { args: string[]; password: string }
    expect(call.password).toBe('pw')
    expect(call.args.slice(0, 4)).toEqual([
      'api',
      '--server',
      'http://127.0.0.1:4321',
      'session.create',
    ])
    expect(JSON.parse(call.args[5]!)).toEqual({
      model: { providerID: 'hoot-p2', id: 'deepseek-pro', variant: 'high' },
      location: { directory: home },
    })
  })
})

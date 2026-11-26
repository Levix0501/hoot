import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeNodeCommand } from '../tools/test-support'
import { readCodexLaunchOptions } from './codex-options'

let root: string
let home: string
let codexHome: string
let command: string
/** The arguments each run of the stand-in Codex was given, a line of JSON each. */
let runs: string

/** What Codex lists on OpenAI's provider for the account, out of their priority's order. */
const catalog = {
  models: [
    {
      slug: 'gpt-6-luna',
      visibility: 'list',
      priority: 7,
      supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }],
    },
    {
      slug: 'gpt-6.2-sol',
      visibility: 'list',
      priority: 1,
      supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }, { effort: 'max' }],
    },
    {
      slug: 'codex-auto-review',
      visibility: 'hide',
      priority: 0,
      supported_reasoning_levels: [{ effort: 'low' }],
    },
  ],
}

/** Codex's own catalog, which it prints with `--bundled`. */
const bundled = {
  models: [
    {
      slug: 'gpt-5.5',
      visibility: 'list',
      priority: 13,
      supported_reasoning_levels: [{ effort: 'medium' }],
    },
    {
      slug: 'gpt-6.1-sol',
      visibility: 'list',
      priority: 1,
      supported_reasoning_levels: [{ effort: 'low' }, { effort: 'ultra' }],
    },
  ],
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-codex-options-'))
  home = path.join(root, 'home')
  codexHome = path.join(home, '.codex')
  runs = path.join(root, 'runs.jsonl')
  fs.mkdirSync(codexHome, { recursive: true })
  command = await writeNodeCommand(
    path.join(root, 'bin', 'codex'),
    [
      "const fs = require('node:fs')",
      'const args = process.argv.slice(2)',
      `fs.appendFileSync(${JSON.stringify(runs)}, JSON.stringify(args) + '\\n')`,
      `const printed = args.includes('--bundled') ? ${JSON.stringify(JSON.stringify(bundled))} : ${JSON.stringify(JSON.stringify(catalog))}`,
      'fs.writeSync(1, printed)',
      '',
    ].join('\n'),
  )
})

afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

function writeConfig(text: string): void {
  fs.writeFileSync(path.join(codexHome, 'config.toml'), text)
}

function read(env: Record<string, string> = {}) {
  return readCodexLaunchOptions({
    command,
    env: { HOME: home, ...env },
    home,
    platform: process.platform,
  })
}

/** The arguments of the stand-in Codex's last run. */
function lastRun(): string[] {
  const lines = fs.readFileSync(runs, 'utf8').trim().split('\n')
  return JSON.parse(lines.at(-1)!) as string[]
}

describe('readCodexLaunchOptions', () => {
  it("offers the models Codex lists on OpenAI's provider, by their priority, without the hidden ones", async () => {
    writeConfig('model = "gpt-6-luna"\nmodel_reasoning_effort = "medium"\n')
    const options = await read()
    expect(lastRun()).toEqual(['debug', 'models', '-c', 'model_provider="openai"'])
    expect(options.models).toEqual([
      { value: 'gpt-6.2-sol', label: 'gpt-6.2-sol', efforts: ['low', 'high', 'max'] },
      { value: 'gpt-6-luna', label: 'gpt-6-luna', efforts: ['low', 'medium'] },
    ])
    // The levels of the model config.toml names, which a session starts with.
    expect(options.defaultEfforts).toEqual(['low', 'medium'])
    expect(options.defaultModel).toEqual({ value: 'gpt-6-luna', source: 'config.toml' })
    expect(options.defaultEffort).toEqual({ value: 'medium', source: 'config.toml' })
  })

  it("offers OpenAI's models where the configuration runs Codex on another provider, and starts with Codex's first without a model", async () => {
    writeConfig('model_provider = "custom"\n')
    const options = await read()
    expect(lastRun()).toEqual(['debug', 'models', '-c', 'model_provider="openai"'])
    expect(options.models.map((model) => model.value)).toEqual(['gpt-6.2-sol', 'gpt-6-luna'])
    expect(options.defaultEfforts).toEqual(['low', 'high', 'max'])
    expect(options.defaultModel).toBeNull()
  })

  it("offers Codex's own models where the configuration names a catalog of its own, not its model", async () => {
    // As a tool that runs Codex on other providers writes it.
    writeConfig(
      'model = "glm-5.3"\nmodel_reasoning_effort = "high"\nmodel_provider = "custom"\nmodel_catalog_json = "catalog.json"\n',
    )
    expect(await read()).toEqual({
      models: [
        { value: 'gpt-6.1-sol', label: 'gpt-6.1-sol', efforts: ['low', 'ultra'] },
        { value: 'gpt-5.5', label: 'gpt-5.5', efforts: ['medium'] },
      ],
      defaultEfforts: ['low', 'ultra'],
      defaultModel: null,
      defaultEffort: { value: 'high', source: 'config.toml' },
    })
    expect(lastRun()).toEqual(['debug', 'models', '--bundled'])
  })

  it('reads CODEX_HOME', async () => {
    const otherHome = path.join(root, 'other-codex')
    fs.mkdirSync(otherHome)
    fs.writeFileSync(path.join(otherHome, 'config.toml'), 'model_catalog_json = "catalog.json"\n')
    const options = await readCodexLaunchOptions({
      command,
      env: { HOME: home, CODEX_HOME: otherHome },
      home,
      platform: process.platform,
    })
    expect(options.models.map((model) => model.value)).toEqual(['gpt-6.1-sol', 'gpt-5.5'])
  })

  it('offers nothing when the catalog cannot be read', async () => {
    command = await writeNodeCommand(path.join(root, 'bin', 'bad-codex'), 'process.exitCode = 1\n')
    writeConfig('model = "x"\n')
    expect(await read()).toEqual({
      models: [],
      defaultEfforts: [],
      defaultModel: { value: 'x', source: 'config.toml' },
      defaultEffort: null,
    })
  })
})

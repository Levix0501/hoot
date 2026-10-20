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

const catalog = {
  models: [
    {
      slug: 'deepseek-flash',
      display_name: 'DeepSeek V4.1 Flash',
      visibility: 'list',
      supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }, { effort: 'max' }],
    },
    {
      slug: 'deepseek-v4-pro',
      display_name: 'DeepSeek V4 Pro',
      visibility: 'list',
      supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }, { effort: 'max' }],
    },
    {
      slug: 'hidden-model',
      display_name: 'Hidden',
      visibility: 'hide',
      supported_reasoning_levels: [{ effort: 'low' }],
    },
  ],
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-codex-options-'))
  home = path.join(root, 'home')
  codexHome = path.join(home, '.codex')
  fs.mkdirSync(codexHome, { recursive: true })
  command = await writeNodeCommand(
    path.join(root, 'bin', 'codex'),
    `require('node:fs').writeSync(1, ${JSON.stringify(JSON.stringify(catalog))})\n`,
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

describe('readCodexLaunchOptions', () => {
  it('offers the models the catalog lists, without the hidden ones, and Default’s levels', async () => {
    writeConfig('model = "deepseek-flash"\n')
    const options = await read()
    expect(options.models).toEqual([
      {
        value: 'deepseek-flash',
        label: 'deepseek-flash',
        efforts: ['low', 'high', 'max'],
      },
      {
        value: 'deepseek-v4-pro',
        label: 'deepseek-v4-pro',
        efforts: ['low', 'high', 'max'],
      },
    ])
    expect(options.defaultEfforts).toEqual(['low', 'high', 'max'])
    expect(options.defaultModel).toEqual({ value: 'deepseek-flash', source: 'config.toml' })
    expect(options.defaultEffort).toBeNull()
  })

  it('names the effort level config.toml sets', async () => {
    writeConfig('model = "deepseek-flash"\nmodel_reasoning_effort = "high"\n')
    expect((await read()).defaultEffort).toEqual({ value: 'high', source: 'config.toml' })
  })

  it('offers only the configured model, without levels, for another provider and no catalog of its own', async () => {
    writeConfig('model = "deepseek-flash"\nmodel_provider = "custom"\n')
    expect(await read()).toEqual({
      models: [{ value: 'deepseek-flash', label: 'deepseek-flash', efforts: [] }],
      defaultEfforts: [],
      defaultModel: { value: 'deepseek-flash', source: 'config.toml' },
      defaultEffort: null,
    })
  })

  it('reads the catalog even for another provider when the configuration names one', async () => {
    writeConfig(
      'model = "deepseek-flash"\nmodel_provider = "custom"\nmodel_catalog_json = "catalog.json"\n',
    )
    expect((await read()).models.map((model) => model.value)).toEqual([
      'deepseek-flash',
      'deepseek-v4-pro',
    ])
  })

  it('reads CODEX_HOME and runs the command it finds there', async () => {
    const otherHome = path.join(root, 'other-codex')
    fs.mkdirSync(otherHome)
    fs.writeFileSync(
      path.join(otherHome, 'config.toml'),
      'model = "deepseek-v4-pro"\nmodel_provider = "custom"\nmodel_catalog_json = "catalog.json"\n',
    )
    const options = await readCodexLaunchOptions({
      command,
      env: { HOME: home, CODEX_HOME: otherHome },
      home,
      platform: process.platform,
    })
    expect(options.models.map((model) => model.value)).toEqual([
      'deepseek-flash',
      'deepseek-v4-pro',
    ])
    expect(options.defaultEfforts).toEqual(['low', 'high', 'max'])
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

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readClaudeLaunchOptions } from './claude-options'

let root: string
let home: string
let userSettings: string
let managedSettings: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-claude-options-'))
  home = path.join(root, 'home')
  userSettings = path.join(root, 'settings.json')
  managedSettings = path.join(root, 'managed-settings.json')
  fs.mkdirSync(home)
})

afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

function write(file: string, value: unknown): void {
  fs.writeFileSync(file, JSON.stringify(value))
}

function read(env: Record<string, string> = {}) {
  return readClaudeLaunchOptions({
    home,
    env,
    platform: 'linux',
    userSettingsPath: userSettings,
    managedSettingsPath: managedSettings,
  })
}

describe('readClaudeLaunchOptions', () => {
  it('offers Default and the four aliases with five effort levels', async () => {
    const options = await read()
    expect(options.models).toEqual([
      { value: 'fable', label: 'fable', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
      { value: 'opus', label: 'opus', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
      { value: 'sonnet', label: 'sonnet', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
      { value: 'haiku', label: 'haiku', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
    ])
    expect(options.defaultEfforts).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    expect(options.defaultModel).toBeNull()
    expect(options.defaultEffort).toBeNull()
  })

  it('names the default model and effort level the settings set, the managed ones first', async () => {
    write(userSettings, { model: 'sonnet', effortLevel: 'xhigh' })
    expect(await read()).toMatchObject({
      defaultModel: { value: 'sonnet', source: 'settings.json' },
      defaultEffort: { value: 'xhigh', source: 'settings.json' },
    })
    write(managedSettings, { effortLevel: 'low' })
    expect(await read()).toMatchObject({
      defaultModel: { value: 'sonnet', source: 'settings.json' },
      defaultEffort: { value: 'low', source: 'managed settings' },
    })
  })

  it("replaces an alias's model and name from the settings environment, with the capabilities it declares", async () => {
    write(userSettings, {
      env: {
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'gw-opus-x',
        ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: 'Gateway Opus',
      },
    })
    let options = await read({ ANTHROPIC_DEFAULT_OPUS_MODEL: 'ignored' })
    const opus = () => options.models.find((option) => option.value === 'opus')
    expect(opus()).toEqual({ value: 'opus', label: 'Gateway Opus', efforts: [] })

    write(userSettings, {
      env: {
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'gw-opus-x',
        ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: 'Gateway Opus',
        ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES: 'effort',
      },
    })
    options = await read()
    expect(opus()?.efforts).toEqual(['low', 'medium', 'high'])

    write(userSettings, {
      env: {
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'gw-opus-x',
        ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES: 'effort,xhigh_effort,max_effort',
      },
    })
    options = await read()
    expect(opus()?.label).toBe('gw-opus-x')
    expect(opus()?.efforts).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    // The default model is the replaced alias, so Default has the same levels.
    expect(options.defaultEfforts).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
  })

  it('adds the custom model option and its name', async () => {
    const options = await read({
      ANTHROPIC_CUSTOM_MODEL_OPTION: 'my-model',
      ANTHROPIC_CUSTOM_MODEL_OPTION_NAME: 'My model',
    })
    expect(options.models.at(-1)).toEqual({ value: 'my-model', label: 'My model', efforts: [] })
  })

  it("takes a known custom model's own levels, and the levels of a configured model that names it", async () => {
    write(userSettings, {
      env: {
        ANTHROPIC_CUSTOM_MODEL_OPTION: 'claude-opus-5-5',
        ANTHROPIC_CUSTOM_MODEL_OPTION_SUPPORTED_CAPABILITIES: 'effort',
      },
    })
    let options = await read()
    expect(options.models.at(-1)).toEqual({
      value: 'claude-opus-5-5',
      label: 'claude-opus-5-5',
      efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    })

    write(userSettings, {
      model: 'gw-opus-x',
      env: {
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'gw-opus-x',
        ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES: 'effort',
      },
    })
    options = await read()
    expect(options.models.find((option) => option.value === 'opus')?.efforts).toEqual([
      'low',
      'medium',
      'high',
    ])
    expect(options.defaultEfforts).toEqual(['low', 'medium', 'high'])
  })

  it("takes an unknown custom model's levels from the capabilities it declares", async () => {
    write(userSettings, {
      env: {
        ANTHROPIC_CUSTOM_MODEL_OPTION: 'my-model',
        ANTHROPIC_CUSTOM_MODEL_OPTION_SUPPORTED_CAPABILITIES: 'effort,xhigh_effort',
      },
    })
    const options = await read()
    expect(options.models.at(-1)?.efforts).toEqual(['low', 'medium', 'high', 'xhigh'])
  })

  it('adds modelPicker rows, and keeps only them when replaceBuiltInOptions is true', async () => {
    write(userSettings, {
      modelPicker: {
        options: [{ model: 'x-model', label: 'X', behavesAs: 'gpt-5.5' }],
      },
    })
    let options = await read()
    expect(options.models.map((option) => option.label)).toEqual([
      'fable',
      'opus',
      'sonnet',
      'haiku',
      'X',
    ])
    expect(options.models.at(-1)?.efforts).toEqual([])

    write(userSettings, {
      modelPicker: {
        replaceBuiltInOptions: true,
        options: [{ model: 'x-model', label: 'X', behavesAs: 'opus' }],
      },
    })
    options = await read()
    expect(options.models).toEqual([
      {
        value: 'x-model',
        label: 'X',
        efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      },
    ])
  })

  it('leaves out the models availableModels does not allow, and the managed settings deny', async () => {
    write(userSettings, { availableModels: ['sonnet', 'haiku', 'x-model'] })
    write(managedSettings, {
      deniedModels: ['haiku'],
      modelPicker: { options: [{ model: 'x-model' }] },
    })
    const options = await read()
    expect(options.models.map((option) => option.value)).toEqual(['sonnet', 'x-model'])
  })

  it("takes the managed modelPicker and availableModels over the user's", async () => {
    write(userSettings, {
      availableModels: ['fable'],
      modelPicker: { options: [{ model: 'user-model' }] },
    })
    write(managedSettings, {
      availableModels: ['sonnet', 'managed-model'],
      modelPicker: { options: [{ model: 'managed-model' }] },
    })
    const options = await read()
    expect(options.models.map((option) => option.value)).toEqual(['sonnet', 'managed-model'])
  })

  it('takes the effort levels of Default from the configured model', async () => {
    write(userSettings, { model: 'claude-opus-4-6' })
    expect((await read()).defaultEfforts).toEqual(['low', 'medium', 'high', 'max'])

    write(userSettings, { model: 'claude-opus-4-5' })
    expect((await read()).defaultEfforts).toEqual([])
  })

  it("takes the managed settings' environment over the user's", async () => {
    write(userSettings, { env: { ANTHROPIC_CUSTOM_MODEL_OPTION: 'user-model' } })
    write(managedSettings, { env: { ANTHROPIC_CUSTOM_MODEL_OPTION: 'managed-model' } })
    const options = await read()
    expect(options.models.map((option) => option.value)).toContain('managed-model')
    expect(options.models.map((option) => option.value)).not.toContain('user-model')
  })

  it('ignores Claude Code’s cache of additional model options', async () => {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true })
    fs.writeFileSync(
      path.join(home, '.claude.json'),
      JSON.stringify({ additionalModelOptionsCache: [{ value: 'zzz-cached-model' }] }),
    )
    const options = await read()
    expect(options.models.map((option) => option.value)).not.toContain('zzz-cached-model')
  })
})

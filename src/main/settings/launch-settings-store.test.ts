import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  defaultAgentLaunchSettings,
  defaultLaunchSettings,
  type LaunchSettings,
} from '../../shared/launch-settings'
import { LaunchSettingsStore } from './launch-settings-store'

let directory: string
let file: string

beforeEach(() => {
  directory = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-launch-settings-')), 'nested')
  file = path.join(directory, 'settings.json')
})

afterEach(() => fs.rmSync(path.dirname(directory), { recursive: true, force: true }))

function writeSettings(content: unknown): void {
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(file, JSON.stringify(content))
}

const saved = () => JSON.parse(fs.readFileSync(file, 'utf8')) as unknown

describe('LaunchSettingsStore', () => {
  it('starts with YOLO mode on and every agent enabled, without writing anything', () => {
    const store = new LaunchSettingsStore(directory)
    expect(store.all()).toEqual(defaultLaunchSettings())
    expect(fs.existsSync(file)).toBe(false)
  })

  it('saves the default agent, YOLO mode and agent settings for later instances', () => {
    const store = new LaunchSettingsStore(directory)
    store.setDefaultAgent('codex')
    store.setYoloMode(false)
    store.change('claude', {
      enabled: false,
      model: 'opus',
      effort: 'max',
      extraArgs: ['--verbose'],
    })
    store.change('codex', { model: 'deepseek-v4-pro' })
    expect(store.all()).toEqual({
      defaultAgent: 'codex',
      yoloMode: false,
      confirmClose: true,
      agents: {
        claude: {
          enabled: false,
          model: 'opus',
          effort: 'max',
          extraArgs: ['--verbose'],
        },
        codex: { ...defaultAgentLaunchSettings(), model: 'deepseek-v4-pro' },
        opencode: defaultAgentLaunchSettings(),
      },
    })
    expect(saved()).toMatchObject({ launchSettings: { defaultAgent: 'codex', yoloMode: false } })

    const reopened = new LaunchSettingsStore(directory)
    expect(reopened.all()).toEqual(store.all())
  })

  it('ignores the permission levels earlier versions saved, and keeps them in the file', () => {
    writeSettings({ permissionLevels: { claude: 'plan', codex: 'read-only' } })
    const store = new LaunchSettingsStore(directory)
    expect(store.all()).toEqual(defaultLaunchSettings())
    store.setYoloMode(false)
    expect(saved()).toMatchObject({
      permissionLevels: { claude: 'plan', codex: 'read-only' },
      launchSettings: { yoloMode: false },
    })
  })

  it('replaces saved values that are not what a setting can be with the defaults', () => {
    writeSettings({
      launchSettings: {
        defaultAgent: 'shell',
        yoloMode: 'yes',
        agents: {
          claude: { enabled: 'yes', model: 4, effort: null, extraArgs: ['--verbose', 3] },
          codex: { enabled: false, model: 'x', effort: 'high', extraArgs: [] },
        },
      },
    })
    const settings: LaunchSettings = new LaunchSettingsStore(directory).all()
    expect(settings.defaultAgent).toBe('claude')
    expect(settings.yoloMode).toBe(true)
    expect(settings.agents.claude).toEqual(defaultAgentLaunchSettings())
    expect(settings.agents.codex).toEqual({
      enabled: false,
      model: 'x',
      effort: 'high',
      extraArgs: [],
    })
    expect(settings.agents.opencode).toEqual(defaultAgentLaunchSettings())
  })

  it('asks before closing a running session until told not to, also after other settings changed', () => {
    writeSettings({ launchSettings: { defaultAgent: 'codex', yoloMode: false } })
    const store = new LaunchSettingsStore(directory)
    expect(store.all().confirmClose).toBe(true)
    const changes: LaunchSettings[] = []
    store.on('changed', (settings) => changes.push(settings))

    store.setConfirmClose(false)
    store.setConfirmClose(false)
    expect(changes.map((settings) => settings.confirmClose)).toEqual([false])
    expect(saved()).toMatchObject({ launchSettings: { confirmClose: false, yoloMode: false } })
    expect(new LaunchSettingsStore(directory).all().confirmClose).toBe(false)

    store.setConfirmClose(true)
    expect(new LaunchSettingsStore(directory).all().confirmClose).toBe(true)
    writeSettings({ launchSettings: { confirmClose: 'no' } })
    expect(new LaunchSettingsStore(directory).all().confirmClose).toBe(true)
  })

  it('reports each change once, and writes nothing when a change changes nothing', () => {
    const store = new LaunchSettingsStore(directory)
    const changes: LaunchSettings[] = []
    store.on('changed', (settings) => changes.push(settings))
    store.setYoloMode(true)
    store.setDefaultAgent('claude')
    store.change('claude', { model: null })
    store.change('claude', { model: 'opus' })
    store.change('claude', { model: 'opus' })
    store.setYoloMode(false)
    store.setDefaultAgent('opencode')
    store.setDefaultAgent('opencode')
    expect(changes).toHaveLength(3)
    expect(changes[0]?.agents.claude.model).toBe('opus')
    expect(changes[1]?.yoloMode).toBe(false)
    expect(changes[2]?.defaultAgent).toBe('opencode')
  })
})

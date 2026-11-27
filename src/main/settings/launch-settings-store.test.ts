import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  defaultAgentLaunchSettings,
  defaultLaunchSettings,
  type LaunchSettings,
} from '../../shared/launch-settings'
import { removeTestFolder } from '../test-support'
import { LaunchSettingsStore } from './launch-settings-store'

let directory: string
let file: string

beforeEach(() => {
  directory = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-launch-settings-')), 'nested')
  file = path.join(directory, 'settings.json')
})

afterEach(() => removeTestFolder(path.dirname(directory)))

function writeSettings(content: unknown): void {
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(file, JSON.stringify(content))
}

const saved = () => JSON.parse(fs.readFileSync(file, 'utf8')) as unknown

describe('LaunchSettingsStore', () => {
  it('starts with no default agent and YOLO mode on, without writing anything', () => {
    const store = new LaunchSettingsStore(directory)
    expect(store.all()).toEqual(defaultLaunchSettings())
    expect(store.all().defaultAgent).toBeNull()
    expect(store.legacyAgent('claude')).toBeNull()
    expect(fs.existsSync(file)).toBe(false)
  })

  it('saves the default agent and YOLO mode for later instances', () => {
    const store = new LaunchSettingsStore(directory)
    store.setDefaultAgent('agent-1')
    store.setYoloMode(false)
    expect(store.all()).toEqual({ defaultAgent: 'agent-1', yoloMode: false })
    expect(saved()).toMatchObject({
      launchSettings: { defaultAgentId: 'agent-1', yoloMode: false },
    })
    const reopened = new LaunchSettingsStore(directory)
    expect(reopened.all()).toEqual(store.all())
    store.setDefaultAgent(null)
    expect(new LaunchSettingsStore(directory).all().defaultAgent).toBeNull()
  })

  it('keeps what an earlier Hoot kept for each coding tool until the agents took it', () => {
    writeSettings({
      launchSettings: {
        defaultAgent: 'codex',
        yoloMode: false,
        agents: {
          claude: { enabled: 'yes', model: 4, effort: null, extraArgs: ['--verbose', 3] },
          codex: { enabled: false, model: 'x', effort: 'high', extraArgs: ['--foo'] },
        },
      },
    })
    const store = new LaunchSettingsStore(directory)
    // A tool id was the default agent then; agents have ids of their own now.
    expect(store.all()).toEqual({ defaultAgent: null, yoloMode: false })
    expect(store.legacyDefaultTool()).toBe('codex')
    expect(store.legacyAgent('claude')).toEqual(defaultAgentLaunchSettings())
    expect(store.legacyAgent('codex')).toEqual({
      enabled: false,
      model: 'x',
      effort: 'high',
      extraArgs: ['--foo'],
    })
    expect(store.legacyAgent('opencode')).toBeNull()
    // Kept while other settings change.
    store.setYoloMode(true)
    expect(new LaunchSettingsStore(directory).legacyAgent('codex')?.model).toBe('x')

    store.dropLegacy()
    expect(store.legacyAgent('codex')).toBeNull()
    expect(store.legacyDefaultTool()).toBeNull()
    const reopened = new LaunchSettingsStore(directory)
    expect(reopened.legacyAgent('codex')).toBeNull()
    expect(reopened.all()).toEqual({ defaultAgent: null, yoloMode: true })
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
    writeSettings({ launchSettings: { defaultAgentId: 4, yoloMode: 'yes' } })
    const settings: LaunchSettings = new LaunchSettingsStore(directory).all()
    expect(settings.defaultAgent).toBeNull()
    expect(settings.yoloMode).toBe(true)
  })

  it('ignores the switch for asking before closing that earlier versions saved', () => {
    writeSettings({ launchSettings: { defaultAgentId: 'agent-1', confirmClose: false } })
    const store = new LaunchSettingsStore(directory)
    expect(store.all()).toEqual({ defaultAgent: 'agent-1', yoloMode: true })
    store.setYoloMode(false)
    expect(saved()).toMatchObject({
      launchSettings: { defaultAgentId: 'agent-1', yoloMode: false },
    })
  })

  it('reports each change once, and writes nothing when a change changes nothing', () => {
    const store = new LaunchSettingsStore(directory)
    const changes: LaunchSettings[] = []
    store.on('changed', (settings) => changes.push(settings))
    store.setYoloMode(true)
    store.setDefaultAgent(null)
    store.setYoloMode(false)
    store.setDefaultAgent('agent-2')
    store.setDefaultAgent('agent-2')
    expect(changes).toHaveLength(2)
    expect(changes[0]?.yoloMode).toBe(false)
    expect(changes[1]?.defaultAgent).toBe('agent-2')
  })
})

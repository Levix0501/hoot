import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  defaultAgentLaunchSettings,
  defaultLaunchSettings,
  type LaunchSettings,
} from '../../shared/launch-settings'
import { CODING_TOOL_IDS } from '../../shared/tools'
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

  it('saves the default agent, YOLO mode, and harness order for later instances', () => {
    const store = new LaunchSettingsStore(directory)
    store.setDefaultAgent('agent-1')
    store.setYoloMode(false)
    store.setHarnessOrder(['codex', 'antigravity', 'claude', 'opencode'])
    expect(store.all()).toEqual({
      defaultAgent: 'agent-1',
      yoloMode: false,
      harnessOrder: ['codex', 'antigravity', 'claude', 'opencode'],
    })
    expect(saved()).toMatchObject({
      launchSettings: {
        defaultAgentId: 'agent-1',
        yoloMode: false,
        harnessOrder: ['codex', 'antigravity', 'claude', 'opencode'],
      },
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
    expect(store.all()).toEqual({
      defaultAgent: null,
      yoloMode: false,
      harnessOrder: [...CODING_TOOL_IDS],
    })
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
    expect(reopened.all()).toEqual({
      defaultAgent: null,
      yoloMode: true,
      harnessOrder: [...CODING_TOOL_IDS],
    })
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
        defaultAgentId: 4,
        yoloMode: 'yes',
        harnessOrder: ['opencode', 'gone', 3, 'opencode'],
      },
    })
    const settings: LaunchSettings = new LaunchSettingsStore(directory).all()
    expect(settings.defaultAgent).toBeNull()
    expect(settings.yoloMode).toBe(true)
    expect(settings.harnessOrder).toEqual(['opencode', 'claude', 'codex', 'antigravity'])
  })

  it('ignores the switch for asking before closing that earlier versions saved', () => {
    writeSettings({ launchSettings: { defaultAgentId: 'agent-1', confirmClose: false } })
    const store = new LaunchSettingsStore(directory)
    expect(store.all()).toEqual({
      defaultAgent: 'agent-1',
      yoloMode: true,
      harnessOrder: [...CODING_TOOL_IDS],
    })
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
    store.setHarnessOrder([...CODING_TOOL_IDS])
    store.setYoloMode(false)
    store.setDefaultAgent('agent-2')
    store.setDefaultAgent('agent-2')
    store.setHarnessOrder(['codex', 'claude'])
    store.setHarnessOrder(['codex', 'claude', 'opencode', 'antigravity'])
    expect(changes).toHaveLength(3)
    expect(changes[0]?.yoloMode).toBe(false)
    expect(changes[1]?.defaultAgent).toBe('agent-2')
    expect(changes[2]?.harnessOrder).toEqual(['codex', 'claude', 'opencode', 'antigravity'])
  })
})

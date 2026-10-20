import { describe, expect, it } from 'vitest'
import {
  agentEnabled,
  defaultLaunchSettings,
  withAgentLaunchSettingsChange,
  withYoloMode,
} from './launch-settings'

describe('launch settings', () => {
  it('start with YOLO mode on and every agent enabled and unchanged', () => {
    const settings = defaultLaunchSettings()
    expect(settings.yoloMode).toBe(true)
    for (const id of ['claude', 'codex', 'opencode'] as const) {
      expect(agentEnabled(settings, id)).toBe(true)
      expect(settings.agents[id]).toEqual({
        enabled: true,
        model: null,
        effort: null,
        extraArgs: [],
      })
    }
  })

  it('leaves an agent out only when it is turned off', () => {
    const settings = withAgentLaunchSettingsChange(defaultLaunchSettings(), 'codex', {
      enabled: false,
    })
    expect(agentEnabled(settings, 'codex')).toBe(false)
    expect(agentEnabled(settings, 'claude')).toBe(true)
    // Before the settings are known, every agent shows.
    expect(agentEnabled(null, 'codex')).toBe(true)
  })

  it('changes only what a change gives', () => {
    const settings = defaultLaunchSettings()
    const changed = withAgentLaunchSettingsChange(settings, 'claude', { extraArgs: ['--verbose'] })
    expect(changed?.agents.claude).toEqual({
      enabled: true,
      model: null,
      effort: null,
      extraArgs: ['--verbose'],
    })
    expect(withYoloMode(settings, false)?.yoloMode).toBe(false)
    expect(withYoloMode(null, false)).toBeNull()
  })
})

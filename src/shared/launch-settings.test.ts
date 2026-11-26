import { describe, expect, it } from 'vitest'
import {
  defaultAgentLaunchSettings,
  defaultLaunchSettings,
  withDefaultAgent,
  withYoloMode,
} from './launch-settings'

describe('launch settings', () => {
  it('start with no default agent and YOLO mode on', () => {
    expect(defaultLaunchSettings()).toEqual({
      defaultAgent: null,
      yoloMode: true,
    })
    expect(defaultAgentLaunchSettings()).toEqual({
      enabled: true,
      model: null,
      effort: null,
      extraArgs: [],
    })
  })

  it('changes only what a change gives', () => {
    const settings = defaultLaunchSettings()
    expect(withYoloMode(settings, false)?.yoloMode).toBe(false)
    expect(withYoloMode(null, false)).toBeNull()
    expect(withDefaultAgent(settings, 'agent-1')).toEqual({ ...settings, defaultAgent: 'agent-1' })
    expect(withDefaultAgent(settings, null)).toEqual(settings)
    expect(withDefaultAgent(null, 'agent-1')).toBeNull()
  })
})

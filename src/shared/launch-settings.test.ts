import { describe, expect, it } from 'vitest'
import {
  defaultAgentLaunchSettings,
  defaultLaunchSettings,
  withDefaultAgent,
  withHarnessOrder,
  withYoloMode,
} from './launch-settings'
import { CODING_TOOL_IDS } from './tools'

describe('launch settings', () => {
  it('start with no default agent, YOLO mode on, and the default harness order', () => {
    expect(defaultLaunchSettings()).toEqual({
      defaultAgent: null,
      yoloMode: true,
      harnessOrder: [...CODING_TOOL_IDS],
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
    expect(withHarnessOrder(settings, ['codex', 'claude'])).toEqual({
      ...settings,
      harnessOrder: ['codex', 'claude', 'opencode', 'antigravity'],
    })
    expect(withHarnessOrder(null, ['codex'])).toBeNull()
  })
})

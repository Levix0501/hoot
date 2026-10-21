import { describe, expect, it } from 'vitest'
import type { ToolsState } from './ipc'
import {
  defaultLaunchSettings,
  withAgentLaunchSettingsChange,
  withDefaultAgent,
} from './launch-settings'
import { chatAgent, chatName, defaultAgentUsable, usableChatAgents } from './chats'

function tools(available: ReadonlyArray<'claude' | 'codex' | 'opencode'>): ToolsState {
  return {
    detecting: false,
    tools: (['claude', 'codex', 'opencode'] as const).map((id) => ({
      id,
      available: available.includes(id),
      path: available.includes(id) ? `/bin/${id}` : null,
    })),
    error: null,
  }
}

describe('chats', () => {
  it('names a chat as a session: the name the user gave, else the title, else the agent', () => {
    expect(chatName({ toolId: 'claude', title: '✳ Fix the login', customName: null })).toBe(
      'Fix the login',
    )
    expect(chatName({ toolId: 'codex', title: 'Fix the login', customName: 'Login' })).toBe('Login')
    expect(chatName({ toolId: 'opencode', title: '', customName: null })).toBe('OpenCode')
  })

  it('knows which agents a chat can use: installed and turned on, in their order', () => {
    const settings = defaultLaunchSettings()
    expect(usableChatAgents(tools(['claude', 'codex', 'opencode']), settings)).toEqual([
      'claude',
      'codex',
      'opencode',
    ])
    expect(usableChatAgents(tools(['codex', 'opencode']), settings)).toEqual(['codex', 'opencode'])
    expect(
      usableChatAgents(
        tools(['claude', 'codex', 'opencode']),
        withAgentLaunchSettingsChange(settings, 'codex', { enabled: false }),
      ),
    ).toEqual(['claude', 'opencode'])
    expect(usableChatAgents({ detecting: true, tools: [], error: null }, settings)).toEqual([])
  })

  it('uses the default agent, else the first one that can be used', () => {
    const settings = defaultLaunchSettings()
    expect(chatAgent(tools(['claude', 'codex']), settings)).toBe('claude')
    expect(chatAgent(tools(['claude', 'codex']), withDefaultAgent(settings, 'codex'))).toBe('codex')
    expect(chatAgent(tools(['claude', 'codex']), withDefaultAgent(settings, 'opencode'))).toBe(
      'claude',
    )
    expect(chatAgent(tools(['opencode']), withDefaultAgent(settings, 'opencode'))).toBe('opencode')
    expect(chatAgent(tools([]), settings)).toBeNull()
    // A menu's agent that cannot be used falls back to what can.
    expect(chatAgent(tools(['codex']), settings, 'opencode')).toBe('codex')
  })

  it('marks Default only while the default agent can be used', () => {
    const settings = defaultLaunchSettings()
    expect(defaultAgentUsable(tools(['claude']), settings)).toBe(true)
    expect(defaultAgentUsable(tools(['codex']), settings)).toBe(false)
    expect(defaultAgentUsable(tools(['codex']), withDefaultAgent(settings, 'codex'))).toBe(true)
  })
})

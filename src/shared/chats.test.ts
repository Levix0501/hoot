import { describe, expect, it } from 'vitest'
import type { ToolsState } from './ipc'
import { defaultLaunchSettings, withDefaultAgent } from './launch-settings'
import {
  agentsChecking,
  chatAgent,
  chatName,
  firstDetectionRunning,
  usableChatAgents,
} from './chats'
import { OWN_PROVIDER_IDS, type Agent, type ProvidersState } from './providers'

/** The tools state once a detection has found these harnesses, each new enough unless `versions` says otherwise. */
function tools(
  available: ReadonlyArray<'claude' | 'codex' | 'opencode'>,
  versions: Partial<Record<'claude' | 'codex' | 'opencode', string>> = {},
): ToolsState {
  return {
    detecting: false,
    tools: (['claude', 'codex', 'opencode'] as const).map((id) => ({
      id,
      available: available.includes(id),
      path: available.includes(id) ? `/bin/${id}` : null,
      version: available.includes(id) ? (versions[id] ?? null) : null,
    })),
    error: null,
  }
}

function agent(id: string, harness: Agent['harness'], change: Partial<Agent> = {}): Agent {
  return {
    id,
    harness,
    providerId: OWN_PROVIDER_IDS[harness],
    name: null,
    enabled: true,
    model: null,
    effort: null,
    extraArgs: [],
    modelMap: {},
    createdAt: 1,
    ...change,
  }
}

/** An agent of each harness on its own models, made in the order Codex, Claude Code, OpenCode. */
const providers: ProvidersState = {
  providers: [],
  agents: [
    agent('codex', 'codex', { createdAt: 1 }),
    agent('claude', 'claude', { createdAt: 2 }),
    agent('opencode', 'opencode', { createdAt: 3 }),
  ],
}

/** The id of the agent a new chat uses. */
function chatAgentId(...args: Parameters<typeof chatAgent>): string | null {
  return chatAgent(...args)?.id ?? null
}

describe('chats', () => {
  it('names a chat as a session: the name the user gave, else the title, else the agent', () => {
    expect(chatName({ toolId: 'claude', title: '✳ Fix the login', customName: null })).toBe(
      'Fix the login',
    )
    expect(chatName({ toolId: 'codex', title: 'Fix the login', customName: 'Login' })).toBe('Login')
    expect(chatName({ toolId: 'opencode', title: '', customName: null })).toBe('OpenCode')
  })

  it('knows which agents a chat can use: of installed harnesses, turned on, by harness', () => {
    const ids = (state: ToolsState, of = providers) =>
      usableChatAgents(state, of).map((entry) => entry.id)
    expect(ids(tools(['claude', 'codex', 'opencode']))).toEqual(['claude', 'codex', 'opencode'])
    expect(ids(tools(['codex', 'opencode']))).toEqual(['codex', 'opencode'])
    const off = {
      ...providers,
      agents: providers.agents.map((entry) =>
        entry.id === 'codex' ? { ...entry, enabled: false } : entry,
      ),
    }
    expect(ids(tools(['claude', 'codex', 'opencode']), off)).toEqual(['claude', 'opencode'])
    // Those of a harness older than the oldest version Hoot works with wait for it to be updated.
    expect(ids(tools(['claude', 'codex', 'opencode'], { opencode: '2.0.32' }))).toEqual([
      'claude',
      'codex',
    ])
    expect(ids({ detecting: true, tools: [], error: null })).toEqual([])
    expect(usableChatAgents(tools(['claude']), null)).toEqual([])
  })

  it('uses the default agent, else the first one that can be used', () => {
    const settings = defaultLaunchSettings()
    expect(chatAgentId(tools(['claude', 'codex']), providers, settings)).toBe('claude')
    expect(
      chatAgentId(tools(['claude', 'codex']), providers, withDefaultAgent(settings, 'codex')),
    ).toBe('codex')
    expect(
      chatAgentId(tools(['claude', 'codex']), providers, withDefaultAgent(settings, 'opencode')),
    ).toBe('claude')
    expect(chatAgentId(tools([]), providers, settings)).toBeNull()
    // A menu's agent that cannot be used falls back to what can.
    expect(chatAgentId(tools(['codex']), providers, settings, 'opencode')).toBe('codex')
    expect(chatAgentId(tools(['codex', 'opencode']), providers, settings, 'opencode')).toBe(
      'opencode',
    )
  })

  it('checks for the agents until the window has them', () => {
    expect(agentsChecking(tools(['claude']), providers)).toBe(false)
    expect(agentsChecking(tools(['claude']), null)).toBe(true)
    expect(agentsChecking({ detecting: true, tools: [], error: null }, providers)).toBe(true)
  })

  it('waits for the first detection alone, while a later one leaves the last results', () => {
    expect(firstDetectionRunning({ detecting: true, tools: [], error: null })).toBe(true)
    const found = tools(['codex'])
    expect(firstDetectionRunning({ ...found, detecting: true })).toBe(false)
    expect(firstDetectionRunning(found)).toBe(false)
    expect(firstDetectionRunning({ detecting: false, tools: [], error: null })).toBe(false)
  })
})

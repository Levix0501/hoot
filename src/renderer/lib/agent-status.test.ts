import { describe, expect, it } from 'vitest'
import type { AgentInstallation, AgentState } from '../../shared/agents'
import { agentRowStatus } from './agent-status'

const installation: AgentInstallation = {
  path: '/usr/local/bin/claude',
  displayPath: '/usr/local/bin/claude',
  method: 'npm',
  version: '2.1.293',
  versionOutput: '',
}

const agent = (overrides: Partial<AgentState>): AgentState => ({
  id: 'claude',
  checking: false,
  installation,
  latest: '2.1.299',
  latestFailed: false,
  operation: null,
  ...overrides,
})

describe('agentRowStatus', () => {
  it('shows an operation that waits or runs, also while the agent is checked', () => {
    expect(
      agentRowStatus(agent({ checking: true, operation: { kind: 'update', status: 'waiting' } })),
    ).toEqual({ kind: 'waiting' })
    expect(
      agentRowStatus(agent({ operation: { kind: 'install', status: 'running', lastLine: '' } })),
    ).toEqual({ kind: 'running', operation: 'install' })
  })

  it('says it is checking while the agent is being detected', () => {
    expect(agentRowStatus(agent({ checking: true }))).toEqual({ kind: 'checking' })
    // An ended operation's result stays below; the right side shows the state.
    expect(
      agentRowStatus(agent({ checking: true, operation: { kind: 'update', status: 'cancelled' } })),
    ).toEqual({ kind: 'checking' })
  })

  it('takes the first that applies', () => {
    expect(agentRowStatus(agent({ installation: null, latestFailed: true }))).toEqual({
      kind: 'install',
    })
    expect(
      agentRowStatus(
        agent({ installation: { ...installation, version: null }, latestFailed: true }),
      ),
    ).toEqual({ kind: 'does-not-run' })
    expect(agentRowStatus(agent({ latest: null, latestFailed: true }))).toEqual({
      kind: 'cannot-check',
    })
    expect(agentRowStatus(agent({ latest: '2.1.293' }))).toEqual({ kind: 'up-to-date' })
    expect(agentRowStatus(agent({ latest: '2.1.0' }))).toEqual({ kind: 'up-to-date' })
    expect(
      agentRowStatus(
        agent({ installation: { ...installation, method: 'unknown' }, latest: '2.1.0' }),
      ),
    ).toEqual({ kind: 'up-to-date' })
    expect(agentRowStatus(agent({ installation: { ...installation, method: 'unknown' } }))).toEqual(
      {
        kind: 'update-elsewhere',
      },
    )
    for (const method of ['npm', 'hoot', 'homebrew', 'official'] as const) {
      expect(agentRowStatus(agent({ installation: { ...installation, method } }))).toEqual({
        kind: 'update',
        version: '2.1.299',
      })
    }
  })
})

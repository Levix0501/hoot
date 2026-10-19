import { describe, expect, it } from 'vitest'
import type { AgentInstallation, AgentState, InstallTarget } from '../../shared/agents'
import { agentRowStatus } from './agent-status'

const installation: AgentInstallation = {
  path: '/usr/local/bin/claude',
  displayPath: '/usr/local/bin/claude',
  method: 'npm',
  version: '2.1.293',
  versionOutput: '',
  updateCommand: '/usr/local/bin/npm install -g @anthropic-ai/claude-code@latest --loglevel=http',
  writable: true,
}

/** A Node.js requirement that the node on the login shell PATH does not meet. */
const nodeRequirement = { range: '>=22.19.0', found: '20.19.6' }

/** Where Install puts an agent: into the computer's npm's global folder. */
const target: InstallTarget = {
  kind: 'npm',
  prefix: '/usr/local',
  displayPrefix: '/usr/local',
}

const agent = (overrides: Partial<AgentState>): AgentState => ({
  id: 'claude',
  checking: false,
  installation,
  latest: '2.1.299',
  latestFailed: false,
  installCommand: '/usr/local/bin/npm install -g @anthropic-ai/claude-code@latest --loglevel=http',
  nodeRequirement: null,
  operation: null,
  ...overrides,
})

describe('agentRowStatus', () => {
  it('shows an operation that waits or runs, also while the agent is checked', () => {
    expect(
      agentRowStatus(
        agent({ checking: true, operation: { kind: 'update', status: 'waiting' } }),
        target,
      ),
    ).toEqual({ kind: 'waiting' })
    expect(
      agentRowStatus(
        agent({
          operation: { kind: 'install', status: 'running', lastLine: '', cancellable: true },
        }),
        target,
      ),
    ).toEqual({ kind: 'running', operation: 'install' })
  })

  it('says it is checking while the agent is being detected', () => {
    expect(agentRowStatus(agent({ checking: true }), target)).toEqual({ kind: 'checking' })
    // An ended operation's result stays below; the right side shows the state.
    expect(
      agentRowStatus(
        agent({ checking: true, operation: { kind: 'update', status: 'cancelled' } }),
        target,
      ),
    ).toEqual({ kind: 'checking' })
  })

  it("offers Install where it is not installed, and says what Install needs where npm can't install it", () => {
    expect(agentRowStatus(agent({ installation: null, latestFailed: true }), target)).toEqual({
      kind: 'install',
    })
    // Not looked for yet.
    expect(agentRowStatus(agent({ installation: null }), null)).toEqual({ kind: 'install' })
    expect(
      agentRowStatus(agent({ installation: null, latestFailed: true }), { kind: 'node-required' }),
    ).toEqual({ kind: 'needs-node' })
    expect(
      agentRowStatus(agent({ installation: null }), {
        kind: 'npm-not-writable',
        prefix: '/usr/local',
        displayPrefix: '/usr/local',
      }),
    ).toEqual({ kind: 'needs-write-access' })
  })

  it('takes the first that applies', () => {
    expect(
      agentRowStatus(
        agent({ installation: { ...installation, version: null }, latestFailed: true }),
        target,
      ),
    ).toEqual({ kind: 'does-not-run' })
    expect(agentRowStatus(agent({ latest: null, latestFailed: true }), target)).toEqual({
      kind: 'cannot-check',
    })
    expect(agentRowStatus(agent({ latest: '2.1.293' }), target)).toEqual({ kind: 'up-to-date' })
    expect(agentRowStatus(agent({ latest: '2.1.0' }), target)).toEqual({ kind: 'up-to-date' })
    expect(
      agentRowStatus(
        agent({ installation: { ...installation, method: 'unknown' }, latest: '2.1.0' }),
        target,
      ),
    ).toEqual({ kind: 'up-to-date' })
    expect(
      agentRowStatus(agent({ installation: { ...installation, method: 'unknown' } }), target),
    ).toEqual({
      kind: 'update-elsewhere',
    })
    for (const method of ['npm', 'homebrew', 'official'] as const) {
      expect(agentRowStatus(agent({ installation: { ...installation, method } }), target)).toEqual({
        kind: 'update',
        version: '2.1.299',
      })
    }
  })

  it('says Install needs a newer Node.js where its latest version does, once npm can install', () => {
    expect(agentRowStatus(agent({ installation: null, nodeRequirement }), target)).toEqual({
      kind: 'needs-newer-node',
      requirement: nodeRequirement,
    })
    expect(
      agentRowStatus(agent({ installation: null, nodeRequirement }), { kind: 'node-required' }),
    ).toEqual({ kind: 'needs-node' })
    expect(
      agentRowStatus(agent({ installation: null, nodeRequirement }), {
        kind: 'npm-not-writable',
        prefix: '/usr/local',
        displayPrefix: '/usr/local',
      }),
    ).toEqual({ kind: 'needs-write-access' })
  })

  it('says the latest version is out, without Update, where updating it needs a newer Node.js or write access', () => {
    expect(agentRowStatus(agent({ nodeRequirement }), target)).toEqual({
      kind: 'update-blocked',
      version: '2.1.299',
      node: nodeRequirement,
      writable: true,
    })
    expect(
      agentRowStatus(agent({ installation: { ...installation, writable: false } }), target),
    ).toEqual({ kind: 'update-blocked', version: '2.1.299', node: null, writable: false })
    expect(
      agentRowStatus(
        agent({ installation: { ...installation, writable: false }, nodeRequirement }),
        target,
      ),
    ).toEqual({
      kind: 'update-blocked',
      version: '2.1.299',
      node: nodeRequirement,
      writable: false,
    })
    // Nothing to tell where there is no update, or Hoot cannot update it.
    expect(agentRowStatus(agent({ latest: '2.1.293', nodeRequirement }), target)).toEqual({
      kind: 'up-to-date',
    })
    expect(
      agentRowStatus(
        agent({ installation: { ...installation, method: 'unknown' }, nodeRequirement }),
        target,
      ),
    ).toEqual({ kind: 'update-elsewhere' })
  })
})

import {
  isNewerVersion,
  type AgentOperationKind,
  type AgentState,
  type InstallTarget,
} from '../../shared/agents'

/** What the right side of an agent's row on the Agents page shows. */
export type AgentRowStatus =
  | { kind: 'waiting' }
  | { kind: 'running'; operation: AgentOperationKind }
  | { kind: 'checking' }
  | { kind: 'install' }
  | { kind: 'needs-node' }
  | { kind: 'does-not-run' }
  | { kind: 'cannot-check' }
  | { kind: 'up-to-date' }
  | { kind: 'update-elsewhere' }
  | { kind: 'update'; version: string }

/**
 * What an agent's row shows on its right: its operation while it waits or
 * runs; otherwise "Checking…" while the agent is being detected; otherwise,
 * by the first that applies, Install when it is not installed, that it needs
 * Node.js and npm when Hoot has no npm to install with, that it does not run,
 * that its latest version could not be read, that it is up to date, that it
 * is to be updated the way it was installed when Hoot cannot tell how, or the
 * button that updates it to its latest version.
 */
export function agentRowStatus(agent: AgentState, target: InstallTarget | null): AgentRowStatus {
  const operation = agent.operation
  if (operation?.status === 'waiting') return { kind: 'waiting' }
  if (operation?.status === 'running') return { kind: 'running', operation: operation.kind }
  if (agent.checking) return { kind: 'checking' }
  const installation = agent.installation
  if (installation === null) {
    return target?.kind === 'node-required' ? { kind: 'needs-node' } : { kind: 'install' }
  }
  if (installation.version === null) return { kind: 'does-not-run' }
  if (agent.latestFailed || agent.latest === null) return { kind: 'cannot-check' }
  if (!isNewerVersion(agent.latest, installation.version)) return { kind: 'up-to-date' }
  if (installation.method === 'unknown') return { kind: 'update-elsewhere' }
  return { kind: 'update', version: agent.latest }
}

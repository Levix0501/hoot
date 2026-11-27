import {
  driftedFrom,
  isNewerVersion,
  updateTargetOf,
  type AgentOperationKind,
  type AgentState,
  type InstallTarget,
  type UnmetNodeRequirement,
} from '../../shared/agents'

/** What the right side of an agent's row on the Agents page shows. */
export type AgentRowStatus =
  | { kind: 'waiting' }
  | {
      kind: 'running'
      operation: AgentOperationKind
      /** The version it installs, or that of the copy it uninstalls; `null` where it names none. */
      version: string | null
      /** Whether it uninstalls a copy other than the one in use. */
      other: boolean
    }
  | { kind: 'checking' }
  | { kind: 'install' }
  | { kind: 'needs-node' }
  | { kind: 'needs-write-access' }
  | { kind: 'needs-newer-node'; requirement: UnmetNodeRequirement }
  | { kind: 'does-not-run' }
  | { kind: 'restore'; version: string }
  | { kind: 'staying' }
  | { kind: 'cannot-check' }
  | { kind: 'up-to-date' }
  | { kind: 'update-elsewhere' }
  | { kind: 'update'; version: string }
  | {
      kind: 'update-blocked'
      version: string
      /** The Node.js the version needs, when the node here is too old for it. */
      node: UnmetNodeRequirement | null
      /** Whether the user can write to the installation's npm global folder. */
      writable: boolean
    }

/**
 * What an agent's row shows on its right: its operation while it waits or
 * runs; otherwise "Checking…" while the agent is being detected for the
 * first time; otherwise, by the first that applies, when it is not installed,
 * Install, or, where npm installs it, why there is none: that it needs
 * Node.js and npm when the computer has no npm that runs, write access to
 * npm's global folder, or a newer Node.js than the one here; then that it
 * does not run; for one that stays on a version, Back to it where another
 * has taken its place, else nothing; then that the version it follows could
 * not be read, that it is up to date, that it is to be updated the way it
 * was installed when Hoot cannot tell how, that the version it follows is
 * out where updating it needs a newer Node.js or write access to npm's
 * global folder, or the button that updates it to that version.
 */
export function agentRowStatus(agent: AgentState, target: InstallTarget | null): AgentRowStatus {
  const operation = agent.operation
  if (operation?.status === 'waiting') return { kind: 'waiting' }
  if (operation?.status === 'running') {
    return {
      kind: 'running',
      operation: operation.kind,
      version: operation.version,
      other:
        operation.kind === 'uninstall' &&
        operation.path !== null &&
        operation.path !== agent.installation?.path,
    }
  }
  if (agent.checking && !agent.detected) return { kind: 'checking' }
  const installation = agent.installation
  if (installation === null) {
    if (agent.installRoute === 'official') return { kind: 'install' }
    switch (target?.kind) {
      case 'node-required':
        return { kind: 'needs-node' }
      case 'npm-not-writable':
        return { kind: 'needs-write-access' }
      default:
        return agent.nodeRequirement
          ? { kind: 'needs-newer-node', requirement: agent.nodeRequirement }
          : { kind: 'install' }
    }
  }
  if (installation.version === null) return { kind: 'does-not-run' }
  if (agent.follow.kind === 'stay') {
    const drifted = driftedFrom(agent)
    return drifted !== null && installation.switchable
      ? { kind: 'restore', version: drifted }
      : { kind: 'staying' }
  }
  const version = updateTargetOf(agent)
  if (version === null) {
    return agent.follow.kind === 'latest' || agent.latestFailed
      ? { kind: 'cannot-check' }
      : { kind: 'up-to-date' }
  }
  if (agent.latestFailed && agent.follow.kind === 'latest') return { kind: 'cannot-check' }
  if (!isNewerVersion(version, installation.version)) return { kind: 'up-to-date' }
  if (installation.method === 'unknown') return { kind: 'update-elsewhere' }
  if (agent.nodeRequirement || !installation.writable) {
    return {
      kind: 'update-blocked',
      version,
      node: agent.nodeRequirement,
      writable: installation.writable,
    }
  }
  return { kind: 'update', version }
}

/**
 * Whether Update all includes an agent: its row offers Update, or its last
 * update failed. Both need it installed and running, and following a version
 * rather than staying on one. A failed install leaves its row showing the
 * failure, not Update, even when a newer version is out.
 */
export function updateAllIncludes(agent: AgentState, target: InstallTarget | null): boolean {
  if (agent.installation === null || agent.installation.version === null) return false
  if (agent.follow.kind === 'stay') return false
  if (agent.operation?.kind === 'install' && agent.operation.status === 'failed') return false
  if (agent.operation?.kind === 'update' && agent.operation.status === 'failed') return true
  return agentRowStatus(agent, target).kind === 'update'
}

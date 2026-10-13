import type { ToolsState } from '../../shared/ipc'
import type { Issue } from '../../shared/issues'
import { getTool } from '../../shared/tools'
import { toolStatus } from './tool-status'

/**
 * Why an issue cannot be sent to Claude Code now: Claude Code is still being
 * checked for, or it is not installed; or the issue belongs to no project,
 * in whose main worktree the session would start.
 */
export type SendBlocker = 'checking' | 'not-installed' | 'no-project'

/** Every reason an issue cannot be sent to Claude Code now; none when it can be. */
export function sendBlockers(tools: ToolsState, issue: Pick<Issue, 'projectId'>): SendBlocker[] {
  const status = toolStatus(tools, getTool('claude'))
  const blockers: SendBlocker[] = status === 'available' ? [] : [status]
  if (issue.projectId === null) blockers.push('no-project')
  return blockers
}

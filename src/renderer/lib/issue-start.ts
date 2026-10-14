import type { ToolsState } from '../../shared/ipc'
import type { Issue } from '../../shared/issues'
import { getTool } from '../../shared/tools'
import { toolStatus } from './tool-status'

/**
 * Why work on an issue cannot be started now: Claude Code is still being
 * checked for, or it is not installed; or the issue belongs to no project,
 * in which its worktree would be.
 */
export type StartBlocker = 'checking' | 'not-installed' | 'no-project'

/** Every reason work on an issue cannot be started now; none when it can be. */
export function startBlockers(tools: ToolsState, issue: Pick<Issue, 'projectId'>): StartBlocker[] {
  const status = toolStatus(tools, getTool('claude'))
  const blockers: StartBlocker[] = status === 'available' ? [] : [status]
  if (issue.projectId === null) blockers.push('no-project')
  return blockers
}

/** What an open issue's start button does when it is clicked now. */
export type StartState =
  /** It shows the session started from the issue, which is in the sidebar. */
  | { kind: 'show'; sessionId: string }
  /** It cannot be used, for these reasons. */
  | { kind: 'blocked'; blockers: StartBlocker[] }
  /** It starts a Claude Code session in the issue's worktree. */
  | { kind: 'worktree'; worktreePath: string }
  /** It creates a worktree for the issue, and starts a Claude Code session in it. */
  | { kind: 'new-worktree' }

/**
 * What an open issue's start button does, given the session started from the
 * issue that is in the sidebar, if any, what Hoot knows of Claude Code, and
 * the issue's worktree, if any. The session is shown whatever project the
 * issue belongs to since, and whether or not Claude Code can be found now.
 */
export function startState(
  issue: Pick<Issue, 'projectId'>,
  {
    sessionId,
    tools,
    worktreePath,
  }: { sessionId: string | null; tools: ToolsState; worktreePath: string | null },
): StartState {
  if (sessionId !== null) return { kind: 'show', sessionId }
  const blockers = startBlockers(tools, issue)
  if (blockers.length > 0) return { kind: 'blocked', blockers }
  return worktreePath === null ? { kind: 'new-worktree' } : { kind: 'worktree', worktreePath }
}

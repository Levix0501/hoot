import type { ToolsState } from '../../shared/ipc'
import type { Issue } from '../../shared/issues'
import { getTool } from '../../shared/tools'
import {
  firstStep,
  stepName,
  type WorkflowDefinition,
  type WorkflowProgress,
} from '../../shared/workflows'
import { toolStatus } from './tool-status'

/**
 * Why work on an issue cannot be started now: Claude Code is still being
 * checked for, or it is not installed; the issue belongs to no project, in
 * which its worktree would be; or its workflow is finished.
 */
export type StartBlocker = 'checking' | 'not-installed' | 'no-project' | 'finished'

/** Every reason work on an issue cannot be started now; none when it can be. */
export function startBlockers(
  tools: ToolsState,
  issue: Pick<Issue, 'projectId'>,
  progress: WorkflowProgress,
): StartBlocker[] {
  const status = toolStatus(tools, getTool('claude'))
  const blockers: StartBlocker[] = status === 'available' ? [] : [status]
  if (issue.projectId === null) blockers.push('no-project')
  if (progress.kind === 'finished') blockers.push('finished')
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
 * issue that is in the sidebar, if any, what Hoot knows of Claude Code, the
 * issue's worktree, if any, and where the issue is in its workflow. The
 * session is shown whatever project the issue belongs to since, whether or
 * not Claude Code can be found now, and whether or not the workflow is
 * finished.
 */
export function startState(
  issue: Pick<Issue, 'projectId'>,
  {
    sessionId,
    tools,
    worktreePath,
    progress,
  }: {
    sessionId: string | null
    tools: ToolsState
    worktreePath: string | null
    progress: WorkflowProgress
  },
): StartState {
  if (sessionId !== null) return { kind: 'show', sessionId }
  const blockers = startBlockers(tools, issue, progress)
  if (blockers.length > 0) return { kind: 'blocked', blockers }
  return worktreePath === null ? { kind: 'new-worktree' } : { kind: 'worktree', worktreePath }
}

/**
 * What the tooltip of a start button that can be used says it does: shows
 * the session; or starts the workflow's first step, or continues the step
 * the issue is at, in the issue's worktree or a new one.
 */
export function startHint(
  state: Exclude<StartState, { kind: 'blocked' }>,
  progress: WorkflowProgress,
  workflow: WorkflowDefinition,
): string {
  if (state.kind === 'show') return 'Show the Claude Code session started from this issue'
  const where = state.kind === 'worktree' ? "this issue's worktree" : 'a new worktree'
  return progress.kind === 'at-step'
    ? `Continue ${stepName(workflow, progress.step)} with Claude Code in ${where}`
    : `Start ${firstStep(workflow).name} with Claude Code in ${where}`
}

/**
 * Whether work on an issue is being started: from the click on its start
 * button, while Hoot saves the issue and finds or creates its worktree (the
 * issue is in `starts` then), until the session the click starts has
 * started or could not start (a session of the issue that is still
 * starting). The session starts at the step the issue was at when the button
 * was clicked, so nothing in the window changes its progress meanwhile.
 */
export function isStartUnderWay(
  issueId: number,
  starts: readonly number[],
  sessions: readonly { issueId: number | null; status: string }[],
): boolean {
  return (
    starts.includes(issueId) ||
    sessions.some((session) => session.issueId === issueId && session.status === 'starting')
  )
}

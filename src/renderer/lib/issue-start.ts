import type { StartBlocker } from '../../shared/start-blockers'
import { firstStep, type WorkflowDefinition, type WorkflowProgress } from '../../shared/workflows'

/** What an open issue's start button does when it is clicked now. */
export type StartState =
  /** It shows the session most recently opened from the issue, which is in the sidebar. */
  | { kind: 'show'; sessionId: string }
  /** It cannot be used, for these reasons. */
  | { kind: 'blocked'; blockers: StartBlocker[] }
  /** It starts a Claude Code session in the issue's worktree. */
  | { kind: 'worktree'; worktreePath: string }
  /** It creates a worktree for the issue, and starts a Claude Code session in it. */
  | { kind: 'new-worktree' }

/**
 * What an open issue's start button does, given the session most recently
 * opened from the issue that is in the sidebar, if any, the reasons work on
 * it cannot be started now, and the issue's worktree, if any. The session is
 * shown whatever the reasons.
 */
export function startState({
  sessionId,
  blockers,
  worktreePath,
}: {
  sessionId: string | null
  blockers: readonly StartBlocker[]
  worktreePath: string | null
}): StartState {
  if (sessionId !== null) return { kind: 'show', sessionId }
  if (blockers.length > 0) return { kind: 'blocked', blockers: [...blockers] }
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
  if (state.kind === 'show') return 'Show the Claude Code session opened last from this issue'
  const where = state.kind === 'worktree' ? "this issue's worktree" : 'a new worktree'
  return progress.kind === 'at-step'
    ? `Continue ${progress.step.name} with Claude Code in ${where}`
    : `Start ${firstStep(workflow).name} with Claude Code in ${where}`
}

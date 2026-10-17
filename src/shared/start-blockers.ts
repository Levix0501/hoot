import type { ToolsState } from './ipc'
import { issueIdentifier, type Issue } from './issues'
import { toolStatus } from './tool-status'
import { getTool } from './tools'
import type { WorkflowProgress } from './workflows'

/**
 * A reason work on an issue cannot be started now, by its start button, its
 * Start new session or `hoot session start`: Claude Code is still being
 * checked for, or it is not installed; the issue belongs to no project, in
 * which its worktree would be; it waits on issues neither done nor canceled;
 * or its workflow is finished.
 */
export type StartBlocker =
  | { kind: 'checking' }
  | { kind: 'not-installed' }
  | { kind: 'no-project' }
  /** The issues it waits on, in the order it became blocked by them. */
  | { kind: 'waiting'; issueIds: number[] }
  /** The end label it carries. */
  | { kind: 'finished'; label: string }

/**
 * Every reason work on an issue cannot be started now, given what Hoot knows
 * of Claude Code, the issues it waits on and where it is in its workflow;
 * none when it can be.
 */
export function startBlockers(
  tools: ToolsState,
  issue: Pick<Issue, 'projectId'>,
  waitedOn: readonly number[],
  progress: WorkflowProgress,
): StartBlocker[] {
  const status = toolStatus(tools, getTool('claude'))
  const blockers: StartBlocker[] = status === 'available' ? [] : [{ kind: status }]
  if (issue.projectId === null) blockers.push({ kind: 'no-project' })
  if (waitedOn.length > 0) blockers.push({ kind: 'waiting', issueIds: [...waitedOn] })
  if (progress.kind === 'finished') blockers.push({ kind: 'finished', label: progress.label.name })
  return blockers
}

/** A list in words: "ISS-1", "ISS-1 and ISS-2", "ISS-1, ISS-2 and ISS-3". */
export function listText(items: readonly string[]): string {
  return new Intl.ListFormat('en', { type: 'conjunction' }).format(items)
}

/** A reason work on an issue cannot be started, as a sentence. */
export function startBlockerText(blocker: StartBlocker): string {
  switch (blocker.kind) {
    case 'checking':
      return 'Hoot is still checking whether Claude Code is installed.'
    case 'not-installed':
      return `Claude Code is not installed. Install it with: ${getTool('claude').installCommand}`
    case 'no-project':
      return "It has no project, in which its worktree would be: set the issue's Project first."
    case 'waiting': {
      const count = blocker.issueIds.length
      return (
        `It waits on ${listText(blocker.issueIds.map(issueIdentifier))}, ` +
        `which ${count === 1 ? 'is' : 'are'} neither done nor canceled.`
      )
    }
    case 'finished':
      return `Its workflow is finished: it has the label "${blocker.label}".`
  }
}

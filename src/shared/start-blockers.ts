import { minimumVersionText } from './agents'
import type { ToolsState } from './ipc'
import { issueIdentifier, type Issue } from './issues'
import { toolStatus } from './tool-status'
import { getTool } from './tools'
import type { WorkflowProgress } from './workflows'

/**
 * A reason work on an issue cannot be started now, by its start button, its
 * Start new session or `hoot session start`: Claude Code is still being
 * checked for, it is not installed, it is older than the oldest version Hoot
 * works with, or it has no agent turned on; the issue belongs to no project,
 * in which its worktree would be; it waits on issues neither done nor
 * canceled; or its workflow is finished.
 */
export type StartBlocker =
  | { kind: 'checking' }
  | { kind: 'not-installed' }
  | { kind: 'outdated' }
  | { kind: 'no-agent' }
  | { kind: 'no-project' }
  /** The issues it waits on, in the order it became blocked by them. */
  | { kind: 'waiting'; issueIds: number[] }
  /** The end label it carries. */
  | { kind: 'finished'; label: string }

/**
 * Every reason work on an issue cannot be started now, given what Hoot knows
 * of Claude Code and whether it has an agent that can start (see
 * `issueAgent`), the issues it waits on and where it is in its workflow;
 * none when it can be.
 */
export function startBlockers(
  tools: ToolsState,
  issue: Pick<Issue, 'projectId'>,
  waitedOn: readonly number[],
  progress: WorkflowProgress,
  hasAgent = true,
): StartBlocker[] {
  const status = toolStatus(tools, getTool('claude'))
  const blockers: StartBlocker[] =
    status !== 'available' ? [{ kind: status }] : hasAgent ? [] : [{ kind: 'no-agent' }]
  if (issue.projectId === null) blockers.push({ kind: 'no-project' })
  if (waitedOn.length > 0) blockers.push({ kind: 'waiting', issueIds: [...waitedOn] })
  if (progress.kind === 'finished') blockers.push({ kind: 'finished', label: progress.label.name })
  return blockers
}

/** A list in words: "#1", "#1 and #2", "#1, #2 and #3". */
export function listText(items: readonly string[]): string {
  return new Intl.ListFormat('en', { type: 'conjunction' }).format(items)
}

/** A reason work on an issue cannot be started, as a sentence. */
export function startBlockerText(blocker: StartBlocker): string {
  switch (blocker.kind) {
    case 'checking':
      return 'Hoot is still checking whether Claude Code is installed.'
    case 'not-installed':
      return 'Claude Code is not installed: install it in the Agents page.'
    case 'outdated':
      return `${minimumVersionText('claude')}: update it in the Agents page.`
    case 'no-agent':
      return 'Claude Code has no agent turned on: set one up in the Agents page.'
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

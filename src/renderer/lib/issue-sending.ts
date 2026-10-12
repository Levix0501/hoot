import type { ToolsState } from '../../shared/ipc'
import { ISSUE_SEND_MAX_LENGTH, issueSendLength, type Issue } from '../../shared/issues'
import { getTool } from '../../shared/tools'
import { toolStatus } from './tool-status'

/**
 * Why an issue cannot be sent to Claude Code now: Claude Code is still being
 * checked for, it is not installed, or the issue is too long.
 */
export type SendBlocker = 'checking' | 'not-installed' | 'too-long'

/** Every reason an issue cannot be sent to Claude Code now; none when it can be. */
export function sendBlockers(
  tools: ToolsState,
  issue: Pick<Issue, 'title' | 'description'>,
): SendBlocker[] {
  const blockers: SendBlocker[] = []
  const status = toolStatus(tools, getTool('claude'))
  if (status !== 'available') blockers.push(status)
  if (issueSendLength(issue) > ISSUE_SEND_MAX_LENGTH) blockers.push('too-long')
  return blockers
}

import type { ToolsState } from '../../shared/ipc'
import { getTool } from '../../shared/tools'
import { toolStatus } from './tool-status'

/**
 * Why an issue cannot be sent to Claude Code now: Claude Code is still being
 * checked for, or it is not installed.
 */
export type SendBlocker = 'checking' | 'not-installed'

/** Every reason an issue cannot be sent to Claude Code now; none when it can be. */
export function sendBlockers(tools: ToolsState): SendBlocker[] {
  const status = toolStatus(tools, getTool('claude'))
  return status === 'available' ? [] : [status]
}

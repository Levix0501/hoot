import type { ToolsState } from './ipc'
import type { ToolDefinition } from './tools'

/**
 * Whether a tool can start sessions: the shell always can; a coding tool can
 * once its command has been found on the login shell PATH. Until the first
 * detection has finished it is still being checked for; a detection that runs
 * again leaves the last one's result standing.
 */
export type ToolStatus = 'available' | 'checking' | 'not-installed'

export function toolStatus(tools: ToolsState, tool: ToolDefinition): ToolStatus {
  if (tool.command === null) return 'available'
  const availability = tools.tools.find((entry) => entry.id === tool.id)
  if (availability === undefined) return 'checking'
  return availability.available ? 'available' : 'not-installed'
}

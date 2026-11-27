import { belowMinimumVersion } from './agents'
import type { ToolsState } from './ipc'
import type { ToolDefinition } from './tools'

/**
 * Whether a tool can start sessions: the shell always can; a coding tool can
 * once its command has been found on the login shell PATH, unless the
 * version it reports is older than the oldest Hoot works with (see
 * `minimumVersion`). One whose version could not be read is taken to be
 * new enough. Until the first detection has finished it is still being
 * checked for; a detection that runs again leaves the last one's result
 * standing.
 */
export type ToolStatus = 'available' | 'checking' | 'not-installed' | 'outdated'

export function toolStatus(tools: ToolsState, tool: ToolDefinition): ToolStatus {
  if (tool.command === null) return 'available'
  const availability = tools.tools.find((entry) => entry.id === tool.id)
  if (availability === undefined) return 'checking'
  if (!availability.available) return 'not-installed'
  return availability.version !== null && belowMinimumVersion(tool.id, availability.version)
    ? 'outdated'
    : 'available'
}

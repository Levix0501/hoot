/**
 * How a session's terminal quotes the paths of the files and folders dropped
 * on it: as Windows Terminal quotes them on Windows, and as words of a POSIX
 * shell elsewhere.
 */
export type DroppedPathQuoting = 'windows' | 'posix'

/** How dropped paths are quoted on `platform` (a `process.platform` value). */
export function droppedPathQuotingFor(platform: string): DroppedPathQuoting {
  return platform === 'win32' ? 'windows' : 'posix'
}

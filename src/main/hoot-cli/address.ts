import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

/**
 * The longest Unix domain socket path, in bytes, that hoot and the tools
 * around it can connect to on macOS: Node accepts 104 bytes, Python and curl
 * 103.
 */
export const MAX_SOCKET_PATH_BYTES = 103

/** A name for a user data directory: the start of its path's SHA-256. */
function directoryHash(userData: string): string {
  return createHash('sha256').update(userData).digest('hex').slice(0, 16)
}

/**
 * Where the Hoot that keeps its data in `userData` listens for hoot: a named
 * pipe on Windows; elsewhere a Unix domain socket in the user data directory,
 * or in the folder for temporary files when that path would be too long to
 * connect to. Hoots with different user data directories listen in different
 * places, so each session's hoot reaches the Hoot that started it.
 */
export function hootSocketPath(
  userData: string,
  platform: NodeJS.Platform = process.platform,
  temporaryFolder: string = os.tmpdir(),
): string {
  if (platform === 'win32') return `\\\\.\\pipe\\hoot-${directoryHash(userData)}`
  const inUserData = path.posix.join(userData, 'hoot.sock')
  if (Buffer.byteLength(inUserData) <= MAX_SOCKET_PATH_BYTES) return inUserData
  return path.posix.join(temporaryFolder, `hoot-${directoryHash(userData)}.sock`)
}

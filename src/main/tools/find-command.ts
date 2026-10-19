import path from 'node:path'
import pathKey from 'path-key'
import which from 'which'
import type { Env } from '../env/env'

/**
 * The absolute folders on an environment's PATH, in order. PATH is read by the
 * name the environment gives it: on Windows, where the names of variables are
 * not case-sensitive, that is usually `Path`. Relative entries are ignored:
 * they would resolve against the working directory of Hoot itself, not the
 * project's.
 */
export function pathFolders(env: Env, platform: NodeJS.Platform = process.platform): string[] {
  const paths = platform === 'win32' ? path.win32 : path.posix
  return (env[pathKey({ env, platform })] ?? '')
    .split(paths.delimiter)
    .filter((entry) => paths.isAbsolute(entry))
}

/**
 * Looks a command up in an environment's PATH the way a shell would. Only the
 * folders on PATH are searched, also on Windows, where `which` would look in
 * Hoot's working directory first.
 */
export async function findCommand(command: string, env: Env): Promise<string | null> {
  for (const folder of pathFolders(env)) {
    // Given a path, `which` only checks that file: on Windows, with the
    // extensions in PATHEXT.
    const found = await which(path.join(folder, command), { nothrow: true })
    if (found) return found
  }
  return null
}

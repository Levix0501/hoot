import path from 'node:path'
import which from 'which'

/**
 * Looks a command up in a PATH value the way a shell would. Relative PATH
 * entries are ignored: they would resolve against the working directory of
 * Hoot itself, not the project's.
 */
export function findCommand(
  command: string,
  pathValue: string | undefined,
): Promise<string | null> {
  const directories = (pathValue ?? '')
    .split(path.delimiter)
    .filter((entry) => path.isAbsolute(entry))
  if (directories.length === 0) return Promise.resolve(null)
  return which(command, { path: directories.join(path.delimiter), nothrow: true })
}

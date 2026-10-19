// Helpers for the unit tests of agents: global folders of npm, laid out as
// npm lays them out on each platform.
import fs from 'node:fs'
import path from 'node:path'
import cmdShim from 'cmd-shim'

/** Where a global folder of npm has its packages: `lib/node_modules`; on Windows `node_modules`. */
export function npmPackagesFolder(prefix: string): string {
  return process.platform === 'win32'
    ? path.join(prefix, 'node_modules')
    : path.join(prefix, 'lib', 'node_modules')
}

/**
 * Where a global folder of npm has the commands of its packages, and npm its
 * own: `bin`; on Windows the global folder itself.
 */
export function npmCommandsFolder(prefix: string): string {
  return process.platform === 'win32' ? prefix : path.join(prefix, 'bin')
}

/**
 * Puts the command of a package's file in a folder of commands, as npm does,
 * and returns its path: a symbolic link to the file; on Windows, the batch
 * file that runs it.
 */
export async function linkCommand(file: string, folder: string, name: string): Promise<string> {
  if (process.platform === 'win32') {
    await cmdShim(file, path.join(folder, name))
    return path.join(folder, `${name}.cmd`)
  }
  const command = path.join(folder, name)
  fs.mkdirSync(folder, { recursive: true })
  fs.rmSync(command, { force: true })
  fs.symlinkSync(file, command)
  return command
}

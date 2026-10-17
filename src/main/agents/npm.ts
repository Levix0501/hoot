import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Env } from '../env/env'
import { prependToPath } from '../env/session-env'
import { findCommand } from '../tools/find-command'
import { commandProgram, type CommandProgram } from '../tools/command-program'
import { canonicalPath } from './agent-paths'
import { runCommand } from './processes'

/** How long npm may take to say where its global folder is. */
const PREFIX_TIMEOUT_MS = 20_000

/** The npm a computer has: the first on the login shell PATH. */
export interface ComputerNpm {
  /** The command's path. */
  path: string
  /** Its global folder, as it is on disk. */
  prefix: string
  /**
   * Whether the user can create files where it installs packages and their
   * commands, so that Hoot can install agents with it.
   */
  usable: boolean
}

/**
 * The global folder of an npm, as `npm prefix -g` says, run with `env`; or
 * `null` when it does not run or does not say. The folder is returned as it
 * is on disk. On Windows, where its command is a batch file, what that points
 * to runs instead (see `commandProgram`).
 */
export async function npmGlobalFolder(
  npm: string,
  env: Env,
  cwd: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  let program: CommandProgram
  try {
    program = await commandProgram(npm, env, platform)
  } catch {
    return null
  }
  const result = await runCommand(
    { file: program.file, args: [...program.args, 'prefix', '-g'], env, cwd },
    PREFIX_TIMEOUT_MS,
  )
  if (result.code !== 0) return null
  const prefix = result.stdout.trim().split('\n').at(-1)?.trim() ?? ''
  return path.isAbsolute(prefix) ? canonicalPath(prefix) : null
}

/**
 * The global folder of an npm that is not the first on PATH, such as the one
 * in another global folder: run with its own folder first on PATH, so that it
 * runs with the node beside it.
 */
export function npmGlobalFolderOf(
  npm: string,
  env: Env,
  cwd: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  const ownEnv = { ...env }
  prependToPath(ownEnv, path.dirname(npm), platform)
  return npmGlobalFolder(npm, ownEnv, cwd, platform)
}

/**
 * Whether the user can create files in a folder: in it, or, while it does
 * not exist yet, in the nearest of its parents that does, where it would be
 * created.
 */
export async function canCreateFilesIn(directory: string): Promise<boolean> {
  let current = path.resolve(directory)
  for (;;) {
    try {
      const stats = await fs.stat(current)
      if (!stats.isDirectory()) return false
      await fs.access(current, constants.W_OK | constants.X_OK)
      return true
    } catch (error) {
      const parent = path.dirname(current)
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || parent === current) return false
      current = parent
    }
  }
}

/**
 * The computer's npm, the first on the login shell PATH, if it runs: where
 * its global folder is, and whether the user can install packages into it,
 * which npm puts in its `lib/node_modules` folder, with their commands in its
 * `bin` folder; on Windows, in its `node_modules` folder and in the global
 * folder itself.
 */
export async function findComputerNpm(
  env: Env,
  cwd: string,
  platform: NodeJS.Platform = process.platform,
): Promise<ComputerNpm | null> {
  const npm = await findCommand('npm', env)
  if (npm === null) return null
  const prefix = await npmGlobalFolder(npm, env, cwd, platform)
  if (prefix === null) return null
  const modules =
    platform === 'win32'
      ? path.join(prefix, 'node_modules')
      : path.join(prefix, 'lib', 'node_modules')
  const commands = platform === 'win32' ? prefix : path.join(prefix, 'bin')
  const usable = (await canCreateFilesIn(modules)) && (await canCreateFilesIn(commands))
  return { path: npm, prefix, usable }
}

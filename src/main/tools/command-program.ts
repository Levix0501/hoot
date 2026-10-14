import path from 'node:path'
import readCmdShim from 'read-cmd-shim'
import which from 'which'
import type { Env } from '../env/env'
import { findCommand } from './find-command'

/** What runs a command: a program, and the arguments that go before the command's own. */
export interface CommandProgram {
  file: string
  args: string[]
}

/** On Windows, a file that runs as a program of its own. */
const PROGRAM_FILE = /\.(com|exe)$/i

/** On Windows, a batch file for cmd.exe, such as the shim npm or pnpm makes for a command. */
const CMD_FILE = /\.cmd$/i

/**
 * The file that a shim of npm or pnpm points to, or `null` when the file is
 * no such shim. read-cmd-shim knows a shim by its extension spelled `.cmd`,
 * which `which` spells as PATHEXT does, usually `.CMD`.
 */
async function shimTarget(shim: string): Promise<string | null> {
  try {
    const target = await readCmdShim(shim.replace(CMD_FILE, '.cmd'))
    // Named relative to the shim's folder, with `\` between folders.
    return path.resolve(path.dirname(shim), ...target.split('\\'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOTASHIM') return null
    throw error
  }
}

/**
 * What runs a command found on PATH, with nothing in between that reads its
 * arguments. Outside Windows, the command itself. On Windows, a program runs
 * as it is, but the command of a package installed with npm or pnpm is a
 * batch file, which Windows would run with cmd.exe: that would end an
 * argument at its first line break, and take `&`, `|`, `%` or `^` in one for
 * its own. What the batch file points to runs instead, as the batch file
 * would run it: a program as it is; a script with the `node.exe` next to the
 * batch file, if there is one, or else the first on PATH.
 */
export async function commandProgram(
  command: string,
  env: Env,
  platform: NodeJS.Platform = process.platform,
): Promise<CommandProgram> {
  if (platform !== 'win32' || PROGRAM_FILE.test(command)) return { file: command, args: [] }
  const target = CMD_FILE.test(command) ? await shimTarget(command) : null
  if (target === null) {
    throw new Error(`${command} is neither a program nor a command that npm or pnpm installed.`)
  }
  if (PROGRAM_FILE.test(target)) return { file: target, args: [] }
  const node =
    (await which(path.join(path.dirname(command), 'node.exe'), { nothrow: true })) ??
    (await findCommand('node.exe', env))
  if (node === null) throw new Error(`Node.js, which runs ${target}, is not on PATH.`)
  return { file: node, args: [target] }
}

// Helpers for the unit tests that find and run commands: stand-ins for
// commands, written as each platform runs them.
import fs from 'node:fs'
import path from 'node:path'
import cmdShim from 'cmd-shim'
import { quote } from 'shell-quote'
import type { CommandProgram } from './command-program'

/** A PATH of these folders, separated as on this platform. */
export function onPath(...folders: string[]): string {
  return folders.join(path.delimiter)
}

/**
 * Writes a stand-in for a command that runs a Node.js script, kept beside it
 * as `<file>.cjs`, and returns the path a PATH lookup finds it at. Outside
 * Windows, the command is `file`, as `writeNodeScript` writes it. On Windows,
 * it is the batch file `<file>.cmd` that npm makes for the script of a
 * package, with the Node.js running the tests linked as the `node.exe` next
 * to it, which runs the script for Hoot and for cmd.exe alike. A lookup there
 * spells the extension as PATHEXT does, usually `.CMD`: compare the paths
 * with `samePath`.
 */
export async function writeNodeCommand(file: string, script: string): Promise<string> {
  if (process.platform !== 'win32') {
    writeNodeScript(file, script)
    return file
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const target = `${file}.cjs`
  fs.writeFileSync(target, `#!/usr/bin/env node\n${script}`)
  await cmdShim(target, file)
  const node = path.join(path.dirname(file), 'node.exe')
  if (!fs.existsSync(node)) linkNode(node)
  return `${file}.cmd`
}

/**
 * Writes, outside Windows, the executable `file`, which runs the Node.js
 * script `script`, kept beside it as `<file>.cjs`, with the Node.js running
 * the tests: a script for sh that runs it by its path, which the PATH a test
 * gives need not have, and which a shebang line could not name where it has
 * a space, as under `~/Library/Application Support`.
 */
export function writeNodeScript(file: string, script: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const target = `${file}.cjs`
  fs.writeFileSync(target, script)
  const run = `exec ${quote([process.execPath, target])} "$@"`
  fs.writeFileSync(file, `#!/bin/sh\n${run}\n`, { mode: 0o755 })
}

/**
 * What runs the stand-in that `writeNodeCommand` wrote at `file`, as
 * `commandProgram` finds it: the command itself; on Windows, the `node.exe`
 * next to the batch file, with the script it points to.
 */
export function nodeCommandProgram(file: string): CommandProgram {
  if (process.platform !== 'win32') return { file, args: [] }
  return { file: path.join(path.dirname(file), 'node.exe'), args: [`${file}.cjs`] }
}

/**
 * Links the Node.js that runs the tests at `link`: with a hard link where it
 * is on the same drive, which needs no rights, or else with a symbolic link,
 * which Windows lets only administrators and, in Developer Mode, anyone make.
 */
function linkNode(link: string): void {
  try {
    fs.linkSync(process.execPath, link)
  } catch {
    fs.symlinkSync(process.execPath, link)
  }
}

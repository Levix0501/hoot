import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { envVariable, type Env } from '../env/env'
import type { SessionShell } from './default-shell'

/** What opens the system's terminal: a program, its arguments, and the folder it runs in. */
export interface TerminalLaunch {
  file: string
  args: string[]
  cwd: string
}

/**
 * What opens the system's terminal in `folder` on `platform`, or `null`
 * outside macOS and Windows, where Hoot does not run. macOS names no terminal
 * of the user's, so there it is Terminal, which opens a window in the folder
 * it is given. On Windows, cmd's `start` runs `shell`, the shell that Shell
 * sessions run, in a console of its own, which Windows shows in the default
 * terminal application its settings name: Windows Terminal or the console
 * host. cmd runs in the folder, where the shell then starts, and skips its
 * AutoRun commands, which could move it elsewhere first. The empty argument
 * is the window title `start` takes from its first quoted argument, which
 * would otherwise be the path of a shell that has to be quoted.
 */
export function systemTerminalLaunch(
  folder: string,
  shell: SessionShell,
  env: Env,
  platform: NodeJS.Platform = process.platform,
): TerminalLaunch | null {
  if (platform === 'darwin') {
    return { file: '/usr/bin/open', args: ['-b', 'com.apple.Terminal', folder], cwd: folder }
  }
  if (platform === 'win32') {
    const cmd =
      envVariable(env, 'ComSpec', platform) ??
      path.win32.join(
        envVariable(env, 'SystemRoot', platform) ?? 'C:\\Windows',
        'System32',
        'cmd.exe',
      )
    return { file: cmd, args: ['/d', '/c', 'start', '', shell.file, ...shell.args], cwd: folder }
  }
  return null
}

/**
 * Opens the system's terminal in `folder` (see `systemTerminalLaunch`), in
 * `env`, the environment Hoot started with. Resolves once the terminal has
 * been asked to open; rejects with what went wrong, such as a folder that is
 * not there.
 */
export async function openSystemTerminal(
  folder: string,
  shell: SessionShell,
  env: Env,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const stats = await fs.promises.stat(folder).catch(() => null)
  if (!stats?.isDirectory()) throw new Error(`The folder is missing: ${folder}`)
  const launch = systemTerminalLaunch(folder, shell, env, platform)
  if (launch === null) throw new Error('Hoot cannot open a terminal on this system.')
  await new Promise<void>((resolve, reject) => {
    const child = spawn(launch.file, launch.args, {
      cwd: launch.cwd,
      env,
      // On Windows, cmd then runs without a console window of its own, and
      // the shell it starts is handed no pipe of Hoot's to hold open.
      detached: true,
      stdio: 'ignore',
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${launch.file} ended with ${code ?? signal}.`))
    })
  })
}

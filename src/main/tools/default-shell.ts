import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Env } from '../env/env'
import { pathFolders } from './find-command'

/** The shell that Shell sessions run: its program, and the arguments it starts with. */
export interface SessionShell {
  file: string
  args: string[]
}

/** A variable of the environment by its name in any case, as Windows reads it. */
function windowsVariable(env: Env, name: string): string | undefined {
  const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name.toUpperCase())
  return key === undefined ? undefined : env[key]
}

/**
 * The shell that Shell sessions run. Outside Windows, the user's default
 * shell, as a login shell: the one SHELL names, or else the one of the user's
 * account, or else zsh, or else sh. Windows names no shell of the user's, so
 * there it is PowerShell, which VS Code also runs by default: the first
 * PowerShell 7 on PATH, or else the Windows PowerShell that comes with
 * Windows, both without their banner. SHELL is left aside there, where only
 * Git Bash sets it, so that Shell sessions run the same shell however Hoot
 * was started.
 */
export function defaultShell(env: Env, platform: NodeJS.Platform = process.platform): SessionShell {
  if (platform === 'win32') {
    const pwsh = pathFolders(env, platform)
      .map((folder) => path.join(folder, 'pwsh.exe'))
      .find((file) => fs.existsSync(file))
    const windowsPowerShell = path.win32.join(
      windowsVariable(env, 'SystemRoot') ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    )
    return { file: pwsh ?? windowsPowerShell, args: ['-NoLogo'] }
  }
  const file = [env.SHELL, os.userInfo().shell, '/bin/zsh'].find(
    (candidate) => candidate && path.isAbsolute(candidate) && fs.existsSync(candidate),
  )
  return { file: file ?? '/bin/sh', args: ['-l'] }
}

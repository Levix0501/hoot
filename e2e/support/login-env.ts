import { spawnSync } from 'node:child_process'
import type { World } from './world'

/**
 * The login shell environment for a world: the environment the default shell
 * has after starting as an interactive login shell from the environment
 * Hoot is launched with.
 */
export function referenceLoginEnv(world: World): Record<string, string> {
  const shell = world.env.SHELL ?? '/bin/zsh'
  const result = spawnSync(shell, ['-i', '-l', '-c', '/usr/bin/env -0'], {
    env: world.env,
    cwd: world.home,
    encoding: 'utf8',
  })
  const env: Record<string, string> = {}
  for (const entry of result.stdout.split('\0')) {
    const separator = entry.indexOf('=')
    if (separator > 0) env[entry.slice(0, separator)] = entry.slice(separator + 1)
  }
  return env
}

/** Terminal variables: the terminal itself, locale and encoding. */
export function isTerminalVariable(name: string): boolean {
  return /^(TERM|COLORTERM|TERM_PROGRAM|TERM_PROGRAM_VERSION|LANG|LC_[A-Z_]+)$/.test(name)
}

/** Variables that change with each shell instance. */
export const SHELL_INSTANCE_VARIABLES = new Set(['PWD', 'OLDPWD', 'SHLVL', '_'])

/** Process metadata macOS sets for each launched application. */
export const PROCESS_METADATA_VARIABLES = new Set([
  'XPC_SERVICE_NAME',
  'XPC_FLAGS',
  '__CFBundleIdentifier',
])

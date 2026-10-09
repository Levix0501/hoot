import fs from 'node:fs'
import type { Env } from './env'

export interface TerminalEnvOptions {
  appVersion: string
  /** Locale to use for LANG when the environment does not define one. */
  fallbackLang: string
}

/**
 * Variables that describe the terminal itself. They are the only variables
 * Hoot adds to a session environment, and they are the same for every tool.
 */
export function terminalEnvironment(options: TerminalEnvOptions): Env {
  return {
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'hoot',
    TERM_PROGRAM_VERSION: options.appVersion,
  }
}

/** Variables that only describe the shell instance the environment was read from. */
const SHELL_INSTANCE_VARIABLES = ['OLDPWD', 'SHLVL', '_']

/**
 * Builds the environment of a session process from the environment it should
 * inherit, adding only terminal variables.
 */
export function buildSessionEnv(source: Env, options: TerminalEnvOptions & { cwd: string }): Env {
  const env: Env = { ...source }
  for (const name of SHELL_INSTANCE_VARIABLES) delete env[name]
  env.PWD = options.cwd
  Object.assign(env, terminalEnvironment(options))
  if (!env.LANG) env.LANG = options.fallbackLang
  return env
}

/**
 * The locale used for LANG when the environment does not set one: `C.UTF-8`,
 * the default macOS gives zsh login shells, or `en_US.UTF-8` where that locale
 * is not installed.
 */
export function fallbackUtf8Locale(
  exists: (name: string) => boolean = (name) => fs.existsSync(`/usr/share/locale/${name}`),
): string {
  return exists('C.UTF-8') ? 'C.UTF-8' : 'en_US.UTF-8'
}

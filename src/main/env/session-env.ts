import fs from 'node:fs'
import path from 'node:path'
import pathKey from 'path-key'
import { HOOT_ENV } from '../../shared/hoot-cli'
import type { Env } from './env'

export interface TerminalEnvOptions {
  appVersion: string
  /** Locale to use for LANG when the environment does not define one. */
  fallbackLang: string
}

/** What a session's process needs to run hoot, Hoot's command line program. */
export interface HootCliEnvOptions {
  /** The folder of hoot's launchers, which goes first on PATH. */
  binDirectory: string
  /** Hoot's own executable, which runs hoot's script as Node.js. */
  node: string
  /** hoot's script. */
  script: string
  /** Where the Hoot that starts the session listens for hoot. */
  socket: string
  /** The session's id, by which that Hoot knows the session's project. */
  sessionId: string
}

/**
 * Variables that describe the terminal itself. They are the same for every
 * tool and every session.
 */
export function terminalEnvironment(options: TerminalEnvOptions): Env {
  return {
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'hoot',
    TERM_PROGRAM_VERSION: options.appVersion,
  }
}

/**
 * Variables that tell hoot, run in the session, how to run and which Hoot
 * and session it runs for.
 */
export function hootCliEnvironment(options: HootCliEnvOptions): Env {
  return {
    [HOOT_ENV.socket]: options.socket,
    [HOOT_ENV.sessionId]: options.sessionId,
    [HOOT_ENV.node]: options.node,
    [HOOT_ENV.script]: options.script,
  }
}

/**
 * Puts a folder first on the environment's PATH. On Windows, where the names
 * of variables are not case-sensitive, it changes the variable the
 * environment has, which is usually `Path`, and separates the folders with `;`.
 */
export function prependToPath(env: Env, directory: string, platform: NodeJS.Platform): void {
  const name = pathKey({ env, platform })
  const delimiter = platform === 'win32' ? path.win32.delimiter : path.posix.delimiter
  const current = env[name]
  env[name] = current ? `${directory}${delimiter}${current}` : directory
}

/** Variables that only describe the shell instance the environment was read from. */
const SHELL_INSTANCE_VARIABLES = ['OLDPWD', 'SHLVL', '_']

/**
 * Builds the environment of a session process from the environment it should
 * inherit. It adds only the terminal variables and what hoot needs: its
 * variables, and the folder of its launchers first on PATH.
 */
export function buildSessionEnv(
  source: Env,
  options: TerminalEnvOptions & {
    cwd: string
    hoot: HootCliEnvOptions
    platform?: NodeJS.Platform
  },
): Env {
  const platform = options.platform ?? process.platform
  const env: Env = { ...source }
  for (const name of SHELL_INSTANCE_VARIABLES) delete env[name]
  env.PWD = options.cwd
  Object.assign(env, terminalEnvironment(options), hootCliEnvironment(options.hoot))
  prependToPath(env, options.hoot.binDirectory, platform)
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

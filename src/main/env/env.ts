export type Env = Record<string, string>

/** Copies a `process.env`-like object, dropping unset values. */
export function toEnv(source: NodeJS.ProcessEnv): Env {
  const env: Env = {}
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined) env[name] = value
  }
  return env
}

/**
 * Variables that development tooling or Electron itself may add to the main
 * process environment. They are not part of the user's login session and are
 * never passed on to sessions.
 */
const LAUNCHER_VARIABLES = [
  'VITE_DEV_SERVER_URL',
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ATTACH_CONSOLE',
  'ELECTRON_ENABLE_LOGGING',
  'ELECTRON_ENABLE_STACK_DUMPING',
]

/**
 * The environment Hoot was started with, which is the graphical login
 * session environment when it is opened from Finder, the Dock or `pnpm start`.
 */
export function captureBaseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const env = toEnv(source)
  for (const name of LAUNCHER_VARIABLES) delete env[name]
  return env
}

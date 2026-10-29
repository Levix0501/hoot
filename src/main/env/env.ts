export type Env = Record<string, string>

/** The names a variable of the environment goes by: in any case on Windows, which reads them so. */
function namesOf(env: Env, name: string, platform: NodeJS.Platform): string[] {
  if (platform !== 'win32') return Object.hasOwn(env, name) ? [name] : []
  return Object.keys(env).filter((key) => key.toUpperCase() === name.toUpperCase())
}

/** A variable of the environment by its name, in any case on Windows. */
export function envVariable(
  env: Env,
  name: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const [key] = namesOf(env, name, platform)
  return key === undefined ? undefined : env[key]
}

/** Sets a variable of the environment, in place of the one of that name in any case on Windows. */
export function setEnvVariable(
  env: Env,
  name: string,
  value: string,
  platform: NodeJS.Platform = process.platform,
): void {
  for (const key of namesOf(env, name, platform)) delete env[key]
  env[name] = value
}

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

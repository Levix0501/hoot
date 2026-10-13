import os from 'node:os'
import path from 'node:path'
import type { HootCliEnvOptions } from '../env/session-env'
import { hootSocketPath } from './address'

export interface HootCliSetupOptions {
  /** The user data directory of this Hoot. */
  userData: string
  /** Whether this Hoot runs packaged, rather than from its repository. */
  packaged: boolean
  /** The packaged app's folder of resources. */
  resourcesPath: string
  /** The folder of the app: the repository, for a Hoot run from it. */
  appPath: string
  /** Hoot's own executable. */
  executable: string
  /** The folder of the main process's script. */
  mainDirectory: string
  platform?: NodeJS.Platform
  temporaryFolder?: string
}

/**
 * What every session needs to run hoot, Hoot's command line program: the
 * folder of its launchers, which goes first on PATH (in the packaged app's
 * resources, or in the repository); Hoot's own executable, which runs its
 * script as Node.js; the script, beside the main process's; and where this
 * Hoot listens for it, which depends on the user data directory, so that each
 * session's hoot reaches the Hoot that started it.
 */
export function hootCliSetup(options: HootCliSetupOptions): Omit<HootCliEnvOptions, 'sessionId'> {
  const platform = options.platform ?? process.platform
  const paths = platform === 'win32' ? path.win32 : path.posix
  return {
    binDirectory: options.packaged
      ? paths.join(options.resourcesPath, 'bin')
      : paths.join(options.appPath, 'resources', 'bin'),
    node: options.executable,
    script: paths.join(options.mainDirectory, '..', 'cli', 'index.js'),
    socket: hootSocketPath(options.userData, platform, options.temporaryFolder ?? os.tmpdir()),
  }
}

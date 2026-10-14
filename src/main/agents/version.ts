import { parseVersion } from '../../shared/agents'
import type { Env } from '../env/env'
import { runCommand } from './processes'
import { terminalText } from './terminal-text'

/** How long an agent may take to say its version. */
const VERSION_TIMEOUT_MS = 20_000

/** What running an agent's command with `--version` showed. */
export interface VersionReading {
  /** The version it reported; `null` when it does not run. */
  version: string | null
  /** What it wrote, and how it ended, kept when it does not run. */
  output: string
}

/**
 * Runs an agent's command with `--version` and reads the version it reports.
 * It does not run when it cannot start, does not exit with 0, or reports no
 * version; what it wrote is kept then, followed by how it ended.
 */
export async function readVersion(
  command: string,
  env: Env,
  cwd: string,
  timeoutMs = VERSION_TIMEOUT_MS,
): Promise<VersionReading> {
  const result = await runCommand({ file: command, args: ['--version'], env, cwd }, timeoutMs)
  const output = await terminalText(result.output)
  const version = parseVersion(output)
  if (result.code === 0 && version !== null) return { version, output: '' }
  let ending: string
  if (result.error) ending = `It could not start: ${result.error.message}`
  else if (result.timedOut) ending = `It did not finish within ${timeoutMs / 1000} seconds.`
  else if (result.signal) ending = `It was ended by ${result.signal}.`
  else if (result.code !== 0) ending = `It exited with code ${result.code}.`
  else ending = 'It reported no version.'
  return { version: null, output: output === '' ? ending : `${output}\n${ending}` }
}

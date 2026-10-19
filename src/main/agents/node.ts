import { satisfies, validRange } from 'semver'
import type { UnmetNodeRequirement } from '../../shared/agents'
import type { Env } from '../env/env'
import { findCommand } from '../tools/find-command'
import { readVersion } from './version'

/**
 * The version of the node that sessions run an agent's JavaScript command
 * with: the first on the login shell PATH, which `#!/usr/bin/env node` finds
 * in a session's environment. `null` when there is none, or it does not run.
 */
export async function readNodeVersion(
  env: Env,
  cwd: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  const node = await findCommand('node', env)
  if (node === null) return null
  return (await readVersion(node, env, cwd, platform)).version
}

/**
 * The requirement that a node's version does not meet, when it does not:
 * `null` when it does, when either is not known, or when the range cannot be
 * read. A pre-release of Node.js counts as the release it leads to.
 */
export function unmetNodeRequirement(
  range: string | null,
  found: string | null,
): UnmetNodeRequirement | null {
  if (range === null || found === null || validRange(range) === null) return null
  return satisfies(found, range, { includePrerelease: true }) ? null : { range, found }
}

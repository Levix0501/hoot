import fs from 'node:fs/promises'
import path from 'node:path'
import { HOOT_ENV } from '../../shared/hoot-cli'
import { displayPath } from '../../shared/paths'
import type { Env } from '../env/env'
import { appendToPath } from '../env/session-env'

/** Where Hoot keeps the agents it installs, and what it runs them and npm with. */
export interface AgentPaths {
  /**
   * Hoot's folder of agents, `~/.hoot/agents`: the global folder of the npm
   * that comes with Hoot, which installs agents there when the computer has
   * no npm Hoot can use.
   */
  directory: string
  /** Where that npm puts the agents' commands. */
  binDirectory: string
  /**
   * The folder of Hoot's `node`, which runs Hoot's own executable as Node.js
   * for whatever needs a node and finds no other, such as Codex's command.
   */
  nodeDirectory: string
  /** The script of the npm that comes with Hoot. */
  npmCli: string
  /** Hoot's own executable, which runs that npm, and `node`, as Node.js. */
  executable: string
}

export interface AgentPathsOptions {
  home: string
  /** Whether this Hoot runs packaged, rather than from its repository. */
  packaged: boolean
  /** The packaged app's folder of resources. */
  resourcesPath: string
  /** The folder of the app: the repository, for a Hoot run from it. */
  appPath: string
  /** Hoot's own executable. */
  executable: string
}

/**
 * Where Hoot keeps the agents it installs: in the home folder, so that an
 * installed Hoot and one run from its repository share them. Its `node` and
 * npm are in the packaged app's resources, or in the repository.
 */
export function agentPaths(options: AgentPathsOptions): AgentPaths {
  const directory = path.join(options.home, '.hoot', 'agents')
  return {
    directory,
    binDirectory: path.join(directory, 'bin'),
    nodeDirectory: options.packaged
      ? path.join(options.resourcesPath, 'node')
      : path.join(options.appPath, 'resources', 'node'),
    npmCli: options.packaged
      ? path.join(options.resourcesPath, 'npm', 'bin', 'npm-cli.js')
      : path.join(options.appPath, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    executable: options.executable,
  }
}

/**
 * The folders that go last on the PATH of every session on macOS, after every
 * folder it has: Hoot's `node`, and Hoot's folder of agents' commands. A node
 * or an agent of the user's comes first.
 */
export function lastOnSessionPath(paths: AgentPaths): string[] {
  return [paths.nodeDirectory, paths.binDirectory]
}

/**
 * An environment as a session's process has it for running agents: on macOS,
 * with Hoot's `node` and Hoot's folder of agents' commands last on PATH, and
 * Hoot's executable named for that `node`; elsewhere nothing changes, Hoot
 * having no `node` of its own there.
 */
export function withHootNode(
  env: Env,
  paths: AgentPaths,
  platform: NodeJS.Platform = process.platform,
): Env {
  if (platform !== 'darwin') return env
  const result: Env = { ...env, [HOOT_ENV.node]: paths.executable }
  for (const directory of lastOnSessionPath(paths)) appendToPath(result, directory, 'darwin')
  return result
}

/**
 * A path as it is on disk, its symbolic links followed; for a path whose end
 * does not exist, the one of the nearest folder of it that does, with the rest
 * after it.
 */
export async function canonicalPath(file: string): Promise<string> {
  const resolved = path.resolve(file)
  try {
    return await fs.realpath(resolved)
  } catch {
    const parent = path.dirname(resolved)
    if (parent === resolved) return resolved
    return path.join(await canonicalPath(parent), path.basename(resolved))
  }
}

/**
 * A path as the Agents page shows it, with `~` for the home folder, whether
 * the path is written with the home folder as it is set or as it is on disk.
 */
export function homeDisplayPath(file: string, home: string, canonicalHome: string): string {
  return displayPath(displayPath(file, home), canonicalHome)
}

/**
 * Whether two paths name the same file: as written, and on Windows also when
 * they differ in case alone, which its file systems do not tell apart.
 */
export function samePath(
  a: string,
  b: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

/** The rules by which paths are written on `platform`. */
function pathRules(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix
}

/** Whether a path is inside a folder, below it rather than the folder itself. */
export function isInside(
  file: string,
  directory: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const paths = pathRules(platform)
  const relative = paths.relative(paths.resolve(directory), paths.resolve(file))
  return relative !== '' && !relative.startsWith('..') && !paths.isAbsolute(relative)
}

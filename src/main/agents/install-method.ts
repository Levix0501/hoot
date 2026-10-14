import path from 'node:path'
import which from 'which'
import type { CodingToolDefinition, CodingToolId } from '../../shared/tools'
import type { Env } from '../env/env'
import { canonicalPath, isInside } from './agent-paths'
import type { ComputerNpm } from './npm'

/**
 * How an agent was installed, with what updating it needs: for npm, the
 * global folder and the npm to run; for Homebrew, its `brew` and the formula
 * or cask to upgrade.
 */
export type DetectedInstallMethod =
  | {
      kind: 'npm'
      prefix: string
      /** The npm whose global folder it is: the computer's, or the one in the folder. */
      npm: string
      /** Whether that npm is the computer's, the first on the login shell PATH. */
      computer: boolean
    }
  | { kind: 'hoot' }
  | { kind: 'homebrew'; brew: string; name: string; cask: boolean }
  | { kind: 'official' }
  | { kind: 'unknown' }

export interface InstallMethodContext {
  /** The home folder. */
  home: string
  /** Hoot's folder of agents. */
  agentsDirectory: string
  /** The login shell environment, which may say where Codex keeps its files. */
  env: Env
  /** The computer's npm, if it runs. */
  computerNpm: ComputerNpm | null
  /** The global folder of an npm that is not the computer's, or `null` when it does not run. */
  npmGlobalFolder(npm: string): Promise<string | null>
}

/** The command each agent updates itself with, when its official installer installed it. */
export const OFFICIAL_UPDATE_COMMANDS: Record<CodingToolId, string> = {
  claude: 'update',
  codex: 'update',
  opencode: 'upgrade',
}

async function isExecutable(file: string): Promise<boolean> {
  return (await which(file, { nothrow: true })) !== null
}

/**
 * An installation by npm: the file is in `P/lib/node_modules/<package>/` of a
 * global folder P other than Hoot's, which is the computer's npm's, or has an
 * npm of its own in `P/bin` whose global folder it is.
 */
async function npmMethod(
  tool: CodingToolDefinition,
  target: string,
  agentsDirectory: string,
  context: InstallMethodContext,
): Promise<DetectedInstallMethod | null> {
  const marker = `/lib/node_modules/${tool.npmPackage}/`
  const index = target.indexOf(marker)
  if (index === -1) return null
  const prefix = index === 0 ? '/' : target.slice(0, index)
  if (prefix === agentsDirectory) return null
  const computer = context.computerNpm
  if (computer?.prefix === prefix) {
    return { kind: 'npm', prefix, npm: computer.path, computer: true }
  }
  const ownNpm = path.join(prefix, 'bin', 'npm')
  if ((await isExecutable(ownNpm)) && (await context.npmGlobalFolder(ownNpm)) === prefix) {
    return { kind: 'npm', prefix, npm: ownNpm, computer: false }
  }
  return null
}

/**
 * An installation by Homebrew: the file is in a formula's folder in the
 * `Cellar` folder of a Homebrew installation, or in a cask's in its
 * `Caskroom`, beside the installation's `bin/brew`.
 */
async function homebrewMethod(target: string): Promise<DetectedInstallMethod | null> {
  const segments = target.split('/')
  for (let index = 1; index < segments.length - 2; index++) {
    const folder = segments[index]
    const name = segments[index + 1]
    if ((folder !== 'Cellar' && folder !== 'Caskroom') || !name) continue
    const brew = path.join(segments.slice(0, index).join('/') || '/', 'bin', 'brew')
    if (await isExecutable(brew)) {
      return { kind: 'homebrew', brew, name, cask: folder === 'Caskroom' }
    }
  }
  return null
}

/**
 * An installation by the agent's official installer: Claude Code's file is
 * in `~/.local/share/claude/versions/`, Codex's in the `packages/standalone/`
 * folder of where it keeps its files (`CODEX_HOME`, or `~/.codex`), and
 * OpenCode's command is `~/.opencode/bin/opencode`.
 */
async function isOfficialInstallation(
  tool: CodingToolDefinition,
  command: string,
  target: string,
  context: InstallMethodContext,
): Promise<boolean> {
  switch (tool.id) {
    case 'claude':
      return isInside(
        target,
        await canonicalPath(path.join(context.home, '.local', 'share', 'claude', 'versions')),
      )
    case 'codex': {
      const configured = context.env.CODEX_HOME
      const codexHome =
        configured && path.isAbsolute(configured) ? configured : path.join(context.home, '.codex')
      return isInside(target, await canonicalPath(path.join(codexHome, 'packages', 'standalone')))
    }
    case 'opencode':
      return (
        path.basename(command) === 'opencode' &&
        (await canonicalPath(path.dirname(command))) ===
          (await canonicalPath(path.join(context.home, '.opencode', 'bin')))
      )
  }
}

/**
 * How an agent's command was installed, told from the file it leads to once
 * its symbolic links are followed: by Hoot, into Hoot's folder of agents; by
 * npm, into another global folder; by Homebrew; by the agent's official
 * installer; or, when it is none of these, some way Hoot cannot tell.
 */
export async function detectInstallMethod(
  tool: CodingToolDefinition,
  command: string,
  context: InstallMethodContext,
): Promise<DetectedInstallMethod> {
  const target = await canonicalPath(command)
  const agentsDirectory = await canonicalPath(context.agentsDirectory)
  if (isInside(target, path.join(agentsDirectory, 'lib', 'node_modules', tool.npmPackage))) {
    return { kind: 'hoot' }
  }
  return (
    (await npmMethod(tool, target, agentsDirectory, context)) ??
    (await homebrewMethod(target)) ??
    ((await isOfficialInstallation(tool, command, target, context))
      ? { kind: 'official' }
      : { kind: 'unknown' })
  )
}

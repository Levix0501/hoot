import path from 'node:path'
import which from 'which'
import type { CodingToolDefinition, CodingToolId } from '../../shared/tools'
import type { Env } from '../env/env'
import { commandTarget } from '../tools/command-program'
import { canonicalPath, isInside, samePath } from './agent-paths'
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
  | { kind: 'homebrew'; brew: string; name: string; cask: boolean }
  | { kind: 'official' }
  | { kind: 'unknown' }

export interface InstallMethodContext {
  /** The home folder. */
  home: string
  /** The login shell environment, which may say where Codex keeps its files. */
  env: Env
  /** The computer's npm, if it runs. */
  computerNpm: ComputerNpm | null
  /** The global folder of an npm that is not the computer's, or `null` when it does not run. */
  npmGlobalFolder(npm: string): Promise<string | null>
  /** The platform Hoot runs on; the computer's by default. */
  platform?: NodeJS.Platform
}

/** An install-method context whose platform is filled in, as detection fills it. */
type ResolvedContext = InstallMethodContext & { platform: NodeJS.Platform }

/** The command each agent updates itself with, when its official installer installed it. */
export const OFFICIAL_UPDATE_COMMANDS: Record<CodingToolId, string> = {
  claude: 'update',
  codex: 'update',
  opencode: 'upgrade',
}

async function isExecutable(file: string): Promise<boolean> {
  return (await which(file, { nothrow: true })) !== null
}

/** The rules by which paths are written on `platform`. */
function pathRules(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix
}

/**
 * The global folder of an npm whose package's file is `file`: the part of the
 * path before the folder of global packages, `lib/node_modules` outside
 * Windows and `node_modules` on it. `null` when the file is not in one, and
 * the folder itself when that part is empty, as for `/lib/node_modules/...`
 * at the root.
 */
export function npmPrefixOf(
  file: string,
  npmPackage: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const paths = pathRules(platform)
  // A package's name is written with `/`; a path on Windows with `\`.
  const name = platform === 'win32' ? npmPackage.replaceAll('/', '\\') : npmPackage
  const marker = platform === 'win32' ? `\\node_modules\\${name}\\` : `/lib/node_modules/${name}/`
  const index = file.lastIndexOf(marker)
  if (index === -1) return null
  const prefix = file.slice(0, index)
  if (prefix === '') return platform === 'win32' ? paths.parse(file).root : '/'
  return platform === 'win32' ? prefix.replace(/[\\/]$/, '') : prefix
}

/**
 * An installation by npm: the file is in the global packages folder of a
 * global folder P, which is the computer's npm's, or has an npm of its own
 * beside its global packages whose global folder it is.
 */
async function npmMethod(
  tool: CodingToolDefinition,
  target: string,
  context: ResolvedContext,
): Promise<DetectedInstallMethod | null> {
  const { platform } = context
  const prefix = npmPrefixOf(target, tool.npmPackage, platform)
  if (prefix === null) return null
  const computer = context.computerNpm
  if (computer && samePath(computer.prefix, prefix, platform)) {
    return { kind: 'npm', prefix, npm: computer.path, computer: true }
  }
  const paths = pathRules(platform)
  const ownNpm =
    platform === 'win32' ? paths.join(prefix, 'npm.cmd') : paths.join(prefix, 'bin', 'npm')
  if (!(await isExecutable(ownNpm))) return null
  const ownFolder = await context.npmGlobalFolder(ownNpm)
  if (ownFolder !== null && samePath(ownFolder, prefix, platform)) {
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
  const segments = target.split(/[\\/]/)
  for (let index = 1; index < segments.length - 2; index++) {
    const folder = segments[index]
    const name = segments[index + 1]
    if ((folder !== 'Cellar' && folder !== 'Caskroom') || !name) continue
    const root = segments.slice(0, index).join('/')
    const brew = path.posix.join(root === '' && target.startsWith('/') ? '/' : root, 'bin', 'brew')
    if (await isExecutable(brew)) {
      return { kind: 'homebrew', brew, name, cask: folder === 'Caskroom' }
    }
  }
  return null
}

/**
 * An installation by the agent's official installer: Claude Code's files are
 * in `~/.local/share/claude/versions/`, with its program on PATH, in
 * `~/.local/bin/claude` (a symbolic link into that folder on macOS, the
 * program itself on Windows), and on Windows also in `~/.claude/bin/claude.exe`;
 * Codex's is in the `packages/standalone/` folder of where it keeps its files
 * (`CODEX_HOME`, or `~/.codex`), which holds on Windows too; and OpenCode's
 * command is `~/.opencode/bin/opencode`.
 */
async function isOfficialInstallation(
  tool: CodingToolDefinition,
  command: string,
  target: string,
  context: ResolvedContext,
): Promise<boolean> {
  const { platform } = context
  const paths = pathRules(platform)
  switch (tool.id) {
    case 'claude': {
      const versions = await canonicalPath(
        paths.join(context.home, '.local', 'share', 'claude', 'versions'),
      )
      if (isInside(target, versions, platform)) return true
      const folders =
        platform === 'win32'
          ? [paths.join(context.home, '.local', 'bin'), paths.join(context.home, '.claude', 'bin')]
          : [paths.join(context.home, '.local', 'bin')]
      const program = platform === 'win32' ? 'claude.exe' : 'claude'
      for (const folder of folders) {
        const launcher = await canonicalPath(paths.join(folder, program))
        if (
          paths.basename(command).toLowerCase() === paths.basename(launcher).toLowerCase() &&
          samePath(await canonicalPath(paths.dirname(command)), paths.dirname(launcher), platform)
        ) {
          return true
        }
      }
      return false
    }
    case 'codex': {
      const configured = context.env.CODEX_HOME
      const codexHome =
        configured && paths.isAbsolute(configured) ? configured : paths.join(context.home, '.codex')
      return isInside(
        target,
        await canonicalPath(paths.join(codexHome, 'packages', 'standalone')),
        platform,
      )
    }
    case 'opencode': {
      const bin = await canonicalPath(paths.join(context.home, '.opencode', 'bin'))
      return (
        samePath(await canonicalPath(paths.dirname(command)), bin, platform) &&
        paths.basename(command).toLowerCase() ===
          (platform === 'win32' ? 'opencode.exe' : 'opencode')
      )
    }
  }
}

/**
 * How an agent's command was installed, told from the file it leads to once
 * its symbolic links are followed, and, on Windows, once what an npm shim for
 * a command points to is read: by npm, into a global folder; by Homebrew; by
 * the agent's official installer; or, when it is none of these, some way Hoot
 * cannot tell.
 */
export async function detectInstallMethod(
  tool: CodingToolDefinition,
  command: string,
  context: InstallMethodContext,
): Promise<DetectedInstallMethod> {
  const platform = context.platform ?? process.platform
  const target = await canonicalPath(await commandTarget(command, platform))
  return (
    (await npmMethod(tool, target, { ...context, platform })) ??
    (await homebrewMethod(target)) ??
    ((await isOfficialInstallation(tool, command, target, { ...context, platform }))
      ? { kind: 'official' }
      : { kind: 'unknown' })
  )
}

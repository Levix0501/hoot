import fs from 'node:fs/promises'
import path from 'node:path'
import type { CodingToolDefinition, CodingToolId } from '../../shared/tools'
import { envVariable, type Env } from '../env/env'
import { canonicalPath, isInside } from './agent-paths'
import type { DetectedInstallMethod } from './install-method'
import { canCreateFilesIn } from './npm'

/**
 * A command as a user would run it: on Windows, npm's batch file rather than
 * what it points to; with the variables it needs besides the login shell's.
 */
export interface UserCommand {
  program: string
  args: string[]
  /** Variables it runs with, besides those of the login shell environment. */
  env?: Env
  /** How the Agents page shows it, where that is not its program and arguments. */
  shown?: string
}

/** The official installers' commands, as their makers document them, outside Windows. */
const INSTALL_SCRIPTS: Record<CodingToolId, string> = {
  claude: 'curl -fsSL https://claude.ai/install.sh | bash',
  codex: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh',
  opencode: 'curl -fsSL https://opencode.ai/v2/install | bash',
}

/**
 * The official installers' commands on Windows, for PowerShell; OpenCode 2
 * has none there.
 */
const WINDOWS_INSTALL_SCRIPTS: Partial<Record<CodingToolId, string>> = {
  claude: 'irm https://claude.ai/install.ps1 | iex',
  codex: 'irm https://chatgpt.com/codex/install.ps1 | iex',
}

/**
 * What each installer is told, so that it asks nothing, as nobody could
 * answer it: Codex's would otherwise ask whether to remove another copy of
 * Codex, and whether to start it.
 */
const INSTALLER_ENV: Partial<Record<CodingToolId, Env>> = {
  codex: { CODEX_NON_INTERACTIVE: '1' },
}

/** Windows PowerShell, by its full path, so that no program of that name elsewhere runs instead. */
function powerShell(env: Env): string {
  const root = envVariable(env, 'SystemRoot', 'win32') ?? 'C:\\Windows'
  return path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

/**
 * A shell command, run by bash with `pipefail`, so that a download that
 * fails fails the command, rather than its installer running on nothing.
 */
function bashCommand(script: string, env?: Env): UserCommand {
  return { program: '/bin/bash', args: ['-o', 'pipefail', '-c', script], env, shown: script }
}

/** Whether an agent has an official installer for `platform` (see `officialInstallCommand`). */
export function hasOfficialInstaller(tool: CodingToolId, platform: NodeJS.Platform): boolean {
  return platform !== 'win32' || WINDOWS_INSTALL_SCRIPTS[tool] !== undefined
}

/**
 * What installs an agent with its official installer, as its maker
 * documents: a script downloaded with curl and run by a shell, or on
 * Windows by PowerShell. `null` where it has none for the platform.
 */
export function officialInstallCommand(
  tool: CodingToolId,
  env: Env,
  platform: NodeJS.Platform,
): UserCommand | null {
  const extra = INSTALLER_ENV[tool]
  if (platform !== 'win32') return bashCommand(INSTALL_SCRIPTS[tool], extra)
  const script = WINDOWS_INSTALL_SCRIPTS[tool]
  if (script === undefined) return null
  return {
    program: powerShell(env),
    args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
    env: extra,
    shown: script,
  }
}

/**
 * What installs another version of an agent in place of the copy at
 * `command`, as it was installed: npm installs that version into the same
 * global folder; Claude Code's own `install` puts its build of that version
 * beside its others; Codex's installer installs that release; OpenCode's own
 * `upgrade` takes any version, older ones too. `null` where Hoot cannot pick
 * a version: for Homebrew, which keeps only its newest, for an installation
 * Hoot cannot tell how was made, and for Codex's installer on Windows.
 */
export function switchCommandOf(
  tool: CodingToolDefinition,
  command: string,
  method: DetectedInstallMethod,
  version: string,
  platform: NodeJS.Platform,
): UserCommand | null {
  switch (method.kind) {
    case 'npm':
      return {
        program: method.npm,
        args: ['install', '-g', `${tool.npmPackage}@${version}`, '--loglevel=http'],
      }
    case 'official':
      switch (tool.id) {
        case 'claude':
          return { program: command, args: ['install', version] }
        case 'codex':
          return platform === 'win32'
            ? null
            : bashCommand(
                `${INSTALL_SCRIPTS.codex} -s -- --release ${version}`,
                INSTALLER_ENV.codex,
              )
        case 'opencode':
          return { program: command, args: ['upgrade', version] }
      }
      return null
    case 'homebrew':
    case 'unknown':
      return null
  }
}

/** What uninstalling a copy does: runs what installed it, or removes the files its installer made. */
export type UninstallPlan =
  | { kind: 'command'; command: UserCommand }
  | {
      kind: 'remove'
      /** The files and folders it removes, folders with all they hold. */
      paths: string[]
    }

/**
 * The files an official installer made for the copy at `command`, which
 * uninstalling it removes, as its maker documents or its installer shows:
 * Claude Code's launcher and the folder of its builds, `~/.local/share/claude`;
 * Codex's commands that lead into `packages/standalone` in where it keeps its
 * files, and that folder; OpenCode's program and the `opencode2` beside it,
 * which `opencode uninstall` leaves to the user. Codex's and OpenCode's on
 * Windows are left alone, untried there. Settings, sign-ins and history stay.
 */
async function officialFiles(
  tool: CodingToolId,
  command: string,
  home: string,
  env: Env,
  platform: NodeJS.Platform,
): Promise<string[] | null> {
  const paths = platform === 'win32' ? path.win32 : path.posix
  switch (tool) {
    case 'claude':
      return [command, paths.join(home, '.local', 'share', 'claude')]
    case 'codex': {
      if (platform === 'win32') return null
      const configured = envVariable(env, 'CODEX_HOME', platform)
      const codexHome =
        configured && paths.isAbsolute(configured) ? configured : paths.join(home, '.codex')
      const standalone = paths.join(codexHome, 'packages', 'standalone')
      const root = await canonicalPath(standalone)
      const commands = [command, paths.join(paths.dirname(command), 'codex-code-mode-host')]
      const leading: string[] = []
      for (const file of commands) {
        if (isInside(await canonicalPath(file), root, platform)) leading.push(file)
      }
      return [...leading, standalone]
    }
    case 'opencode':
      if (platform === 'win32') return null
      return [command, paths.join(paths.dirname(command), 'opencode2')]
  }
}

/**
 * What uninstalls the copy of an agent at `command`, as it was installed:
 * npm uninstalls it from its global folder, Homebrew its formula or cask,
 * and Hoot removes the files of an official installer (see `officialFiles`).
 * `null` where it cannot: for an installation Hoot cannot tell how was
 * made, or one whose folders the user cannot write to.
 */
export async function uninstallPlanOf(
  tool: CodingToolDefinition,
  command: string,
  method: DetectedInstallMethod,
  context: { home: string; env: Env; platform: NodeJS.Platform; writable: boolean },
): Promise<UninstallPlan | null> {
  switch (method.kind) {
    case 'npm':
      if (!context.writable) return null
      return {
        kind: 'command',
        command: {
          program: method.npm,
          args: ['uninstall', '-g', tool.npmPackage, '--loglevel=http'],
        },
      }
    case 'homebrew':
      return {
        kind: 'command',
        command: {
          program: method.brew,
          args: ['uninstall', method.cask ? '--cask' : '--formula', method.name],
        },
      }
    case 'official': {
      const files = await officialFiles(
        tool.id,
        command,
        context.home,
        context.env,
        context.platform,
      )
      if (files === null) return null
      for (const file of files) {
        if (!(await canCreateFilesIn(path.dirname(file)))) return null
      }
      return { kind: 'remove', paths: files }
    }
    case 'unknown':
      return null
  }
}

/** Removes files and folders, folders with all they hold; those already gone are passed over. */
export async function removeFiles(paths: string[]): Promise<void> {
  for (const file of paths) {
    await fs.rm(file, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
  }
}

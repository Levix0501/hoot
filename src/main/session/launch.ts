import fs from 'node:fs/promises'
import type { PermissionLevel } from '../../shared/permission-levels'
import { getTool, type CodingToolId, type ToolId } from '../../shared/tools'
import type { Env } from '../env/env'
import { buildSessionEnv, type TerminalEnvOptions } from '../env/session-env'
import type { LoginEnvironment } from '../tools/tool-service'
import { findCommand } from '../tools/find-command'
import { SessionError, type SessionLaunch } from './session-manager'

export interface LaunchContext {
  /** The user's default shell. */
  shell: string
  /** The graphical login session environment Hoot started with. */
  baseEnv: Env
  terminal(): TerminalEnvOptions
  getLoginEnvironment(): Promise<LoginEnvironment>
  /** The permission level currently selected for a coding tool. */
  permissionLevel(tool: CodingToolId): PermissionLevel
}

async function checkFolder(cwd: string): Promise<void> {
  const stats = await fs.stat(cwd).catch(() => null)
  if (!stats?.isDirectory()) {
    throw new SessionError(`The folder no longer exists: ${cwd}`)
  }
}

/**
 * Decides what a session runs in its working directory (the project root, or
 * the root of one of the project's worktrees). A Shell session runs the
 * default shell as a login shell, starting from the same environment a
 * terminal opened from the Dock would give it. A coding tool runs its command
 * directly, with the login shell environment and with exactly the arguments
 * of its permission level.
 */
export async function resolveLaunch(
  context: LaunchContext,
  toolId: ToolId,
  cwd: string,
): Promise<SessionLaunch> {
  const tool = getTool(toolId)
  if (tool.command === null) {
    await checkFolder(cwd)
    return {
      file: context.shell,
      args: ['-l'],
      env: buildSessionEnv(context.baseEnv, { ...context.terminal(), cwd }),
    }
  }

  // Read when the session starts: selecting another level later does not
  // change this session, even while it waits for the login shell environment.
  const level = context.permissionLevel(tool.id)
  await checkFolder(cwd)
  const login = await context.getLoginEnvironment()
  const found = await findCommand(tool.command, login.env.PATH)
  if (!found) {
    throw new SessionError(
      `${tool.label} is not available. Install it with: ${tool.installCommand}`,
    )
  }
  return {
    file: tool.command,
    args: [...level.args],
    env: buildSessionEnv(login.env, { ...context.terminal(), cwd }),
  }
}

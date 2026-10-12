import fs from 'node:fs/promises'
import type { Issue } from '../../shared/issues'
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
  /**
   * The folder of Hoot's own Claude Code plugin, `hoot`, which only the
   * sessions an issue is sent to load.
   */
  claudePlugin: string
}

/** What a session started from an issue sends Claude Code: the issue's title and description. */
export type SentIssue = Pick<Issue, 'title' | 'description'>

/** The command of the plugin's skill that judges an issue's workload and splits it if needed. */
const SPLIT_ISSUE_COMMAND = '/hoot:split-issue'

/**
 * Text without its NUL characters: a program's arguments end at the first
 * one, which would silently drop the rest.
 */
function withoutNul(text: string): string {
  return text.replaceAll('\0', '')
}

/**
 * The first message of a session an issue is sent to: the command of the
 * split-issue skill, then the issue, its title as a Markdown heading and its
 * description, if any, below it. The heading's `#` keeps a title that starts
 * with a slash from being taken for another skill's command.
 */
export function splitIssuePrompt(issue: SentIssue): string {
  const heading = `${SPLIT_ISSUE_COMMAND} # ${withoutNul(issue.title)}`
  const description = withoutNul(issue.description)
  return description === '' ? heading : `${heading}\n\n${description}`
}

/**
 * The arguments that send an issue to Claude Code, after those of its
 * permission level: Hoot's plugin, for this session only; the issue's title
 * as the session's name; and the first message. Each option and its value are
 * one argument, so that a title starting with `-` is still the name.
 */
export function sentIssueArgs(claudePlugin: string, issue: SentIssue): string[] {
  return [
    `--plugin-dir=${claudePlugin}`,
    `--name=${withoutNul(issue.title)}`,
    splitIssuePrompt(issue),
  ]
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
 * of its permission level; Claude Code, when it is sent an issue, also with
 * the arguments that send it.
 */
export async function resolveLaunch(
  context: LaunchContext,
  toolId: ToolId,
  cwd: string,
  issue: SentIssue | null = null,
): Promise<SessionLaunch> {
  const tool = getTool(toolId)
  if (issue !== null && tool.id !== 'claude') {
    throw new SessionError(`An issue cannot be sent to ${tool.label}.`)
  }
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
    args:
      issue === null
        ? [...level.args]
        : [...level.args, ...sentIssueArgs(context.claudePlugin, issue)],
    env: buildSessionEnv(login.env, { ...context.terminal(), cwd }),
  }
}

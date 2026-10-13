import { rmSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Issue } from '../../shared/issues'
import type { PermissionLevel } from '../../shared/permission-levels'
import { getTool, type CodingToolId, type ToolId } from '../../shared/tools'
import type { Env } from '../env/env'
import {
  buildSessionEnv,
  type HootCliEnvOptions,
  type TerminalEnvOptions,
} from '../env/session-env'
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
   * Where each session an issue is sent to gets a folder of its own for the
   * issue's file: the system's folder for temporary files.
   */
  temporaryFolder: string
  /** What the session's process needs to run hoot, Hoot's command line program. */
  hoot: HootCliEnvOptions
}

/** What a session started from an issue sends Claude Code: the issue's title and description. */
export type SentIssue = Pick<Issue, 'title' | 'description'>

/** The name of the file that holds an issue sent to a session, in the session's own folder. */
const ISSUE_FILE_NAME = 'issue.md'

/**
 * Text without its NUL characters: a program's arguments end at the first
 * one, which would silently drop the rest, and a file with one is taken for
 * binary data by many tools.
 */
function withoutNul(text: string): string {
  return text.replaceAll('\0', '')
}

/**
 * The file of an issue sent to a session: its title as a Markdown heading,
 * and its description, if any, below it.
 */
export function issueFileText(issue: SentIssue): string {
  const heading = `# ${withoutNul(issue.title)}`
  const description = withoutNul(issue.description)
  return description === '' ? `${heading}\n` : `${heading}\n\n${description}\n`
}

/**
 * The first message of a session an issue is sent to: Hoot's instructions to
 * judge the issue's workload and to split it if needed, which point to the
 * issue's file for the agent to read. They are the same for any agent. The
 * issue itself stays out of the message, where an agent could take some of
 * its text for a command or a mention, and out of the program's arguments,
 * whose length is limited.
 */
export function splitIssuePrompt(issueFile: string): string {
  return [
    `The issue to judge is in \`${issueFile}\`. Read it first: its title is the heading; the rest, if any, is its description.`,
    '',
    "Judge the issue against this project's code. Read whatever you need, but change nothing: no edits, no commits, no commands that change files.",
    '',
    '1. Workload: can one fresh agent session implement the whole issue, and another fresh session then verify it in full? Answer yes or no, and say why: the parts of the code it touches, and what is still unknown. Do not estimate time.',
    '2. If yes, say that it needs no split, and stop.',
    '3. If no, split it into issues that one session can each implement and another verify. Each delivers a narrow but complete result through every layer it touches, never one layer of the whole. For each:',
    '   - Title',
    '   - Description: what it delivers, and how to accept it',
    '   - Waits on: the issues it cannot be delivered and accepted without, or none',
    '4. End with the order, one chain per line, such as `1 → 2 → 4` and `1 → 3`.',
    '',
    "Write titles and descriptions in the issue's language. Where the issue leaves open something that changes your answer, say what you assumed.",
  ].join('\n')
}

/**
 * The arguments that send an issue to Claude Code, after those of its
 * permission level: the folder of the issue's file as one more working
 * directory, which Claude Code reads at any permission level without asking;
 * the issue's title as the session's name; and the first message. Each option
 * and its value are one argument, so that a title starting with `-` is still
 * the name.
 */
export function sentIssueArgs(issueFolder: string, issue: SentIssue): string[] {
  return [
    `--add-dir=${issueFolder}`,
    `--name=${withoutNul(issue.title)}`,
    splitIssuePrompt(path.join(issueFolder, ISSUE_FILE_NAME)),
  ]
}

/**
 * Writes the file of an issue sent to a session, in a new folder of the
 * session's own, and returns that folder.
 */
async function writeIssueFolder(temporaryFolder: string, issue: SentIssue): Promise<string> {
  let folder: string | null = null
  try {
    folder = await fs.mkdtemp(path.join(temporaryFolder, 'hoot-issue-'))
    await fs.writeFile(path.join(folder, ISSUE_FILE_NAME), issueFileText(issue))
    return folder
  } catch (error) {
    if (folder !== null) await fs.rm(folder, { recursive: true, force: true }).catch(() => {})
    throw new SessionError(
      `Could not write the issue's file: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
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
 * the arguments that send it, once the issue's file is written; the launch's
 * cleanup removes the file's folder. Either environment also has what hoot
 * needs to run in the session.
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
      env: buildSessionEnv(context.baseEnv, { ...context.terminal(), cwd, hoot: context.hoot }),
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
  const env = buildSessionEnv(login.env, { ...context.terminal(), cwd, hoot: context.hoot })
  if (issue === null) return { file: tool.command, args: [...level.args], env }
  // Written last, so that a launch that fails leaves nothing behind.
  const issueFolder = await writeIssueFolder(context.temporaryFolder, issue)
  return {
    file: tool.command,
    args: [...level.args, ...sentIssueArgs(issueFolder, issue)],
    env,
    cleanup: () => rmSync(issueFolder, { recursive: true, force: true }),
  }
}

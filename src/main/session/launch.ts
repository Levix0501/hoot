import { rmSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Issue } from '../../shared/issues'
import { firstMessage } from '../../shared/workflow-text'
import type { WorkflowStep } from '../../shared/workflows'
import { findPermissionLevel, type PermissionLevel } from '../../shared/permission-levels'
import { getTool, type CodingToolId, type ToolId } from '../../shared/tools'
import type { Env } from '../env/env'
import {
  buildSessionEnv,
  type HootCliEnvOptions,
  type TerminalEnvOptions,
} from '../env/session-env'
import { commandProgram } from '../tools/command-program'
import type { SessionShell } from '../tools/default-shell'
import { findAgentCommand } from '../tools/find-command'
import type { LoginEnvironment } from '../tools/tool-service'
import { SessionError, type SessionLaunch } from './session-manager'

export interface LaunchContext {
  /** The shell that Shell sessions run, and its arguments (see `defaultShell`). */
  shell: SessionShell
  /** The graphical login session environment Hoot started with. */
  baseEnv: Env
  terminal(): TerminalEnvOptions
  getLoginEnvironment(): Promise<LoginEnvironment>
  /** The permission level currently selected for a coding tool. */
  permissionLevel(tool: CodingToolId): PermissionLevel
  /** What the session's process needs to run hoot, Hoot's command line program. */
  hoot: HootCliEnvOptions
  /**
   * On macOS, where Hoot installs agents: Hoot's folder of agents' commands,
   * where a coding tool that is not on the login shell PATH is looked for,
   * and the folders that go last on the PATH of every session (the one of
   * Hoot's `node`, and that folder). `null` elsewhere, as on Windows.
   */
  agents: { binDirectory: string; lastOnPath: readonly string[] } | null
}

/**
 * What a session started from an issue's start button sends Claude Code: the
 * issue's title and description, the branch of the worktree the session
 * runs in, the step of the issue's workflow the session starts at, and the
 * text of the file of what earlier steps found, `null` when there is none.
 */
export interface SentIssue extends Pick<Issue, 'title' | 'description'> {
  branch: string
  step: WorkflowStep
  stepsFile: string | null
}

/**
 * Where, in its working directory, each session started from an issue gets a
 * folder of its own for the issue's files. Git ignores this folder by the
 * `.gitignore` in it, which leaves the rest of `.hoot` to files a project
 * might commit.
 */
const TEMPORARY_FOLDER = path.join('.hoot', 'tmp')

/** The `.gitignore` of `TEMPORARY_FOLDER`: Git ignores everything in it, this file included. */
const TEMPORARY_GITIGNORE = '# Created by Hoot automatically.\n*\n'

/** The name of the file that holds an issue sent to a session, in the session's own folder. */
const ISSUE_FILE_NAME = 'issue.md'

/** The name of the file of what earlier steps found, beside the issue's file. */
const STEPS_FILE_NAME = 'steps.md'

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
export function issueFileText(issue: Pick<Issue, 'title' | 'description'>): string {
  const heading = `# ${withoutNul(issue.title)}`
  const description = withoutNul(issue.description)
  return description === '' ? `${heading}\n` : `${heading}\n\n${description}\n`
}

/**
 * The arguments that send an issue to Claude Code, after those of its
 * permission level: the issue's title as the session's name, and the first
 * message, which points to the files and starts the step. The folder of the
 * files is in the session's working directory, where Claude Code reads them
 * at any permission level without asking. Each option and its value are one
 * argument, so that a title starting with `-` is still the name.
 */
export function sentIssueArgs(issueFolder: string, issue: SentIssue): string[] {
  return [
    `--name=${withoutNul(issue.title)}`,
    firstMessage({
      issueFile: path.join(issueFolder, ISSUE_FILE_NAME),
      stepsFile: issue.stepsFile === null ? null : path.join(issueFolder, STEPS_FILE_NAME),
      branch: issue.branch,
      step: issue.step,
    }),
  ]
}

/**
 * Writes the file of an issue sent to a session, and the file of what earlier
 * steps found when there is one, in a new folder of the session's own in
 * `TEMPORARY_FOLDER` of its working directory, and returns that folder. The
 * `.gitignore` there is written when it is missing and stays afterwards, as
 * does the folder that holds it: another session's folder may be beside this
 * one.
 */
async function writeIssueFolder(cwd: string, issue: SentIssue): Promise<string> {
  let folder: string | null = null
  try {
    const temporaryFolder = path.join(cwd, TEMPORARY_FOLDER)
    await fs.mkdir(temporaryFolder, { recursive: true })
    await fs
      .writeFile(path.join(temporaryFolder, '.gitignore'), TEMPORARY_GITIGNORE, { flag: 'wx' })
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error
      })
    folder = await fs.mkdtemp(path.join(temporaryFolder, 'issue-'))
    await fs.writeFile(path.join(folder, ISSUE_FILE_NAME), issueFileText(issue))
    if (issue.stepsFile !== null) {
      await fs.writeFile(path.join(folder, STEPS_FILE_NAME), issue.stepsFile)
    }
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
 * default shell with its arguments, as a login shell outside Windows,
 * starting from the same environment a terminal opened from the Dock or the
 * Start menu would give it. A coding tool runs its command directly, the one
 * found on the login shell PATH or else, on macOS, in Hoot's folder of
 * agents: the installation the Agents page shows. On Windows, where the
 * command that npm or pnpm makes is a batch file, the tool runs what that
 * points to instead (see `commandProgram`). It runs with the login shell
 * environment and with exactly the arguments of its permission level: the one
 * `permissionLevel` names, or else the one picked now. Claude Code, when it is
 * sent an issue, also gets the arguments that send it, once the issue's files
 * are written; the launch's cleanup removes their folder. Either
 * environment also has what hoot needs to run in the session, and the folders
 * that go last on its PATH.
 */
export async function resolveLaunch(
  context: LaunchContext,
  toolId: ToolId,
  cwd: string,
  issue: SentIssue | null = null,
  permissionLevel: string | null = null,
): Promise<SessionLaunch> {
  const tool = getTool(toolId)
  if (issue !== null && tool.id !== 'claude') {
    throw new SessionError(`An issue cannot be sent to ${tool.label}.`)
  }
  if (tool.command === null) {
    await checkFolder(cwd)
    return {
      file: context.shell.file,
      args: [...context.shell.args],
      env: buildSessionEnv(context.baseEnv, {
        ...context.terminal(),
        cwd,
        hoot: context.hoot,
        lastOnPath: context.agents?.lastOnPath,
      }),
    }
  }

  // Read when the session starts, unless it was given: selecting another
  // level later does not change this session, even while it waits for the
  // login shell environment.
  const level =
    (permissionLevel === null ? undefined : findPermissionLevel(tool.id, permissionLevel)) ??
    context.permissionLevel(tool.id)
  await checkFolder(cwd)
  const login = await context.getLoginEnvironment()
  const found = await findAgentCommand(
    tool.command,
    login.env,
    context.agents?.binDirectory ?? null,
  )
  if (!found) {
    throw new SessionError(
      `${tool.label} is not available. Install it with: ${tool.installCommand}`,
    )
  }
  const program = await commandProgram(found, login.env).catch((error: unknown) => {
    throw new SessionError(
      `Could not start ${tool.label}: ${error instanceof Error ? error.message : String(error)}`,
    )
  })
  const env = buildSessionEnv(login.env, {
    ...context.terminal(),
    cwd,
    hoot: context.hoot,
    lastOnPath: context.agents?.lastOnPath,
  })
  const args = [...program.args, ...level.args]
  if (issue === null) return { file: program.file, args, env }
  // Written last, so that a launch that fails leaves no folder of its own behind.
  const issueFolder = await writeIssueFolder(cwd, issue)
  return {
    file: program.file,
    args: [...args, ...sentIssueArgs(issueFolder, issue)],
    env,
    cleanup: () => rmSync(issueFolder, { recursive: true, force: true }),
  }
}

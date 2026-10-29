import { rmSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { gte } from 'semver'
import { quote } from 'shell-quote'
import { agentLaunchArguments } from '../../shared/launch-command'
import type { AgentLaunchSettings } from '../../shared/launch-settings'
import { HOOK_EVENTS } from '../../shared/hoot-cli'
import type { Issue } from '../../shared/issues'
import { getTool, type CodingToolId, type ToolId } from '../../shared/tools'
import { readVersion } from '../agents/version'
import type { Env } from '../env/env'
import {
  buildSessionEnv,
  type HootCliEnvOptions,
  type TerminalEnvOptions,
} from '../env/session-env'
import { commandProgram } from '../tools/command-program'
import type { SessionShell } from '../tools/default-shell'
import { findCommand } from '../tools/find-command'
import type { LoginEnvironment } from '../tools/tool-service'
import type { SessionFiles } from '../workflows/workflow-executor'
import { SessionError, type SessionLaunch } from './session-manager'

export interface LaunchContext {
  /** The shell that Shell sessions run, and its arguments (see `defaultShell`). */
  shell: SessionShell
  /** The graphical login session environment Hoot started with. */
  baseEnv: Env
  terminal(): TerminalEnvOptions
  getLoginEnvironment(): Promise<LoginEnvironment>
  /** How coding tools start their new sessions, as the Agents page has them. */
  launchSettings(tool: CodingToolId): {
    yoloMode: boolean
    agent: AgentLaunchSettings
  }
  /** What the session's process needs to run hoot, Hoot's command line program. */
  hoot: HootCliEnvOptions
}

/**
 * The conversation a chat's session continues: the id its agent knows it by,
 * and whether it has a conversation to continue, rather than one to start.
 * The id is `null` for a new conversation, whose id the agent picks and Hoot
 * learns later. A conversation to start can have a first message, which the
 * agent is sent as it starts.
 */
export interface ChatLaunch {
  conversationId: string | null
  resume: boolean
  firstMessage?: string
}

/**
 * What a session started from an issue sends Claude Code: the issue's title
 * and description, the text of the file of its workflow, if the session has
 * one, and the first message, given the files once they are written and the
 * branch of the worktree the session runs in.
 */
export interface SentIssue extends Pick<Issue, 'title' | 'description'> {
  branch: string
  workflowFile: string | null
  firstMessage(files: SessionFiles): string
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

/** The name of the file of the issue's workflow, beside the issue's file. */
const WORKFLOW_FILE_NAME = 'workflow.md'

/**
 * Text without its NUL characters: a program's arguments end at the first
 * one, which would silently drop the rest, and a file with one is taken for
 * binary data by many tools.
 */
function withoutNul(text: string): string {
  return text.replaceAll('\0', '')
}

/**
 * The settings Hoot adds to every Claude Code session it starts, with
 * `--settings`, on top of the user's own: a hook for each of `HOOK_EVENTS`,
 * which runs hoot's `hook` command, here the command `hoot`, with the hook's
 * input, so that the session's hoot reports the event to Hoot. Each runs in
 * the background, so that it neither delays nor shows anything in Claude
 * Code; it prints nothing and always succeeds, so that it decides nothing.
 * The user's own hooks run as well, and a user who turned off all hooks
 * turns off these too.
 */
export function claudeCodeHookSettings(hoot: string): string {
  const hook = { type: 'command', command: quote([hoot, 'hook']), async: true }
  return JSON.stringify({
    hooks: Object.fromEntries(HOOK_EVENTS.map((event) => [event, [{ hooks: [hook] }]])),
  })
}

/** The first version of Codex that runs a hook in the background, rather than skipping it. */
export const CODEX_BACKGROUND_HOOKS_VERSION = '0.148.0'

/** How long Hoot waits for Codex to say its version before a session starts. */
const CODEX_VERSION_TIMEOUT_MS = 10_000

/**
 * The setting Hoot adds to every Codex session it starts with
 * `CODEX_BACKGROUND_HOOKS_VERSION` or later, with `-c`, on top of the user's
 * own: a hook on each message the user submits, which runs hoot's `hook`
 * command, as the command `hoot` the session's PATH finds first, with the
 * hook's input, so that the session's hoot reports the conversation the
 * message went to. It runs in the background, so that it neither delays nor
 * shows anything in Codex; it prints nothing and always succeeds, so that it
 * decides nothing. Codex runs it once the user trusted it, which Codex asks
 * about the first time, naming it by its status message: a change to any of
 * it, that message included, makes Codex ask again. The user's own hooks
 * run as well, and a user who turned off Codex's hooks turns off this one
 * too.
 */
export const CODEX_HOOK_SETTING =
  'hooks.UserPromptSubmit=[{hooks=[{type="command",command="hoot hook",async=true,' +
  'statusMessage="Let Hoot know which conversation this is"}]}]'

/**
 * Whether the Codex a session starts runs Hoot's hook: whether its command
 * says a version of `CODEX_BACKGROUND_HOOKS_VERSION` or later when run with
 * `--version`, read before each session, as the user may change Codex
 * while Hoot runs.
 */
async function codexRunsHook(command: string, env: Env, cwd: string): Promise<boolean> {
  const { version } = await readVersion(
    command,
    env,
    cwd,
    process.platform,
    CODEX_VERSION_TIMEOUT_MS,
  )
  return version !== null && gte(version, CODEX_BACKGROUND_HOOKS_VERSION)
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
 * The arguments that send an issue to Claude Code, after its own: the issue's
 * title as the session's name, and the first message, which points to the
 * files and starts the step, without its NUL characters. The folder of the
 * files is in the session's working directory, where Claude Code reads them
 * at any permission level without asking. Each option and its value are one
 * argument, so that a title starting with `-` is still the name, and `--` ends
 * the options, so that a first message starting with `-`, such as one from
 * `hoot session start --prompt-file` that starts with a list, is still the
 * first message and no option.
 */
export function sentIssueArgs(issueFolder: string, issue: SentIssue): string[] {
  return [
    `--name=${withoutNul(issue.title)}`,
    '--',
    withoutNul(
      issue.firstMessage({
        issueFile: path.join(issueFolder, ISSUE_FILE_NAME),
        workflowFile: path.join(issueFolder, WORKFLOW_FILE_NAME),
        branch: issue.branch,
      }),
    ),
  ]
}

/**
 * Writes the file of an issue sent to a session, and the file of its
 * workflow if it has one, in a new folder of the session's own in
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
    if (issue.workflowFile !== null) {
      await fs.writeFile(path.join(folder, WORKFLOW_FILE_NAME), issue.workflowFile)
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
 * The arguments that continue a chat's conversation: Claude Code's
 * `--resume`, OpenCode's `-s` and Codex's `resume` subcommand. A new
 * conversation starts as any other session does, with an id the agent picks.
 */
export function chatLaunchArguments(
  tool: CodingToolId,
  chat: ChatLaunch | null,
): { before: string[]; after: string[] } {
  if (chat === null || chat.conversationId === null || !chat.resume) {
    return { before: [], after: [] }
  }
  const id = chat.conversationId
  switch (tool) {
    case 'claude':
      return { before: [], after: ['--resume', id] }
    case 'opencode':
      return { before: [], after: ['-s', id] }
    case 'codex':
      return { before: ['resume', id], after: [] }
  }
}

/**
 * The arguments that send an agent the first message of a conversation it
 * starts, after all its others, without its NUL characters: for Claude Code
 * and Codex the message after `--`, which ends the options, so that one
 * starting with `-` is still the message, and for OpenCode the value of its
 * `--prompt`, given with `=`, as one argument. Each agent sends it as soon as
 * it is ready, without the user typing anything.
 */
export function firstMessageArguments(tool: CodingToolId, message: string): string[] {
  const text = withoutNul(message)
  switch (tool) {
    case 'claude':
    case 'codex':
      return ['--', text]
    case 'opencode':
      return [`--prompt=${text}`]
  }
}

/**
 * Decides what a session runs in its working directory (the project root, or
 * the root of one of the project's worktrees). A Shell session runs the
 * default shell with its arguments, as a login shell outside Windows,
 * starting from the same environment a terminal opened from the Dock or the
 * Start menu would give it. A coding tool runs its command directly, the one
 * found on the login shell PATH: the installation the Agents page shows. On
 * Windows, where the command that npm or pnpm makes is a batch file, the tool
 * runs what that points to instead (see `commandProgram`). It runs with the
 * login shell environment and with the arguments the Agents page shows: the
 * YOLO arguments while YOLO mode is on, the chosen model and effort, and the
 * extra arguments; then the hooks Hoot adds, to Claude Code and to a Codex
 * that runs them, and, when Claude Code is sent an issue, the arguments that
 * send it, once the issue's files are written; the launch's cleanup removes
 * their folder. A chat's session also gets the arguments that continue its
 * conversation, and those that send the first message of one it starts with
 * one. Either environment also has what hoot needs to run in the session.
 */
export async function resolveLaunch(
  context: LaunchContext,
  toolId: ToolId,
  cwd: string,
  issue: SentIssue | null = null,
  chat: ChatLaunch | null = null,
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
      }),
    }
  }

  // Read when the session starts: changing a setting later does not change
  // this session, even while it waits for the login shell environment.
  const launch = context.launchSettings(tool.id)
  await checkFolder(cwd)
  const login = await context.getLoginEnvironment()
  const found = await findCommand(tool.command, login.env)
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
  })
  const chatArguments = chatLaunchArguments(tool.id, chat)
  let hookArguments: string[] = []
  if (tool.id === 'claude') {
    hookArguments = [
      '--settings',
      claudeCodeHookSettings(path.join(context.hoot.binDirectory, 'hoot')),
    ]
  } else if (tool.id === 'codex' && (await codexRunsHook(found, login.env, cwd))) {
    hookArguments = ['-c', CODEX_HOOK_SETTING]
  }
  const args = [
    ...program.args,
    ...chatArguments.before,
    ...agentLaunchArguments({
      tool: tool.id,
      yoloMode: launch.yoloMode,
      settings: launch.agent,
      hookArguments,
    }),
    ...chatArguments.after,
    ...(chat?.firstMessage === undefined ? [] : firstMessageArguments(tool.id, chat.firstMessage)),
  ]
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

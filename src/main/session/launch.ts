import { rmSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { quote } from 'shell-quote'
import { agentLaunchArguments } from '../../shared/launch-command'
import type { AgentLaunchSettings } from '../../shared/launch-settings'
import { HOOK_EVENTS, HOOT_ENV, MODEL_SWITCH_EVENT } from '../../shared/hoot-cli'
import { issueFirstMessage, type Issue } from '../../shared/issues'
import {
  agentModels,
  catalogModelOf,
  claudeDefaultEffort,
  claudeEffortsOf,
  namesClaudeModel,
  type ModelCatalogs,
  type ModelMap,
  type Provider,
} from '../../shared/providers'
import {
  getTool,
  type CodingToolDefinition,
  type CodingToolId,
  type ToolId,
} from '../../shared/tools'
import { belowMinimumVersion, minimumVersionText, type AgentFollow } from '../../shared/agents'
import { findAgentCommand } from '../agents/agent-command'
import { setEnvVariable, type Env } from '../env/env'
import {
  buildSessionEnv,
  type HootCliEnvOptions,
  type TerminalEnvOptions,
} from '../env/session-env'
import { commandProgram } from '../tools/command-program'
import type { SessionShell } from '../tools/default-shell'
import { claudeSessionEnv, claudeSessionModel } from '../providers/claude-config'
import {
  codexDefaultModel,
  codexSessionCatalog,
  type CodexCatalog,
  type CodexCatalogSupport,
} from '../providers/codex-catalog'
import { codexProviderLaunch, tomlString } from '../providers/codex-config'
import type { LoginEnvironment } from '../tools/tool-service'
import type { SessionFiles } from '../workflows/workflow-executor'
import { OPENCODE_PASSWORD, type OpenCodeServer } from '../providers/opencode-config'
import { OPENCODE_CLI_CONFIG, openCodeCliConfig } from './opencode-plugin'
import { SessionError, type SessionLaunch } from './session-manager'

export interface LaunchContext {
  /** The shell that Terminal sessions run, and its arguments (see `defaultShell`). */
  shell: SessionShell
  /** The graphical login session environment Hoot started with. */
  baseEnv: Env
  /** The home folder, where agents' official installers put their commands (see `findAgentCommand`). */
  home: string
  /**
   * What the session's agent's installation follows: one that follows
   * anything but its latest version starts with its own updater off.
   */
  follow(tool: CodingToolId): AgentFollow
  terminal(): TerminalEnvOptions
  getLoginEnvironment(): Promise<LoginEnvironment>
  /**
   * The version the command of an agent at `command` reports (see
   * `readAgentVersion`), with the environment `env`; `null` where it
   * reports none.
   */
  agentVersion(tool: CodingToolId, command: string, env: Env): Promise<string | null>
  /** How the session's agent starts, as the Agents page has it. */
  launchSettings(tool: CodingToolId): {
    yoloMode: boolean
    agent: AgentLaunchSettings
  }
  /**
   * The provider the session's agent runs on; `null` for the agent's own
   * configuration, as for a chat made before providers.
   */
  provider: Provider | null
  /** The models of its provider the session's agent maps Claude Code's roles to. */
  modelMap: ModelMap
  /**
   * Whether the session's agent leaves to Claude Code each of its roles it
   * does not map (see `leavesRolesToClaude`).
   */
  leavesRoles: boolean
  /**
   * The variables of Claude Code's environment that say which provider it
   * runs on, as its settings for a session in `cwd` and the login shell's
   * environment set them, which a session on another provider unsets (see
   * `claudeSessionEnv`).
   */
  claudeUserVariables(cwd: string): Promise<string[]>
  /** The models of the providers Hoot knows, as models.dev lists them. */
  catalogs(): ModelCatalogs
  /**
   * What Hoot read of the Codex a command runs for the catalogs of its
   * sessions (see `readCodexCatalogSupport`); `null` for a Codex whose
   * sessions get none.
   */
  codexCatalogSupport(command: string, env: Env): Promise<CodexCatalogSupport | null>
  /**
   * Whether the user's configuration of Codex, for the environment `env`,
   * names a catalog of its own (`model_catalog_json`), as a tool that runs
   * Codex on other providers does, which a session on Codex's own sign-in
   * then takes in place of Codex's own.
   */
  codexNamesCatalog(env: Env): Promise<boolean>
  /**
   * The folder Hoot writes the settings of its Claude Code sessions and the
   * catalogs of its Codex sessions in, a file each.
   */
  settingsFolder: string
  /** What the session's process needs to run hoot, Hoot's command line program. */
  hoot: HootCliEnvOptions
  /** The folder of the plugin Hoot gives OpenCode (see `openCodePluginFolder`). */
  openCodePlugin: string
  /**
   * The folder of the hooks Hoot gives Antigravity CLI, which its sessions
   * take as a folder of their workspace (see `antigravityHooksFolder`).
   */
  antigravityHooks: string
  /**
   * The server of Hoot's an OpenCode session connects to (see
   * `OpenCodeServers`), which has the user's providers; `null` for the
   * background service of the user's own OpenCode, as for a chat made before
   * providers.
   */
  openCodeServer: OpenCodeServer | null
}

/**
 * What an agent's session starts with: the agent's launch settings, and the
 * provider it runs on, `null` for the agent's own configuration, as a chat
 * made before providers runs.
 */
export interface AgentLaunch {
  settings: AgentLaunchSettings
  provider: Provider | null
  /** For Claude Code, the models of the provider its agent maps Claude Code's roles to. */
  modelMap?: ModelMap
  /**
   * For Claude Code, whether its agent leaves to Claude Code each role it
   * does not map, by the model the agent runs (see `leavesRolesToClaude`).
   */
  leavesRoles?: boolean
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
  /**
   * Whether the chat runs in a folder Hoot made for it, rather than in a
   * worktree or a project's folder: Antigravity CLI, which asks whether to
   * trust a folder the first time it runs there, is told to trust it.
   */
  ownFolder?: boolean
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
 * The longest issue message, in UTF-16 code units, sent inline on an agent's
 * command line: well below Windows' command-line limit and Linux's
 * per-argument limit. Longer issues are written to a file in
 * `TEMPORARY_FOLDER` inside the worktree and referenced by path instead.
 */
export const MAX_INLINE_ISSUE_MESSAGE_LENGTH = 16_000

/**
 * Text without its NUL characters: a program's arguments end at the first
 * one, which would silently drop the rest, and a file with one is taken for
 * binary data by many tools.
 */
function withoutNul(text: string): string {
  return text.replaceAll('\0', '')
}

/**
 * What the settings of a Claude Code session on a provider name besides its
 * environment: the model it starts with, and the effort level it starts at
 * while its command picks none.
 */
export interface ClaudeSessionNote {
  /** `''` for the account's default. */
  model: string
  effortLevel: string | null
}

/**
 * The settings Hoot adds to every Claude Code session it starts, with
 * `--settings`, on top of the user's own: a hook for each of `HOOK_EVENTS`,
 * which runs hoot's `hook` command, here the command `hoot`, with the hook's
 * input, so that the session's hoot reports the event to Hoot. Each runs in
 * the background, so that it neither delays nor shows anything in Claude
 * Code; it prints nothing and always succeeds, so that it decides nothing.
 * The user's own hooks run as well, and a user who turned off all hooks
 * turns off these too. One for `/model` too (see `MODEL_SWITCH_EVENT`). With
 * an environment, that of the provider the session runs on (see
 * `claudeSessionEnv`), which takes precedence over the user's and the
 * project's settings, and the model and effort level it starts with (see
 * `ClaudeSessionNote`), in place of any those settings save: a model or an
 * effort level the session's command picks takes precedence over these.
 */
export function claudeCodeSettings(
  hoot: string,
  env: Record<string, string> | null = null,
  note: ClaudeSessionNote = { model: '', effortLevel: null },
): Record<string, unknown> {
  const hook = { type: 'command', command: quote([hoot, 'hook']), async: true }
  return {
    hooks: Object.fromEntries(
      [...HOOK_EVENTS, MODEL_SWITCH_EVENT].map((event) => [event, [{ hooks: [hook] }]]),
    ),
    ...(env === null
      ? {}
      : {
          env,
          model: note.model,
          ...(note.effortLevel === null ? {} : { effortLevel: note.effortLevel }),
        }),
  }
}

/**
 * The file of a Claude Code session's settings (see `claudeCodeSettings`),
 * named after the session in `folder`. Readable by the user alone, as it can
 * hold the provider's key; its launch's cleanup removes it.
 */
export function claudeSettingsFilePath(folder: string, sessionId: string): string {
  return path.join(folder, `${sessionId}.json`)
}

/**
 * The model and effort level the settings of a Claude Code session on a
 * provider name (see `ClaudeSessionNote`): on a provider of the user's, the
 * model it runs, named, as Claude Code otherwise takes its default for one
 * of Claude's and so for a million tokens of context, and while its agent
 * picks no effort level, the one it starts at (see `claudeDefaultEffort`),
 * unless the model is one of Claude's, whose levels Claude Code knows, as it
 * does those of its own model of a role the agent leaves to it; on its
 * subscription, the account's default.
 */
function claudeSessionNote(context: LaunchContext, agent: AgentLaunchSettings): ClaudeSessionNote {
  const provider = context.provider
  if (provider === null || provider.own !== null) return { model: '', effortLevel: null }
  const runs = claudeSessionModel(provider, agent.model, context.modelMap, context.leavesRoles)
  const model = runs ?? ''
  const claudes = runs === null ? context.leavesRoles : namesClaudeModel(runs)
  if (agent.effort !== null || claudes) return { model, effortLevel: null }
  const levels =
    runs === null
      ? []
      : claudeEffortsOf(catalogModelOf(context.catalogs(), 'claude', provider, runs))
  return { model, effortLevel: claudeDefaultEffort(levels) }
}

/** Writes the settings of a Claude Code session in `cwd` into its file, and returns where that is. */
async function writeClaudeSettings(
  context: LaunchContext,
  cwd: string,
  agent: AgentLaunchSettings,
): Promise<string> {
  const provider = context.provider
  const env =
    provider === null
      ? null
      : claudeSessionEnv(
          provider,
          { model: agent.model, modelMap: context.modelMap, leavesRoles: context.leavesRoles },
          await context.claudeUserVariables(cwd),
          (id) => catalogModelOf(context.catalogs(), 'claude', provider, id),
        )
  const settings = claudeCodeSettings(
    path.join(context.hoot.binDirectory, 'hoot'),
    env,
    claudeSessionNote(context, agent),
  )
  const file = claudeSettingsFilePath(context.settingsFolder, context.hoot.sessionId)
  try {
    await fs.mkdir(context.settingsFolder, { recursive: true, mode: 0o700 })
    await fs.writeFile(file, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 })
    await fs.chmod(file, 0o600)
  } catch (error) {
    await fs.rm(file, { force: true }).catch(() => {})
    throw new SessionError(
      `Could not write the session's settings: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return file
}

/**
 * What turns an agent's own updater off in a session whose installation
 * follows anything but its latest version, so that the session does not
 * update it: Claude Code's variable, which leaves `claude update` working;
 * OpenCode's. Codex takes an argument instead (see `CODEX_NO_UPDATE_CHECK`).
 */
const NO_SELF_UPDATE_ENV: Partial<Record<CodingToolId, Record<string, string>>> = {
  claude: { DISABLE_AUTOUPDATER: '1' },
  opencode: { OPENCODE_DISABLE_AUTOUPDATE: '1' },
}

/** The arguments that keep Codex from offering to update itself when a session starts. */
const CODEX_NO_UPDATE_CHECK = ['-c', 'check_for_update_on_startup=false']

/**
 * The setting Hoot adds to every Codex session it starts, with `-c`, on top
 * of the user's own: a hook on each message the user submits, which runs
 * hoot's `hook` command, as the command `hoot` the session's PATH finds
 * first, with the hook's input, so that the session's hoot reports the
 * conversation the message went to, and the model it went to. It runs in the
 * background, so that it neither delays nor shows anything in Codex; it
 * prints nothing and always succeeds, so that it decides nothing. Codex runs
 * it once the user trusted it, which Codex asks about the first time, naming
 * it by its status message: a change to any of it, that message included,
 * makes Codex ask again. The user's own hooks run as well, and a user who
 * turned off Codex's hooks turns off this one too.
 */
export const CODEX_HOOK_SETTING =
  'hooks.UserPromptSubmit=[{hooks=[{type="command",command="hoot hook",async=true,' +
  'statusMessage="Let Hoot know which conversation this is"}]}]'

/**
 * The file of a Codex session's catalog, named after the session in
 * `folder`; its launch's cleanup removes it.
 */
export function codexCatalogFilePath(folder: string, sessionId: string): string {
  return path.join(folder, `${sessionId}.codex-models.json`)
}

/**
 * Writes the catalog of a Codex session into its file, and returns where
 * that is. `null` where it cannot be written, as the session runs without
 * one then.
 */
async function writeCodexCatalog(
  context: LaunchContext,
  catalog: CodexCatalog,
): Promise<string | null> {
  const file = codexCatalogFilePath(context.settingsFolder, context.hoot.sessionId)
  try {
    await fs.mkdir(context.settingsFolder, { recursive: true, mode: 0o700 })
    await fs.writeFile(file, JSON.stringify(catalog), { mode: 0o600 })
    return file
  } catch (error) {
    console.error("Could not write the Codex session's catalog:", error)
    await fs.rm(file, { force: true }).catch(() => {})
    return null
  }
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

/**
 * The first message sent to an agent when an issue is handed to it in a new
 * worktree: its title as a Markdown heading and its description directly when
 * they fit on the command line, or a short message pointing to the issue's
 * file written inside the worktree when they do not.
 */
export async function issueAgentFirstMessage(
  cwd: string,
  issue: Pick<Issue, 'title' | 'description'>,
): Promise<string> {
  const inline = issueFirstMessage(issue)
  if (inline.length <= MAX_INLINE_ISSUE_MESSAGE_LENGTH) return inline
  const folder = await writeIssueFolder(cwd, {
    title: issue.title,
    description: issue.description,
    branch: '',
    workflowFile: null,
    firstMessage: () => '',
  })
  const file = path.join(folder, ISSUE_FILE_NAME)
  return `# ${issue.title}\n\nThe full issue is in \`${file}\`.`
}

async function checkFolder(cwd: string): Promise<void> {
  const stats = await fs.stat(cwd).catch(() => null)
  if (!stats?.isDirectory()) {
    throw new SessionError(`The folder no longer exists: ${cwd}`)
  }
}

/** Whether OpenCode's extra arguments pick the server it runs with: another, or one of its own. */
function picksServer(extraArgs: readonly string[]): boolean {
  return extraArgs.some(
    (argument) =>
      argument === '--server' || argument.startsWith('--server=') || argument === '--standalone',
  )
}

/**
 * The arguments that continue a chat's conversation: Claude Code's
 * `--resume`, OpenCode's `-s`, Codex's `resume` subcommand and Antigravity
 * CLI's `--conversation`. A new conversation starts as any other session
 * does, with an id the agent picks.
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
    case 'antigravity':
      return { before: [], after: [`--conversation=${id}`] }
  }
}

/**
 * The arguments that send an agent the first message of a conversation it
 * starts, after all its others, without its NUL characters: for Claude Code
 * and Codex the message after `--`, which ends the options, so that one
 * starting with `-` is still the message, and for OpenCode and Antigravity
 * CLI the value of its `--prompt` or `--prompt-interactive`, given with `=`,
 * as one argument. Each agent sends it as soon as it is ready, without the
 * user typing anything.
 */
export function firstMessageArguments(tool: CodingToolId, message: string): string[] {
  const text = withoutNul(message)
  switch (tool) {
    case 'claude':
    case 'codex':
      return ['--', text]
    case 'opencode':
      return [`--prompt=${text}`]
    case 'antigravity':
      return [`--prompt-interactive=${text}`]
  }
}

/**
 * The arguments Hoot adds to every Antigravity CLI session: the folder of
 * its hooks, as a folder of the session's workspace, whose hooks Antigravity
 * CLI runs as it runs those of its own folders, without asking whether to
 * trust it. In a chat's own folder (see `ChatLaunch`), the setting that
 * trusts that folder for the session alone, as it would be once the user
 * said so, unless the extra arguments give settings of their own: it is the
 * one folder of the session Antigravity CLI would ask about.
 */
export function antigravityArguments(
  hooks: string,
  cwd: string,
  chat: ChatLaunch | null,
  extraArgs: readonly string[],
): string[] {
  const own = chat?.ownFolder === true
  const settings = extraArgs.some(
    (argument) => argument === '--settings' || argument.startsWith('--settings='),
  )
  return [
    '--add-dir',
    hooks,
    ...(own && !settings ? ['--settings', JSON.stringify({ trustedWorkspaces: [cwd] })] : []),
  ]
}

/**
 * The command a session of a coding tool runs: the one found on the login
 * shell PATH, or in a folder its official installer puts it in (see
 * `findAgentCommand`), the installation the Agents page shows, once the
 * version it reports, as `version` reads it, is one Hoot works with (see
 * `minimumVersion`); one whose version cannot be read is taken to be. One
 * that is not installed, or is older, fails as a `SessionError` that says to
 * install or update it on the Agents page.
 */
export async function agentCommandOf(
  tool: CodingToolDefinition,
  env: Env,
  home: string,
  version: (command: string) => Promise<string | null>,
): Promise<string> {
  const found = await findAgentCommand(tool.id, tool.command, env, home)
  if (!found) {
    throw new SessionError(`${tool.label} is not installed. Install it on the Agents page.`)
  }
  const reported = await version(found)
  if (reported !== null && belowMinimumVersion(tool.id, reported)) {
    throw new SessionError(`${minimumVersionText(tool.id)}. Update it on the Agents page.`)
  }
  return found
}

/**
 * Decides what a session runs in its working directory (the project root, or
 * the root of one of the project's worktrees). A Terminal session runs the
 * default shell with its arguments, as a login shell outside Windows,
 * starting from the same environment a terminal opened from the Dock or the
 * Start menu would give it. A coding tool runs its command directly (see
 * `agentCommandOf`), the installation the Agents page shows, once it is new
 * enough for Hoot. On Windows, where the command that npm or pnpm makes is a
 * batch file, the tool runs what that points to instead (see
 * `commandProgram`). It runs with the login shell environment and with the
 * arguments the Agents page shows: the YOLO arguments while YOLO mode is on,
 * the chosen model and effort, and the extra arguments; then the hooks Hoot
 * adds, to Claude Code and to Codex, and, when Claude Code is sent an issue,
 * the arguments that send it, once the issue's files are written; the
 * launch's cleanup removes their folder. Codex also runs without its shared
 * background server, and on a provider of the user's, with a catalog of the
 * provider's models (see `codexSessionCatalog`). Antigravity CLI gets the
 * folder of Hoot's hooks (see `antigravityArguments`). OpenCode gets Hoot's
 * plugin instead, in its environment (see `openCodeCliConfig`), with no
 * argument for it, and connects to Hoot's server of OpenCode where it is
 * given one, with its password in its environment, unless its extra
 * arguments pick a server of their own; else to its background service. A
 * chat's session also gets the arguments that continue its conversation, and
 * those that send the first message of one it starts with one. Either
 * environment also has what hoot needs to run in the session.
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
  const found = await agentCommandOf(tool, login.env, context.home, (command) =>
    context.agentVersion(tool.id, command, login.env),
  )
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
  const ownUpdates = context.follow(tool.id).kind === 'latest'
  for (const [name, value] of Object.entries(
    ownUpdates ? {} : (NO_SELF_UPDATE_ENV[tool.id] ?? {}),
  )) {
    setEnvVariable(env, name, value)
  }
  if (tool.id === 'opencode') {
    const settings = await openCodeCliConfig({
      env: login.env,
      cwd,
      plugin: context.openCodePlugin,
    })
    setEnvVariable(env, OPENCODE_CLI_CONFIG, settings)
    env[HOOT_ENV.openCodePlugin] = '1'
  }
  const chatArguments = chatLaunchArguments(tool.id, chat)
  let agent = launch.agent
  /** The agent's arguments that go before all others: Codex's `--no-daemon`, OpenCode's `--server`. */
  let leadingArguments: string[] = []
  const server = tool.id === 'opencode' ? context.openCodeServer : null
  if (server !== null && !picksServer(agent.extraArgs)) {
    leadingArguments = ['--server', server.url]
    setEnvVariable(env, OPENCODE_PASSWORD, server.password)
  }
  /** The arguments that run Codex on the session's provider. */
  let providerArguments: string[] = []
  let hookArguments: string[] = []
  /**
   * The file of a Claude Code session's settings, or of a Codex session's
   * catalog, which its cleanup removes.
   */
  let settingsFile: string | null = null
  if (tool.id === 'claude') {
    settingsFile = await writeClaudeSettings(context, cwd, agent)
    hookArguments = ['--settings', settingsFile]
  } else if (tool.id === 'codex') {
    // Codex runs on the session's provider by its own arguments and a
    // variable that holds the key, with a model and an effort level too.
    // On a provider of the user's, with a catalog of its models; on Codex's
    // own sign-in, where the user's configuration names a catalog of its
    // own, with Codex's own in its place, and while the agent names no
    // model, with the one Codex starts with on it, not the configuration's.
    const provider = context.provider
    if (provider !== null) {
      const catalogs = context.catalogs()
      const codex = codexProviderLaunch(provider, agent.model, agent.effort, catalogs)
      agent = { ...agent, model: codex.model, effort: codex.effort }
      providerArguments = codex.args
      for (const [name, value] of Object.entries(codex.env)) setEnvVariable(env, name, value)
      const replaces = provider.own === null || (await context.codexNamesCatalog(login.env))
      const support = replaces ? await context.codexCatalogSupport(found, login.env) : null
      if (support !== null) {
        if (provider.own === null) {
          const catalog = codexSessionCatalog({
            models: agentModels('codex', provider, catalogs),
            model: codex.model,
            catalogModel: (id) => catalogModelOf(catalogs, 'codex', provider, id),
            own: support.own,
          })
          settingsFile = await writeCodexCatalog(context, catalog)
        } else {
          settingsFile = await writeCodexCatalog(context, { models: support.own })
          agent = { ...agent, model: agent.model ?? codexDefaultModel(support.own) }
        }
        if (settingsFile !== null) {
          providerArguments = [
            ...providerArguments,
            '-c',
            `model_catalog_json=${tomlString(settingsFile)}`,
          ]
        }
      }
    }
    // Without its shared background server, which the settings Hoot gives it
    // with `-c` keep it from anyway: it then does not warn of them as each
    // session starts.
    if (!agent.extraArgs.includes('--no-daemon')) leadingArguments = ['--no-daemon']
    hookArguments = ['-c', CODEX_HOOK_SETTING]
    if (!ownUpdates) providerArguments = [...providerArguments, ...CODEX_NO_UPDATE_CHECK]
  } else if (tool.id === 'antigravity') {
    hookArguments = antigravityArguments(context.antigravityHooks, cwd, chat, agent.extraArgs)
  }
  const removeSettings = () => {
    if (settingsFile !== null) rmSync(settingsFile, { force: true })
  }
  const args = [
    ...program.args,
    ...chatArguments.before,
    ...leadingArguments,
    ...providerArguments,
    ...agentLaunchArguments({
      tool: tool.id,
      yoloMode: launch.yoloMode,
      settings: agent,
      hookArguments,
    }),
    ...chatArguments.after,
    ...(chat?.firstMessage === undefined ? [] : firstMessageArguments(tool.id, chat.firstMessage)),
  ]
  if (issue === null) {
    return {
      file: program.file,
      args,
      env,
      ...(settingsFile === null ? {} : { cleanup: removeSettings }),
    }
  }
  // Written last, so that a launch that fails leaves no folder of its own behind.
  let issueFolder: string
  try {
    issueFolder = await writeIssueFolder(cwd, issue)
  } catch (error) {
    removeSettings()
    throw error
  }
  return {
    file: program.file,
    args: [...args, ...sentIssueArgs(issueFolder, issue)],
    env,
    cleanup: () => {
      removeSettings()
      rmSync(issueFolder, { recursive: true, force: true })
    },
  }
}

import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import {
  app,
  clipboard,
  dialog,
  ipcMain,
  shell,
  type BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron'
import type { AppInfo } from '../shared/app-info'
import { APPEARANCES } from '../shared/appearance'
import {
  IpcChannel,
  type AddProjectConfirmation,
  type AddProjectResult,
  type ArchiveChatResult,
  type CreateChatResult,
  type CreateLabelGroupResult,
  type CreateLabelResult,
  type CreateSavedSessionResult,
  type DeleteChatResult,
  type DependencyChangeResult,
  type IssueLabelsRequest,
  type LabelChangeRequest,
  type LabelChangeResult,
  type NewIssueDependency,
  type NewLabelRequest,
  type SessionStartAnswer,
  type StartSessionRequest,
  type StartSessionResult,
  type StartupState,
  type SubIssueChangeResult,
  type UnarchiveChatResult,
  type WindowState,
} from '../shared/ipc'
import {
  issueIdentifier,
  type Issue,
  type IssueChanges,
  type IssueResult,
  type NewIssue,
} from '../shared/issues'
import type { Dependency } from '../shared/dependencies'
import {
  MAX_ADDED_FILE_BYTES,
  MAX_OPENED_FILE_BYTES,
  type AddFileResult,
  type ListFolderResult,
  type ReadFileResult,
  type WriteFileResult,
} from '../shared/files'
import { MAX_PROMPT_LENGTH } from '../shared/hoot-cli'
import { browserLink } from '../shared/links'
import { SIDEBAR_GROUPS } from '../shared/sidebar-groups'
import type { ParentChange } from '../shared/sub-issues'
import {
  canRun,
  CLAUDE_ROLES,
  leavesRolesToClaude,
  modelMapOn,
  type KeyHeader,
  type ProviderCloud,
  type WireFormat,
} from '../shared/providers'
import { CODING_TOOL_IDS, TOOL_IDS, type CodingToolId } from '../shared/tools'
import { plainFirstMessage } from '../shared/workflow-text'
import type { WorkflowStep } from '../shared/workflows'
import type {
  CreateIssueWorktreeResult,
  CreateWorktreeRequest,
  CreateWorktreeResult,
  NewWorktreeOptionsResult,
  RemoveWorktreeResult,
  StartDeletionResult,
  StartMergeResult,
} from '../shared/worktrees'
import type { AgentService } from './agents/agent-service'
import type { ChatAgent, ChatManager, PreparedChatSession } from './chats/chat-manager'
import type { FileWatcher } from './files/file-watcher'
import type { FolderAccess } from './files/folder-access'
import {
  addFileNextTo,
  entryLocation,
  listFolder,
  readFile,
  writeTextFile,
} from './files/folder-files'
import { issueDescription, issuePriority, issueStatus, issueTitle } from './issues/issue-schemas'
import type { IssueStore } from './issues/issue-store'
import { LabelError, type LabelStore } from './labels/label-store'
import type { AddProjectInspection } from './projects/add-project'
import type { ProjectFolders } from './projects/project-folders'
import type { ProjectStore } from './projects/project-store'
import type { QuitGuard } from './quit-guard'
import type { ModelsDev } from './providers/models-dev'
import type { ProviderService } from './providers/provider-service'
import type { AgentLaunch, SentIssue } from './session/launch'
import { SessionError, type SessionManager } from './session/session-manager'
import type { SessionStartRequests } from './session/session-starts'
import type { AppearanceStore } from './settings/appearance-store'
import type { FilePanelStore } from './settings/file-panel-store'
import type { IssueWindowStore } from './settings/issue-window-store'
import type { LaunchSettingsStore } from './settings/launch-settings-store'
import type { SidebarStateStore } from './settings/sidebar-state-store'
import type { ToolService } from './tools/tool-service'
import type { UpdateService } from './updates/update-service'
import type { WorkflowExecutor } from './workflows/workflow-executor'
import { deletionInstruction } from './worktrees/deletion'
import { mergeInstruction } from './worktrees/merge'
import type { WorktreeService } from './worktrees/worktree-service'

export interface IpcDependencies {
  getWindow(): BrowserWindow | null
  /** What the About page tells of Hoot and of what it runs on. */
  appInfo: AppInfo
  projects: ProjectStore
  issues: IssueStore
  labels: LabelStore
  tools: ToolService
  agents: AgentService
  launchSettings: LaunchSettingsStore
  /** The user's providers, the agents made of them, and each installed agent's global. */
  providers: ProviderService
  /** The models of the providers Hoot knows, as models.dev lists them. */
  models: ModelsDev
  sidebar: SidebarStateStore
  /** Whether the file panel is shown, and how wide its parts are. */
  filePanel: FilePanelStore
  /** Whether the Issues window is open, and where it sits. */
  issueWindow: IssueWindowStore
  /** Which folders the file panel may read and write files in. */
  folderAccess: FolderAccess
  /** The entries the file panel follows: its open files and expanded folders. */
  fileWatcher: FileWatcher
  appearance: AppearanceStore
  sessions: SessionManager
  /** The chats, which belong to no project. */
  chats: ChatManager
  quitGuard: QuitGuard
  updates: UpdateService
  worktrees: WorktreeService
  /** The projects' own folders: whether each is there, and what is checked out in it. */
  projectFolders: ProjectFolders
  /** Runs the issues' workflow; `null` while none runs. */
  workflows: WorkflowExecutor | null
  /** The sessions hoot asked for, which the window answers. */
  sessionStarts: SessionStartRequests
  /** What adding a folder as a project takes: nothing, or a first commit after a confirmation. */
  inspectProjectFolder(directory: string): Promise<AddProjectInspection>
  /** Runs `git init` in a folder, or makes the first commit of a repository without one. */
  initializeProject(
    folder: string,
    mode: 'init' | 'first-commit',
  ): Promise<{ ok: true; root: string } | { ok: false; message: string }>
}

const sessionId = z.string().min(1).max(100)
const terminalDimension = z.number().int().positive().max(9_999)
const rowId = z.number().int().positive()
/** Where the Issues window sits, as the window says it moved it. */
const issueWindowPosition = z.object({
  side: z.enum(['left', 'right']),
  x: z.number().nonnegative().max(100_000),
  edge: z.enum(['top', 'bottom']),
  y: z.number().nonnegative().max(100_000),
})
const startSessionRequest = z.object({
  id: sessionId,
  projectRoot: z.string().min(1),
  worktreePath: z.string().min(1).nullable(),
  chatId: z.string().min(1).max(100).nullable().optional(),
  savedSessionId: z.string().min(1).max(100).nullable().optional(),
  toolId: z.enum(TOOL_IDS),
  agentId: z.string().min(1).max(100).nullable().optional(),
  issueId: rowId.nullable(),
  startedBy: z.enum(['user', 'agent']).optional(),
  prompt: z.string().max(MAX_PROMPT_LENGTH).optional(),
  cols: terminalDimension,
  rows: terminalDimension,
}) satisfies z.ZodType<StartSessionRequest>
const projectRoot = z.string().min(1)
const worktreeArguments = z.tuple([projectRoot, z.string().min(1)])
/** A project, and the root of the worktree a new one is made from, if any. */
const newWorktreeOptionsArguments = z.tuple([projectRoot, z.string().min(1).optional()])
const createWorktreeRequest = z.object({
  projectRoot,
  name: z.string().max(10_000),
  agentId: z.string().min(1).max(100),
  base: z.string().min(1),
  nested: z
    .array(z.object({ relativePath: z.string().min(1), base: z.string().min(1) }))
    .max(1_000),
}) satisfies z.ZodType<CreateWorktreeRequest>
const addProjectConfirmation = z.object({
  folder: z.string().min(1),
  mode: z.enum(['init', 'first-commit']),
}) satisfies z.ZodType<AddProjectConfirmation>
/** An agent, by its id. */
const agentId = z.string().min(1).max(100)
const savedSessionArguments = z.tuple([projectRoot, z.string().min(1).nullable(), agentId])
/** A project, the root of one of its worktrees, and the agent of a session that works on it. */
const worktreeAgentArguments = z.tuple([projectRoot, z.string().min(1), agentId])
const submoduleArguments = z.tuple([
  projectRoot,
  z.array(z.object({ relativePath: z.string(), base: z.string().min(1) })).max(1_000),
])
const writeArguments = z.tuple([sessionId, z.string(), z.boolean().optional()])
const resizeArguments = z.tuple([sessionId, terminalDimension, terminalDimension])
const newIssue = z.object({
  projectId: rowId.nullable(),
  title: issueTitle,
  description: issueDescription,
  status: issueStatus,
  priority: issuePriority,
}) satisfies z.ZodType<NewIssue>
const parentChanges = z
  .array(z.strictObject({ issueId: rowId, parentId: rowId.nullable() }))
  .min(1)
  .max(1_000) satisfies z.ZodType<ParentChange[]>
const dependency = z.strictObject({
  issueId: rowId,
  blockedById: rowId,
}) satisfies z.ZodType<Dependency>
const dependencyChange = z.strictObject({
  add: z.array(dependency).max(1_000),
  remove: z.array(dependency).max(1_000),
})
const newIssueDependency = z.union([
  z.strictObject({ blocking: rowId }),
  z.strictObject({ blockedBy: rowId }),
]) satisfies z.ZodType<NewIssueDependency>
const issueChanges = z.strictObject({
  title: issueTitle.optional(),
  description: issueDescription.optional(),
  status: issueStatus.optional(),
  priority: issuePriority.optional(),
  projectId: rowId.nullable().optional(),
}) satisfies z.ZodType<IssueChanges>
const labelField = z.string().max(100_000)
const newLabelRequest = z.strictObject({
  name: labelField,
  color: labelField,
  description: labelField,
  groupId: rowId.nullable(),
  issueId: rowId.optional(),
}) satisfies z.ZodType<NewLabelRequest>
const labelChangeRequest = z.strictObject({
  name: labelField.optional(),
  color: labelField.optional(),
  description: labelField.optional(),
  groupId: rowId.nullable().optional(),
}) satisfies z.ZodType<LabelChangeRequest>
const issueLabelsRequest = z.strictObject({
  add: z.array(rowId).max(1_000),
  remove: z.array(rowId).max(1_000),
}) satisfies z.ZodType<IssueLabelsRequest>
const sessionStartAnswer = z.union([
  z.strictObject({ ok: z.literal(true), worktreePath: z.string() }),
  z.strictObject({ ok: z.literal(false), message: z.string().max(100_000) }),
]) satisfies z.ZodType<SessionStartAnswer>
/** A coding tool, whose program the Agents page installs and updates. */
const toolId = z.enum(CODING_TOOL_IDS)
const installRoute = z.enum(['official', 'npm'])
const agentFollow = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('latest') }),
  z.object({ kind: z.literal('stable') }),
  z.object({ kind: z.literal('stay'), version: z.string().min(1) }),
])
const providerText = z.string().max(10_000)
const providerUrls = z.strictObject({
  anthropic: providerText.optional(),
  responses: providerText.optional(),
}) satisfies z.ZodType<Partial<Record<WireFormat, string>>>
const keyHeader = z.enum(['bearer', 'x-api-key']) satisfies z.ZodType<KeyHeader>
const providerModels = z.array(z.string().max(1_000)).max(1_000)
const cloudPlace = z.string().trim().min(1).max(100)
const providerCloud = z
  .discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('bedrock'), region: cloudPlace }),
    z.strictObject({ kind: z.literal('vertex'), region: cloudPlace, project: cloudPlace }),
  ])
  .nullable() satisfies z.ZodType<ProviderCloud | null>
const newProvider = z.strictObject({
  name: providerText,
  presetId: z.string().max(100).nullable(),
  planId: z.string().max(100).nullable(),
  apiKey: providerText,
  keyHeader,
  urls: providerUrls,
  models: providerModels,
  cloud: providerCloud,
})
const providerChange = z.strictObject({
  name: providerText.optional(),
  presetId: z.string().max(100).nullable().optional(),
  planId: z.string().max(100).nullable().optional(),
  apiKey: providerText.optional(),
  keyHeader: keyHeader.optional(),
  urls: providerUrls.optional(),
  models: providerModels.optional(),
  cloud: providerCloud.optional(),
})
const agentModel = z.string().max(1_000).nullable()
/** The models of its provider a Claude Code agent maps Claude Code's roles to, by role. */
const modelMap = z.partialRecord(z.enum(CLAUDE_ROLES), z.string().min(1).max(1_000))
const agentEffort = z.string().min(1).max(100).nullable()
const agentExtraArgs = z.array(z.string().min(1).max(10_000)).max(1_000)
const newAgent = z.strictObject({
  harness: toolId,
  providerId: z.string().min(1).max(100),
  model: agentModel,
  name: z.string().max(1_000).nullable().optional(),
  effort: agentEffort.optional(),
  extraArgs: agentExtraArgs.optional(),
  modelMap: modelMap.optional(),
})
const agentChange = z.strictObject({
  providerId: z.string().min(1).max(100).optional(),
  name: z.string().max(1_000).nullable().optional(),
  enabled: z.boolean().optional(),
  model: agentModel.optional(),
  effort: agentEffort.optional(),
  extraArgs: agentExtraArgs.optional(),
  modelMap: modelMap.optional(),
})
/**
 * Text put on the clipboard: what is selected in a session's terminal, up to
 * its whole scrollback, or what one of its programs puts there, which
 * xterm.js takes in sequences of at most 10 million characters; an issue's
 * identifier or title; or what the About page tells of Hoot.
 */
const clipboardText = z.string().max(10_000_000)
/** A file panel's folder: a project's root, and one of its worktrees or `null` for its own folder. */
const panelFolder = [z.string().min(1), z.string().min(1).nullable()] as const
/** The path of an entry of a file panel's folder (see `src/shared/files.ts`). */
const entryPath = z.string().max(4_096)
/** The version of a file the file panel read or wrote. */
const fileVersion = z.object({ mtimeMs: z.number(), size: z.number() })
/** What the file panel saves to a file: the text of a file it opened, edited. */
const fileContent = z.string().max(2 * MAX_OPENED_FILE_BYTES)
/** What the file panel adds to its folder: a picture pasted or dropped into a document. */
const addedFile = z
  .instanceof(Uint8Array)
  .refine((bytes) => bytes.byteLength <= MAX_ADDED_FILE_BYTES)

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Runs a change to an issue, saying what went wrong instead of throwing;
 * `missing` says why there is no issue when the change returns none.
 */
function changeIssue(change: () => Issue | null, missing: string): IssueResult {
  try {
    const issue = change()
    return issue ? { ok: true, issue } : { ok: false, message: missing }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

/** Runs a change to labels, saying why it cannot be made instead of throwing a `LabelError`. */
function changeLabels(change: () => void): LabelChangeResult {
  try {
    change()
    return { ok: true }
  } catch (error) {
    if (error instanceof LabelError) return { ok: false, message: error.message }
    throw error
  }
}

/**
 * An issue of a project as it is saved now, which a session started from its
 * start button is sent, and whose worktree is named after it. Or why there is
 * none: the issue is gone, or belongs to another project or to none.
 */
function issueOfProject(
  issues: IssueStore,
  projectId: number,
  issueId: number,
): { ok: true; issue: Issue } | { ok: false; message: string } {
  let issue: Issue | null
  try {
    issue = issues.get(issueId)
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
  if (issue === null) return { ok: false, message: 'The issue no longer exists.' }
  if (issue.projectId !== projectId) {
    return { ok: false, message: 'The issue is no longer in this project.' }
  }
  return { ok: true, issue }
}

/** Registers handlers that accept messages only from the main window. */
function trustedIpc(getWindow: () => BrowserWindow | null) {
  const trusted = (event: IpcMainInvokeEvent | IpcMainEvent) => {
    const window = getWindow()
    return window !== null && !window.isDestroyed() && event.sender === window.webContents
  }
  const handle = (
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
  ) => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!trusted(event)) throw new Error('Untrusted sender.')
      return handler(event, ...args)
    })
  }
  const on = (channel: string, listener: (...args: unknown[]) => void) => {
    ipcMain.on(channel, (event, ...args) => {
      if (trusted(event)) listener(...args)
    })
  }
  const send = (channel: string, ...args: unknown[]) => {
    const window = getWindow()
    if (window && !window.isDestroyed()) window.webContents.send(channel, ...args)
  }
  return { handle, on, send }
}

/** Maximizes the window, or restores the size it had before, as its own button does. */
function toggleMaximized(window: BrowserWindow | null): void {
  if (!window) return
  if (window.isMaximized()) window.unmaximize()
  else window.maximize()
}

/**
 * The messages the window can send while the database cannot be opened: it
 * learns why, and can show the file in Finder (File Explorer on Windows) or
 * quit.
 */
export function registerDatabaseErrorIpc(options: {
  getWindow(): BrowserWindow | null
  databasePath: string
  message: string
}): void {
  const { handle, on } = trustedIpc(options.getWindow)
  handle(IpcChannel.getStartupState, (): StartupState => ({
    kind: 'database-error',
    message: options.message,
    path: options.databasePath,
  }))
  on(IpcChannel.revealDatabase, () => {
    // The file, or the nearest of its folders that can be seen, such as the
    // one it is in when that cannot be read.
    let target = options.databasePath
    while (!fs.existsSync(target) && path.dirname(target) !== target) {
      target = path.dirname(target)
    }
    shell.showItemInFolder(target)
  })
  on(IpcChannel.quit, () => app.quit())
  // The window's own buttons, which the page draws on Windows.
  on(IpcChannel.minimizeWindow, () => options.getWindow()?.minimize())
  on(IpcChannel.toggleMaximizeWindow, () => toggleMaximized(options.getWindow()))
  on(IpcChannel.closeWindow, () => options.getWindow()?.close())
}

export function registerIpc(deps: IpcDependencies): void {
  const { handle, on, send } = trustedIpc(deps.getWindow)

  handle(IpcChannel.getStartupState, (): StartupState => ({ kind: 'ready' }))

  handle(IpcChannel.listProjects, () => deps.projects.list())

  /** Adds a folder that is ready to be a project: to the list, and its worktrees. */
  const addProjectRoot = (root: string): AddProjectResult => {
    const { added, project } = deps.projects.add(root)
    if (!added) return { kind: 'duplicate', project }
    deps.worktrees.addProject(project.root)
    deps.projectFolders.addProject(project.root)
    send(IpcChannel.projectsChanged, deps.projects.list())
    return { kind: 'added', project }
  }

  /** What adding a folder comes to: added, or what the confirmation must say first. */
  const inspectProjectFolder = async (directory: string): Promise<AddProjectResult> => {
    const inspection = await deps.inspectProjectFolder(directory)
    switch (inspection.kind) {
      case 'ready':
        return addProjectRoot(inspection.root)
      case 'needs-init':
        return {
          kind: 'needs-init',
          folder: inspection.folder,
          fileCount: inspection.fileCount,
          hasGitignore: inspection.hasGitignore,
        }
      case 'needs-first-commit':
        return {
          kind: 'needs-first-commit',
          folder: inspection.folder,
          fileCount: inspection.fileCount,
          hasGitignore: inspection.hasGitignore,
        }
      case 'bare':
        return { kind: 'bare', path: directory }
      case 'unknown-main-worktree':
        return { kind: 'unknown-main-worktree', path: directory }
      case 'error':
        return { kind: 'error', message: inspection.message }
    }
  }

  handle(IpcChannel.addProject, async (): Promise<AddProjectResult> => {
    const window = deps.getWindow()
    const options: Electron.OpenDialogOptions = {
      title: 'Add Project',
      buttonLabel: 'Add Project',
      properties: ['openDirectory', 'createDirectory'],
    }
    const selection = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    const directory = selection.filePaths[0]
    if (selection.canceled || !directory) return { kind: 'cancelled' }
    return inspectProjectFolder(directory)
  })

  handle(IpcChannel.addProjectConfirmed, async (_event, value): Promise<AddProjectResult> => {
    const parsed = addProjectConfirmation.safeParse(value)
    if (!parsed.success) return { kind: 'error', message: 'Invalid request.' }
    const { folder, mode } = parsed.data
    // What was confirmed may have changed since, as by a commit made meanwhile.
    const inspection = await deps.inspectProjectFolder(folder)
    const expected = mode === 'init' ? 'needs-init' : 'needs-first-commit'
    if (inspection.kind !== expected) {
      return {
        kind: 'error',
        message:
          inspection.kind === 'error'
            ? inspection.message
            : 'The folder changed since Hoot asked; add it again.',
      }
    }
    const result = await deps.initializeProject(folder, mode)
    if (!result.ok) return { kind: 'error', message: result.message }
    return addProjectRoot(result.root)
  })

  handle(IpcChannel.removeProject, (_event, value) => {
    const parsed = projectRoot.safeParse(value)
    if (!parsed.success) return { ok: false, message: 'Invalid project.' }
    const root = parsed.data
    // Also a session in one of its worktrees.
    if (deps.sessions.isRunningIn(root)) {
      return {
        ok: false,
        message: 'Close the running sessions of this project before removing it.',
      }
    }
    deps.projects.remove(root)
    // Added again, it is expanded in the sidebar.
    deps.sidebar.retainProjects(deps.projects.list().map((project) => project.id))
    // Its worktrees, their files and branches stay as they are, and so does
    // its own folder; its saved sessions stay for when it is added again.
    deps.worktrees.removeProject(root)
    deps.projectFolders.removeProject(root)
    // Removing a project closes its sessions, which have all ended.
    deps.sessions.forgetProject(root)
    send(IpcChannel.projectsChanged, deps.projects.list())
    return { ok: true }
  })

  handle(IpcChannel.getTools, () => deps.tools.settledState())
  deps.tools.on('changed', (state) => send(IpcChannel.toolsChanged, state))

  handle(IpcChannel.getAgents, () => deps.agents.getState())
  on(IpcChannel.enterAgentsPage, () => deps.agents.openPage())
  on(IpcChannel.detectAgents, () => void deps.agents.detect())
  on(IpcChannel.readAgentModels, (id) => {
    const parsed = toolId.safeParse(id)
    if (parsed.success) deps.agents.readModels(parsed.data)
  })
  deps.agents.on('changed', (state) => send(IpcChannel.agentsChanged, state))
  on(IpcChannel.installAgent, (id, route) => {
    const parsed = z.tuple([toolId, installRoute.optional()]).safeParse([id, route])
    if (parsed.success) deps.agents.install(...parsed.data)
  })
  on(IpcChannel.updateAgent, (id) => {
    const parsed = toolId.safeParse(id)
    if (parsed.success) deps.agents.update(parsed.data)
  })
  on(IpcChannel.updateAllAgents, () => deps.agents.updateAll())
  on(IpcChannel.cancelAgentOperation, (id) => {
    const parsed = toolId.safeParse(id)
    if (parsed.success) deps.agents.cancel(parsed.data)
  })
  on(IpcChannel.setAgentFollow, (id, follow) => {
    const parsed = z.tuple([toolId, agentFollow]).safeParse([id, follow])
    if (parsed.success) deps.agents.setFollow(...parsed.data)
  })
  on(IpcChannel.restoreAgent, (id) => {
    const parsed = toolId.safeParse(id)
    if (parsed.success) deps.agents.restore(parsed.data)
  })
  on(IpcChannel.uninstallAgent, (id, file) => {
    const parsed = z.tuple([toolId, z.string().min(1)]).safeParse([id, file])
    if (parsed.success) deps.agents.uninstall(...parsed.data)
  })
  on(IpcChannel.retryAgentOperation, (id) => {
    const parsed = toolId.safeParse(id)
    if (parsed.success) deps.agents.retry(parsed.data)
  })

  handle(IpcChannel.getLaunchSettings, () => deps.launchSettings.all())
  on(IpcChannel.setDefaultAgent, (id) => {
    const parsed = agentId.nullable().safeParse(id)
    if (parsed.success) deps.launchSettings.setDefaultAgent(parsed.data)
  })
  on(IpcChannel.setYoloMode, (value) => {
    const parsed = z.boolean().safeParse(value)
    if (parsed.success) deps.launchSettings.setYoloMode(parsed.data)
  })
  deps.launchSettings.on('changed', (settings) => send(IpcChannel.launchSettingsChanged, settings))

  handle(IpcChannel.getProviders, () => deps.providers.getState())
  deps.providers.on('changed', (state) => send(IpcChannel.providersChanged, state))
  handle(IpcChannel.getModelCatalogs, () => deps.models.catalogs())
  deps.models.on('changed', (catalogs) => send(IpcChannel.modelCatalogsChanged, catalogs))
  handle(IpcChannel.addProvider, (_event, value) => {
    const parsed = newProvider.safeParse(value)
    if (!parsed.success) return { ok: false, message: 'Invalid provider.' }
    return deps.providers.addProvider(parsed.data)
  })
  handle(IpcChannel.updateProvider, (_event, ...args) => {
    const parsed = z.tuple([agentId, providerChange]).safeParse(args)
    if (!parsed.success) return { ok: false, message: 'Invalid provider.' }
    return deps.providers.updateProvider(...parsed.data)
  })
  handle(IpcChannel.removeProvider, (_event, value) => {
    const parsed = agentId.safeParse(value)
    if (!parsed.success) return { ok: false, message: 'Invalid provider.' }
    return deps.providers.removeProvider(parsed.data)
  })
  handle(IpcChannel.makeAgent, (_event, value) => {
    const parsed = newAgent.safeParse(value)
    if (!parsed.success) return { ok: false, message: 'Invalid agent.' }
    return deps.providers.addAgent(parsed.data)
  })
  on(IpcChannel.changeAgent, (...args) => {
    const parsed = z.tuple([agentId, agentChange]).safeParse(args)
    if (parsed.success) deps.providers.updateAgent(...parsed.data)
  })
  on(IpcChannel.deleteAgent, (value) => {
    const parsed = agentId.safeParse(value)
    if (parsed.success) deps.providers.removeAgent(parsed.data)
  })

  /**
   * What a new chat or saved session of an agent is made with, by the agent's
   * id: its harness, and the provider and model it runs on. `null` for an
   * agent that is gone, or whose provider is gone or cannot run it.
   */
  const chatAgentOf = (id: string): ChatAgent | null => {
    const agent = deps.providers.agent(id)
    if (agent === undefined) return null
    const provider = deps.providers.provider(agent.providerId)
    if (provider === undefined || !canRun(provider, agent.harness)) return null
    return { toolId: agent.harness, providerId: provider.id, model: agent.model, agentId: agent.id }
  }

  /**
   * What the agent of a chat or saved session starts with: the provider it
   * runs on, which it keeps, or with that gone, its agent's own
   * configuration; its model, else its agent's; and its agent's effort
   * level and extra arguments, while that agent is there.
   */
  const preparedAgent = (prepared: PreparedChatSession): AgentLaunch => {
    const agent = prepared.agentId === null ? undefined : deps.providers.agent(prepared.agentId)
    const provider =
      prepared.providerId === null ? null : (deps.providers.provider(prepared.providerId) ?? null)
    const catalogs = deps.models.catalogs()
    const model = prepared.model ?? agent?.model ?? null
    return {
      settings: {
        enabled: true,
        model,
        effort: agent?.effort ?? null,
        extraArgs: agent?.extraArgs ?? [],
      },
      provider,
      // Its agent's, of the models the provider it keeps offers.
      modelMap:
        agent === undefined || provider === null
          ? {}
          : modelMapOn(agent.modelMap, provider, catalogs),
      // By its agent's model, which a pick with `/model` leaves as it is.
      leavesRoles:
        provider !== null &&
        leavesRolesToClaude(provider, agent === undefined ? model : agent.model, catalogs),
    }
  }

  /**
   * What the agent of a session that is no chat's starts with, by the agent's
   * id, which must be of the session's tool; `null` for a Terminal session.
   */
  const requestedAgent = (
    tool: CodingToolId | 'shell',
    id: string | null | undefined,
  ): AgentLaunch | null | 'invalid' => {
    if (tool === 'shell') return null
    const agent = id === null || id === undefined ? undefined : deps.providers.agent(id)
    if (agent === undefined || agent.harness !== tool) return 'invalid'
    const provider = deps.providers.provider(agent.providerId)
    if (provider === undefined || !canRun(provider, tool)) return 'invalid'
    return {
      settings: {
        enabled: true,
        model: agent.model,
        effort: agent.effort,
        extraArgs: agent.extraArgs,
      },
      provider,
      modelMap: agent.modelMap,
      leavesRoles: leavesRolesToClaude(provider, agent.model, deps.models.catalogs()),
    }
  }

  handle(IpcChannel.getWindowState, (): WindowState => ({
    sidebarOpen: deps.sidebar.open,
    sidebarWidth: deps.sidebar.width,
    collapsedGroups: deps.sidebar.collapsedGroups,
    collapsedProjects: deps.sidebar.collapsedProjects,
    collapsedWorktrees: deps.sidebar.collapsedWorktrees,
    collapsedLocal: deps.sidebar.collapsedLocal,
    filePanel: deps.filePanel.layout,
    issueWindow: deps.issueWindow.layout,
    fullScreen: deps.getWindow()?.isFullScreen() ?? false,
    focused: deps.getWindow()?.isFocused() ?? false,
  }))
  // The window's own buttons, which the page draws on Windows.
  on(IpcChannel.minimizeWindow, () => deps.getWindow()?.minimize())
  on(IpcChannel.toggleMaximizeWindow, () => toggleMaximized(deps.getWindow()))
  on(IpcChannel.closeWindow, () => deps.getWindow()?.close())
  on(IpcChannel.setSidebarOpen, (open) => {
    const parsed = z.boolean().safeParse(open)
    if (parsed.success) deps.sidebar.setOpen(parsed.data)
  })
  on(IpcChannel.setSidebarWidth, (width) => {
    const parsed = z.number().safeParse(width)
    if (parsed.success) deps.sidebar.setWidth(parsed.data)
  })
  on(IpcChannel.setFilePanelOpen, (open) => {
    const parsed = z.boolean().safeParse(open)
    if (parsed.success) deps.filePanel.setOpen(parsed.data)
  })
  on(IpcChannel.setFileTreeWidth, (width) => {
    const parsed = z.number().safeParse(width)
    if (parsed.success) deps.filePanel.setTreeWidth(parsed.data)
  })
  on(IpcChannel.setFileEditorWidth, (width) => {
    const parsed = z.number().safeParse(width)
    if (parsed.success) deps.filePanel.setEditorWidth(parsed.data)
  })
  on(IpcChannel.setIssueWindowOpen, (open) => {
    const parsed = z.boolean().safeParse(open)
    if (parsed.success) deps.issueWindow.setOpen(parsed.data)
  })
  on(IpcChannel.setIssueWindowPosition, (position) => {
    const parsed = issueWindowPosition.safeParse(position)
    if (parsed.success) deps.issueWindow.setPosition(parsed.data)
  })
  on(IpcChannel.setGroupExpanded, (...args) => {
    const parsed = z.tuple([z.enum(SIDEBAR_GROUPS), z.boolean()]).safeParse(args)
    if (!parsed.success) return
    const [group, expanded] = parsed.data
    deps.sidebar.setGroupCollapsed(group, !expanded)
  })
  on(IpcChannel.setProjectExpanded, (...args) => {
    const parsed = z.tuple([rowId, z.boolean()]).safeParse(args)
    if (!parsed.success) return
    const [id, expanded] = parsed.data
    // Only a project in the list is kept collapsed.
    if (!expanded && !deps.projects.list().some((project) => project.id === id)) return
    deps.sidebar.setProjectCollapsed(id, !expanded)
  })
  on(IpcChannel.setWorktreeExpanded, (...args) => {
    const parsed = z.tuple([projectRoot, z.string().min(1), z.boolean()]).safeParse(args)
    if (!parsed.success) return
    const [root, worktreePath, expanded] = parsed.data
    // Only a worktree of a project in the list is kept collapsed.
    if (!expanded && !deps.projects.find(root)) return
    deps.sidebar.setWorktreeCollapsed(worktreePath, !expanded)
  })
  on(IpcChannel.setLocalExpanded, (...args) => {
    const parsed = z.tuple([projectRoot, z.boolean()]).safeParse(args)
    if (!parsed.success) return
    const [root, expanded] = parsed.data
    // Only the Local row of a project in the list is kept collapsed.
    if (!expanded && !deps.projects.find(root)) return
    deps.sidebar.setLocalCollapsed(root, !expanded)
  })

  handle(IpcChannel.getAppearance, () => deps.appearance.appearance)
  on(IpcChannel.setAppearance, (appearance) => {
    const parsed = z.enum(APPEARANCES).safeParse(appearance)
    if (parsed.success) deps.appearance.select(parsed.data)
  })
  deps.appearance.on('changed', (appearance) => send(IpcChannel.appearanceChanged, appearance))

  handle(IpcChannel.listSessions, () => deps.sessions.list())

  handle(IpcChannel.listChats, () => deps.chats.list())

  handle(IpcChannel.createChat, async (_event, value): Promise<CreateChatResult> => {
    const parsed = agentId.safeParse(value)
    if (!parsed.success) return { ok: false, message: 'Invalid agent.' }
    const agent = chatAgentOf(parsed.data)
    if (agent === null) return { ok: false, message: 'The agent no longer exists.' }
    try {
      return { ok: true, chat: await deps.chats.create(agent) }
    } catch (error) {
      return { ok: false, message: `Could not make the chat's folder: ${errorMessage(error)}` }
    }
  })

  on(IpcChannel.renameChat, (...args) => {
    const parsed = z.tuple([sessionId, z.string().max(10_000)]).safeParse(args)
    if (parsed.success) deps.chats.rename(...parsed.data)
  })

  on(IpcChannel.setChatTitle, (...args) => {
    const parsed = z.tuple([sessionId, z.string().max(10_000)]).safeParse(args)
    if (parsed.success) deps.chats.setTitle(...parsed.data)
  })

  deps.chats.on('changed', (chats) => send(IpcChannel.chatsChanged, chats))

  /**
   * Why a session cannot start in a project's own folder as it is now, which
   * the window then shows: it is gone. `null` when it can.
   */
  const projectFolderProblem = async (root: string): Promise<string | null> => {
    const folder = await deps.projectFolders.current(root)
    if (folder === null) return 'The project is not in the list.'
    return folder.missing ? `The project folder is missing: ${root}` : null
  }

  /**
   * Deletes a chat, or a saved session for `saved`: its sessions close
   * first, also any that started since the window closed those it showed.
   * One that is gone already needs nothing more.
   */
  const deleteChat = async (value: unknown, saved: boolean): Promise<DeleteChatResult> => {
    const parsed = sessionId.safeParse(value)
    if (!parsed.success) return { ok: false, message: 'Invalid request.' }
    const id = parsed.data
    const found = deps.chats.get(id)
    if (!found) return { ok: true }
    if ((found.projectRoot !== null) !== saved) return { ok: false, message: 'Invalid request.' }
    try {
      await deps.sessions.closeOf(id)
      await deps.chats.delete(id)
      return { ok: true }
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }
  }

  handle(IpcChannel.deleteChat, (_event, value) => deleteChat(value, false))

  handle(IpcChannel.listSavedSessions, () => deps.chats.listSavedSessions())

  handle(
    IpcChannel.createSavedSession,
    async (_event, ...args): Promise<CreateSavedSessionResult> => {
      const parsed = savedSessionArguments.safeParse(args)
      if (!parsed.success) return { ok: false, message: 'Invalid request.' }
      const [root, worktreePath, id] = parsed.data
      if (!deps.projects.find(root))
        return { ok: false, message: 'The project is not in the list.' }
      const agent = chatAgentOf(id)
      if (agent === null) return { ok: false, message: 'The agent no longer exists.' }
      if (worktreePath === null) {
        // As it is now: a project folder gone since its menu showed cannot start a session.
        const problem = await projectFolderProblem(root)
        if (problem !== null) return { ok: false, message: problem }
        return { ok: true, session: deps.chats.createSavedSession(root, null, agent) }
      }
      // As it is now: a worktree deleted or missing since its row showed cannot start a session.
      const worktree = await deps.worktrees.currentWorktree(root, worktreePath)
      if (!worktree) {
        return { ok: false, message: `The worktree no longer exists: ${worktreePath}` }
      }
      if (worktree.missing) {
        return { ok: false, message: `The folder of the worktree is missing: ${worktreePath}` }
      }
      return { ok: true, session: deps.chats.createSavedSession(root, worktreePath, agent) }
    },
  )

  on(IpcChannel.renameSavedSession, (...args) => {
    const parsed = z.tuple([sessionId, z.string().max(10_000)]).safeParse(args)
    if (parsed.success) deps.chats.rename(...parsed.data)
  })

  on(IpcChannel.setSavedSessionTitle, (...args) => {
    const parsed = z.tuple([sessionId, z.string().max(10_000)]).safeParse(args)
    if (parsed.success) deps.chats.setTitle(...parsed.data)
  })

  handle(IpcChannel.deleteSavedSession, (_event, value) => deleteChat(value, true))

  deps.chats.on('saved-changed', (sessions) => send(IpcChannel.savedSessionsChanged, sessions))

  /**
   * Archives a chat or saved session: its sessions close first, as when it is
   * deleted; one that is archived already needs nothing more, and one that
   * went as they closed, or before, is not archived.
   */
  handle(IpcChannel.archiveSession, async (_event, value): Promise<ArchiveChatResult> => {
    const parsed = sessionId.safeParse(value)
    if (!parsed.success) return { ok: false, message: 'Invalid request.' }
    try {
      await deps.sessions.closeOf(parsed.data)
      return { ok: true, archived: await deps.chats.archive(parsed.data) }
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }
  })

  /** Brings an archived chat or saved session back to the sidebar. */
  handle(IpcChannel.unarchiveSession, async (_event, value): Promise<UnarchiveChatResult> => {
    const parsed = sessionId.safeParse(value)
    if (!parsed.success) return { ok: false, message: 'Invalid request.' }
    try {
      await deps.chats.unarchive(parsed.data)
      return { ok: true }
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }
  })

  handle(IpcChannel.listArchivedSessions, () => deps.chats.listArchived())

  deps.chats.on('archived-changed', (sessions) =>
    send(IpcChannel.archivedSessionsChanged, sessions),
  )

  handle(IpcChannel.startSession, async (_event, value): Promise<StartSessionResult> => {
    const parsed = startSessionRequest.safeParse(value)
    if (!parsed.success) return { ok: false, message: 'Invalid session request.' }
    const request = parsed.data
    if (request.chatId !== undefined && request.chatId !== null) {
      const chat = deps.chats.get(request.chatId)
      if (
        !chat ||
        chat.projectRoot !== null ||
        chat.toolId !== request.toolId ||
        request.worktreePath !== null ||
        request.issueId !== null ||
        (request.savedSessionId !== undefined && request.savedSessionId !== null)
      ) {
        return { ok: false, message: 'Invalid session request.' }
      }
      // A session of it the window closed may still be ending: a chat runs
      // one agent at a time, and the next starts once the last has ended.
      await deps.sessions.closeOf(chat.id)
      let prepared
      try {
        prepared = await deps.chats.prepareSession(chat.id)
      } catch (error) {
        return { ok: false, message: `Could not make the chat's folder: ${errorMessage(error)}` }
      }
      if (!prepared) return { ok: false, message: 'The chat no longer exists.' }
      try {
        const session = await deps.sessions.start(
          { ...request, projectRoot: prepared.folder },
          null,
          prepared.launch,
          preparedAgent(prepared),
        )
        // The chat was opened: it goes to the top of Chats.
        deps.chats.opened(chat.id)
        return { ok: true, session }
      } catch (error) {
        if (error instanceof SessionError) return { ok: false, message: error.message }
        throw error
      }
    }
    if (request.savedSessionId !== undefined && request.savedSessionId !== null) {
      const saved = deps.chats.get(request.savedSessionId)
      if (
        !saved ||
        saved.projectRoot === null ||
        saved.projectRoot !== request.projectRoot ||
        saved.worktreePath !== request.worktreePath ||
        saved.toolId !== request.toolId ||
        request.issueId !== null ||
        (request.chatId !== undefined && request.chatId !== null)
      ) {
        return { ok: false, message: 'Invalid session request.' }
      }
      if (!deps.projects.find(request.projectRoot)) {
        return { ok: false, message: 'The project is not in the list.' }
      }
      if (saved.worktreePath === null) {
        // One whose project folder is gone, as when it was renamed, stays but
        // does not start; Hoot says why, and starts it once it is back.
        const problem = await projectFolderProblem(saved.projectRoot)
        if (problem !== null) return { ok: false, message: problem }
      } else {
        // A session whose worktree is gone, or was deleted outside Hoot, stays
        // but does not start; Hoot says why.
        const worktree = await deps.worktrees.currentWorktree(saved.projectRoot, saved.worktreePath)
        if (!worktree) {
          return { ok: false, message: `The worktree no longer exists: ${saved.worktreePath}` }
        }
        if (worktree.missing) {
          return {
            ok: false,
            message: `The folder of the worktree is missing: ${saved.worktreePath}`,
          }
        }
      }
      // Once a session of it the window closed has ended, as for a chat.
      await deps.sessions.closeOf(saved.id)
      let prepared
      try {
        prepared = await deps.chats.prepareSession(saved.id)
      } catch (error) {
        return { ok: false, message: `Could not open the worktree: ${errorMessage(error)}` }
      }
      if (!prepared) return { ok: false, message: 'The saved session no longer exists.' }
      try {
        const session = await deps.sessions.start(
          request,
          null,
          prepared.launch,
          preparedAgent(prepared),
        )
        // Opening it again does not move its row: saved sessions stay in the
        // order they were made.
        deps.chats.opened(saved.id)
        return { ok: true, session }
      } catch (error) {
        if (error instanceof SessionError) return { ok: false, message: error.message }
        throw error
      }
    }
    const project = deps.projects.find(request.projectRoot)
    if (!project) {
      return { ok: false, message: 'The project is not in the list.' }
    }
    const agent = requestedAgent(request.toolId, request.agentId)
    if (agent === 'invalid') return { ok: false, message: 'The agent no longer exists.' }
    let saved: Issue | null = null
    if (request.issueId !== null) {
      // Only Claude Code is sent issues, in one of the project's worktrees.
      if (request.toolId !== 'claude' || request.worktreePath === null) {
        return { ok: false, message: 'Invalid session request.' }
      }
      const found = issueOfProject(deps.issues, project.id, request.issueId)
      if (!found.ok) return found
      saved = found.issue
    }
    let issue: SentIssue | null = null
    /** The step of the issue's workflow the session starts at. */
    let step: WorkflowStep | null = null
    if (request.worktreePath !== null) {
      // As it is now, which the sidebar then shows: it may be gone or missing since it last did.
      const worktree = await deps.worktrees.currentWorktree(
        request.projectRoot,
        request.worktreePath,
      )
      if (!worktree) {
        return { ok: false, message: `The worktree no longer exists: ${request.worktreePath}` }
      }
      if (worktree.missing) {
        return {
          ok: false,
          message: `The folder of the worktree is missing: ${request.worktreePath}`,
        }
      }
      if (saved !== null) {
        // The first message names the branch the worktree has checked out.
        if (worktree.branch === null) {
          return {
            ok: false,
            message: `The worktree has no branch checked out: ${request.worktreePath}`,
          }
        }
        // And, while the issues' workflow runs, the step of it the session
        // starts at: the one of the label the issue carries now.
        let workflowFile: string | null = null
        let first: SentIssue['firstMessage'] = plainFirstMessage
        if (deps.workflows !== null) {
          const start = deps.workflows.sessionStart(saved.id, issueIdentifier(saved.id))
          if (!start.ok) return start
          step = start.step
          workflowFile = start.workflowFile
          first = start.firstMessage
        }
        const { prompt } = request
        issue = {
          title: saved.title,
          description: saved.description,
          branch: worktree.branch,
          workflowFile,
          firstMessage: prompt === undefined ? first : () => prompt,
        }
      }
    }
    try {
      const session = await deps.sessions.start(request, issue, null, agent)
      // Work on the issue goes on in the session from now on.
      if (request.issueId !== null && step !== null) {
        deps.workflows?.sessionStarted(request.issueId, step, request.startedBy ?? 'user')
      }
      return { ok: true, session }
    } catch (error) {
      if (error instanceof SessionError) return { ok: false, message: error.message }
      throw error
    }
  })

  on(IpcChannel.answerSessionStart, (...args) => {
    const parsed = z.tuple([z.string().min(1).max(100), sessionStartAnswer]).safeParse(args)
    if (parsed.success) deps.sessionStarts.answer(...parsed.data)
  })

  handle(IpcChannel.closeSession, async (_event, value) => {
    const parsed = sessionId.safeParse(value)
    if (!parsed.success) return
    await deps.sessions.close(parsed.data)
  })

  on(IpcChannel.writeSession, (...args) => {
    const parsed = writeArguments.safeParse(args)
    if (parsed.success) {
      const [id, data, binary] = parsed.data
      deps.sessions.write(id, data, binary === true)
    }
  })

  on(IpcChannel.resizeSession, (...args) => {
    const parsed = resizeArguments.safeParse(args)
    if (parsed.success) deps.sessions.resize(...parsed.data)
  })

  deps.sessions.on('data', (id, data) => send(IpcChannel.sessionData, id, data))
  deps.sessions.on('updated', (session) => send(IpcChannel.sessionUpdated, session))
  // Sent as the session's output is, so that the window gets the two in the order they came.
  deps.sessions.on('hook-event', (id, report) => send(IpcChannel.sessionHookEvent, id, report))

  on(IpcChannel.quitResponse, (confirmed) => {
    void deps.quitGuard.answer(z.literal(true).safeParse(confirmed).success)
  })

  handle(IpcChannel.getAppInfo, () => deps.appInfo)
  handle(IpcChannel.getUpdateStatus, () => deps.updates.status)
  on(IpcChannel.checkForUpdates, () => {
    void deps.updates.check()
    // The window takes the look for begun; this tells it where things stand
    // also when none began, as while a version is downloading.
    send(IpcChannel.updateStatusChanged, deps.updates.status)
  })
  on(IpcChannel.installUpdate, () => void deps.updates.install())
  deps.updates.on('changed', (status) => send(IpcChannel.updateStatusChanged, status))
  deps.updates.on('failed', (message) => send(IpcChannel.updateFailed, message))

  handle(IpcChannel.listWorktrees, () => deps.worktrees.listAll())
  deps.worktrees.on('changed', (root, worktrees) =>
    send(IpcChannel.worktreesChanged, root, worktrees),
  )
  // Worktrees that were gone, cleaned up as the worktrees were read: their
  // saved sessions go with them, and one made again at a root of theirs is
  // expanded.
  deps.worktrees.on('removed', (root, worktreePaths) => {
    for (const worktreePath of worktreePaths) {
      deps.chats.removeForWorktree(worktreePath)
      deps.sidebar.setWorktreeCollapsed(worktreePath, false)
    }
    send(IpcChannel.worktreesRemoved, root, worktreePaths)
  })

  handle(IpcChannel.newWorktreeOptions, (_event, ...args): Promise<NewWorktreeOptionsResult> => {
    const parsed = newWorktreeOptionsArguments.safeParse(args)
    return parsed.success
      ? deps.worktrees.newWorktreeOptions(...parsed.data)
      : Promise.resolve({ ok: false, message: 'Invalid project.' })
  })

  handle(IpcChannel.worktreeSubmodules, (_event, ...args) => {
    const parsed = submoduleArguments.safeParse(args)
    return parsed.success ? deps.worktrees.submodules(...parsed.data) : []
  })

  handle(IpcChannel.createWorktree, async (_event, value): Promise<CreateWorktreeResult> => {
    const parsed = createWorktreeRequest.safeParse(value)
    if (!parsed.success) return { ok: false, reason: 'invalid', message: 'Invalid request.' }
    const request = parsed.data
    if (!deps.projects.find(request.projectRoot)) {
      return { ok: false, reason: 'invalid', message: 'The project is not in the list.' }
    }
    const agent = chatAgentOf(request.agentId)
    if (agent === null) {
      return { ok: false, reason: 'invalid', message: 'The agent no longer exists.' }
    }
    const created = await deps.worktrees.createNamed(request)
    if (!created.ok) return { ok: false, reason: created.reason, message: created.message }
    try {
      const session = deps.chats.createSavedSession(request.projectRoot, created.path, agent)
      return {
        ok: true,
        path: created.path,
        branch: created.branch,
        name: created.name,
        session,
        warning: created.warning,
      }
    } catch (error) {
      return { ok: false, reason: 'failed', message: errorMessage(error) }
    }
  })

  handle(
    IpcChannel.createIssueWorktree,
    async (_event, ...args): Promise<CreateIssueWorktreeResult> => {
      const parsed = z.tuple([projectRoot, rowId]).safeParse(args)
      if (!parsed.success) return { ok: false, reason: 'invalid', message: 'Invalid request.' }
      const [root, issueId] = parsed.data
      const project = deps.projects.find(root)
      if (!project) {
        return { ok: false, reason: 'invalid', message: 'The project is not in the list.' }
      }
      // Named after the issue as it is saved now.
      const found = issueOfProject(deps.issues, project.id, issueId)
      if (!found.ok) return { ok: false, reason: 'invalid', message: found.message }
      return deps.worktrees.createForIssue(root, found.issue)
    },
  )

  handle(IpcChannel.readWorktrees, (_event, value) => {
    const parsed = projectRoot.safeParse(value)
    return parsed.success ? deps.worktrees.read(parsed.data) : null
  })

  handle(IpcChannel.removeWorktree, async (_event, ...args): Promise<RemoveWorktreeResult> => {
    const parsed = worktreeArguments.safeParse(args)
    if (!parsed.success) return { ok: false, message: 'Invalid request.' }
    const [root, worktreePath] = parsed.data
    // Its open sessions close first; the window took them out as the user
    // confirmed.
    const result = await deps.worktrees.removeMissing(root, worktreePath, () =>
      deps.sessions.closeIn(root, worktreePath),
    )
    // Its saved sessions go with it. A worktree made again at its root is expanded.
    if (result.ok) {
      deps.sessions.forgetWorktree(worktreePath)
      deps.chats.removeForWorktree(worktreePath)
      deps.sidebar.setWorktreeCollapsed(worktreePath, false)
    }
    return result
  })

  handle(IpcChannel.startMerge, async (_event, ...args): Promise<StartMergeResult> => {
    const parsed = worktreeAgentArguments.safeParse(args)
    if (!parsed.success) return { ok: false, message: 'Invalid request.' }
    const [root, worktreePath, id] = parsed.data
    if (!deps.projects.find(root)) return { ok: false, message: 'The project is not in the list.' }
    const agent = chatAgentOf(id)
    if (agent === null) return { ok: false, message: 'The agent no longer exists.' }
    // Nothing stops the merge but a project folder or worktree that is gone:
    // what to do about anything else in the way is the agent's to judge.
    const planned = await deps.worktrees.planMerge(root, worktreePath)
    if (!planned.ok) return planned
    // A session in the project's own folder, named after the worktree, whose
    // agent is told what to merge as it first starts, and nothing of how.
    // Hoot follows the merge no further.
    const session = deps.chats.createSavedSession(root, null, agent, {
      name: `Merge ${planned.plan.worktreeName}`,
      firstMessage: mergeInstruction(planned.plan),
    })
    return { ok: true, session }
  })

  handle(IpcChannel.startDeletion, async (_event, ...args): Promise<StartDeletionResult> => {
    const parsed = worktreeAgentArguments.safeParse(args)
    if (!parsed.success) return { ok: false, message: 'Invalid request.' }
    const [root, worktreePath, id] = parsed.data
    if (!deps.projects.find(root)) return { ok: false, message: 'The project is not in the list.' }
    const agent = chatAgentOf(id)
    if (agent === null) return { ok: false, message: 'The agent no longer exists.' }
    // Nothing stops the deletion but a project folder or worktree that is
    // gone: what to do about anything else in the way is the agent's to judge.
    const planned = await deps.worktrees.planDeletion(root, worktreePath)
    if (!planned.ok) return planned
    // A session in the project's own folder, which the worktree's deletion
    // leaves, named after the worktree, whose agent is told what to delete as
    // it first starts, and nothing of how. Hoot follows the deletion no
    // further: the worktree's row goes once Git no longer lists it.
    const session = deps.chats.createSavedSession(root, null, agent, {
      name: `Delete ${planned.plan.worktreeName}`,
      firstMessage: deletionInstruction(planned.plan),
    })
    return { ok: true, session }
  })

  on(IpcChannel.revealWorktree, (...args) => {
    const parsed = worktreeArguments.safeParse(args)
    if (!parsed.success) return
    const [root, worktreePath] = parsed.data
    void deps.worktrees.isWorktreeOf(root, worktreePath).then((found) => {
      if (found) shell.showItemInFolder(worktreePath)
    })
  })

  on(IpcChannel.copyWorktreePath, (...args) => {
    const parsed = worktreeArguments.safeParse(args)
    if (!parsed.success) return
    const [root, worktreePath] = parsed.data
    void deps.worktrees.isWorktreeOf(root, worktreePath).then((found) => {
      if (found) clipboard.writeText(worktreePath)
    })
  })

  handle(IpcChannel.listProjectFolders, () => deps.projectFolders.list())
  deps.projectFolders.on('changed', (root, folder) =>
    send(IpcChannel.projectFolderChanged, root, folder),
  )

  on(IpcChannel.revealProjectFolder, (value) => {
    const parsed = projectRoot.safeParse(value)
    if (!parsed.success || !deps.projects.find(parsed.data)) return
    const root = parsed.data
    void deps.projectFolders.current(root).then((folder) => {
      if (folder?.missing === false) shell.showItemInFolder(root)
    })
  })

  on(IpcChannel.copyProjectFolderPath, (value) => {
    const parsed = projectRoot.safeParse(value)
    if (parsed.success && deps.projects.find(parsed.data)) clipboard.writeText(parsed.data)
  })

  // The file panel reads and writes only in the folder it shows: a project's
  // own folder, or one of the project's worktrees.
  const notShown = 'This folder is no longer in Hoot.'
  handle(IpcChannel.listFolder, async (_event, ...args): Promise<ListFolderResult> => {
    const parsed = z.tuple([...panelFolder, entryPath]).safeParse(args)
    if (!parsed.success) return { kind: 'error', message: 'Not a folder of the panel.' }
    const [root, worktreePath, directory] = parsed.data
    const folder = await deps.folderAccess.folder(root, worktreePath)
    return folder === null ? { kind: 'error', message: notShown } : listFolder(folder, directory)
  })
  handle(IpcChannel.readFile, async (_event, ...args): Promise<ReadFileResult> => {
    const parsed = z.tuple([...panelFolder, entryPath]).safeParse(args)
    if (!parsed.success) return { kind: 'error', message: 'Not a file of the panel.' }
    const [root, worktreePath, file] = parsed.data
    const folder = await deps.folderAccess.folder(root, worktreePath)
    return folder === null ? { kind: 'error', message: notShown } : readFile(folder, file)
  })
  handle(IpcChannel.writeFile, async (_event, ...args): Promise<WriteFileResult> => {
    const parsed = z
      .tuple([...panelFolder, entryPath, fileContent, fileVersion, z.boolean()])
      .safeParse(args)
    if (!parsed.success) return { kind: 'error', message: 'Not a file of the panel.' }
    const [root, worktreePath, file, content, expected, bom] = parsed.data
    const folder = await deps.folderAccess.folder(root, worktreePath)
    if (folder === null) return { kind: 'error', message: notShown }
    return writeTextFile(folder, file, content, expected, bom)
  })
  handle(IpcChannel.addFile, async (_event, ...args): Promise<AddFileResult> => {
    const parsed = z
      .tuple([...panelFolder, entryPath, z.string().max(1_024), addedFile, z.string().max(4_096)])
      .safeParse(args)
    if (!parsed.success) return { kind: 'error', message: 'Not a file of the panel.' }
    const [root, worktreePath, document, name, bytes, source] = parsed.data
    const folder = await deps.folderAccess.folder(root, worktreePath)
    if (folder === null) return { kind: 'error', message: notShown }
    return addFileNextTo(folder, document, name, bytes, source)
  })
  // Only the last request counts, also when the folder of an earlier one is
  // found out about after it.
  let watchRequests = 0
  on(IpcChannel.watchFiles, (...args) => {
    const parsed = z
      .tuple([z.string().min(1).nullable(), z.string().min(1).nullable(), z.array(entryPath)])
      .safeParse(args)
    if (!parsed.success) return
    const request = ++watchRequests
    const [root, worktreePath, entries] = parsed.data
    if (root === null) {
      deps.fileWatcher.watch(null, [])
      return
    }
    void deps.folderAccess.folder(root, worktreePath).then((folder) => {
      if (request === watchRequests) deps.fileWatcher.watch(folder, folder === null ? [] : entries)
    })
  })
  deps.fileWatcher.on('changed', (folder, entry) => send(IpcChannel.filesChanged, folder, entry))
  /** Where an entry of a file panel's folder is on disk, for the messages that take one. */
  const panelEntryLocation = async (args: unknown[]): Promise<string | null> => {
    const parsed = z.tuple([...panelFolder, entryPath]).safeParse(args)
    if (!parsed.success) return null
    const [root, worktreePath, entry] = parsed.data
    const folder = await deps.folderAccess.folder(root, worktreePath)
    return folder === null ? null : entryLocation(folder, entry)
  }
  on(IpcChannel.revealFile, (...args) => {
    void panelEntryLocation(args).then((location) => {
      if (location !== null) shell.showItemInFolder(location)
    })
  })
  on(IpcChannel.copyFilePath, (...args) => {
    void panelEntryLocation(args).then((location) => {
      if (location !== null) clipboard.writeText(location)
    })
  })

  const noIssue = 'The issue no longer exists.'

  handle(IpcChannel.listIssues, () => deps.issues.list())

  handle(IpcChannel.createIssue, (_event, value): IssueResult => {
    const parsed = newIssue.safeParse(value)
    if (!parsed.success) return { ok: false, message: 'Invalid issue.' }
    return changeIssue(() => deps.issues.create(parsed.data), 'The project is not in the list.')
  })

  handle(IpcChannel.updateIssue, (_event, ...args): IssueResult => {
    const parsed = z.tuple([rowId, issueChanges]).safeParse(args)
    if (!parsed.success) return { ok: false, message: 'Invalid issue.' }
    return changeIssue(() => deps.issues.update(...parsed.data), noIssue)
  })

  handle(IpcChannel.createSubIssue, (_event, ...args): IssueResult => {
    const parsed = z.tuple([rowId, newIssue]).safeParse(args)
    if (!parsed.success) return { ok: false, message: 'Invalid issue.' }
    const [parentId, issue] = parsed.data
    return changeIssue(() => deps.issues.create(issue, parentId), 'The project is not in the list.')
  })

  handle(IpcChannel.listSubIssues, () => deps.issues.subIssues())
  // Wherever the change came from: hoot in a session, or this window.
  deps.issues.on('sub-issues-changed', (subIssues) => send(IpcChannel.subIssuesChanged, subIssues))

  handle(IpcChannel.setIssueParents, (_event, value): SubIssueChangeResult => {
    const parsed = parentChanges.safeParse(value)
    if (!parsed.success) return { ok: false, message: 'Invalid change.' }
    try {
      deps.issues.setParents(parsed.data)
      return { ok: true }
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }
  })

  handle(IpcChannel.listDependencies, () => deps.issues.dependencies())
  // Wherever the change came from: hoot in a session, or this window.
  deps.issues.on('dependencies-changed', (dependencies) =>
    send(IpcChannel.dependenciesChanged, dependencies),
  )

  handle(IpcChannel.changeDependencies, (_event, value): DependencyChangeResult => {
    const parsed = dependencyChange.safeParse(value)
    if (!parsed.success) return { ok: false, message: 'Invalid change.' }
    try {
      deps.issues.changeRelations({
        removeDependencies: parsed.data.remove,
        addDependencies: parsed.data.add,
      })
      return { ok: true }
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }
  })

  handle(IpcChannel.createDependentIssue, (_event, ...args): IssueResult => {
    const parsed = z.tuple([newIssue, newIssueDependency]).safeParse(args)
    if (!parsed.success) return { ok: false, message: 'Invalid issue.' }
    const [issue, made] = parsed.data
    return changeIssue(
      () =>
        deps.issues.create(
          issue,
          null,
          'blocking' in made ? { blocking: [made.blocking] } : { blockedBy: [made.blockedBy] },
        ),
      'The project is not in the list.',
    )
  })

  handle(IpcChannel.deleteIssue, (_event, value) => {
    const parsed = rowId.safeParse(value)
    if (!parsed.success) return { ok: false, message: 'Invalid issue.' }
    try {
      return deps.issues.delete(parsed.data) ? { ok: true } : { ok: false, message: noIssue }
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }
  })

  // Issues Hoot completed once their sub-issues were.
  deps.workflows?.on('issues-completed', (issues) => send(IpcChannel.issuesChanged, issues))

  handle(IpcChannel.listLabels, () => deps.labels.snapshot())
  // Wherever the change came from: hoot in a session, or this window.
  deps.labels.on('changed', (labels) => send(IpcChannel.labelsChanged, labels))
  handle(IpcChannel.listLabelEvents, () => deps.labels.eventsOfShown())
  deps.labels.on('events-added', (events) => send(IpcChannel.labelEventsAdded, events))

  handle(IpcChannel.createLabel, (_event, value): CreateLabelResult => {
    const parsed = newLabelRequest.safeParse(value)
    if (!parsed.success) return { ok: false, message: 'Invalid label.' }
    const { issueId, ...label } = parsed.data
    try {
      const created = deps.labels.createLabel(
        label,
        issueId === undefined ? undefined : { issueId, actor: 'user' },
      )
      const { group: _group, ...saved } = created
      return { ok: true, label: saved }
    } catch (error) {
      if (error instanceof LabelError) return { ok: false, message: error.message }
      throw error
    }
  })

  handle(IpcChannel.editLabel, (_event, ...args): LabelChangeResult => {
    const parsed = z.tuple([rowId, labelChangeRequest]).safeParse(args)
    if (!parsed.success) return { ok: false, message: 'Invalid change.' }
    return changeLabels(() => deps.labels.editLabel(...parsed.data))
  })

  handle(IpcChannel.deleteLabel, (_event, value): LabelChangeResult => {
    const parsed = rowId.safeParse(value)
    if (!parsed.success) return { ok: false, message: 'Invalid label.' }
    return changeLabels(() => deps.labels.deleteLabel(parsed.data))
  })

  handle(IpcChannel.createLabelGroup, (_event, value): CreateLabelGroupResult => {
    const parsed = labelField.safeParse(value)
    if (!parsed.success) return { ok: false, message: 'Invalid group.' }
    try {
      return { ok: true, group: deps.labels.createGroup(parsed.data) }
    } catch (error) {
      if (error instanceof LabelError) return { ok: false, message: error.message }
      throw error
    }
  })

  handle(IpcChannel.deleteLabelGroup, (_event, value): LabelChangeResult => {
    const parsed = rowId.safeParse(value)
    if (!parsed.success) return { ok: false, message: 'Invalid group.' }
    return changeLabels(() => deps.labels.deleteGroup(parsed.data))
  })

  handle(IpcChannel.changeIssueLabels, (_event, ...args): LabelChangeResult => {
    const parsed = z.tuple([rowId, issueLabelsRequest]).safeParse(args)
    if (!parsed.success) return { ok: false, message: 'Invalid change.' }
    const [issueId, change] = parsed.data
    if (deps.issues.get(issueId) === null) return { ok: false, message: noIssue }
    return changeLabels(() => deps.labels.changeIssueLabels(issueId, change, 'user'))
  })

  on(IpcChannel.writeClipboardText, (value) => {
    const parsed = clipboardText.safeParse(value)
    if (!parsed.success) return
    clipboard.writeText(parsed.data).catch((error: unknown) => {
      console.error('Could not put text on the clipboard:', error)
    })
  })

  on(IpcChannel.openExternalLink, (value) => {
    const link = typeof value === 'string' ? browserLink(value) : null
    if (link === null) return
    shell.openExternal(link).catch((error: unknown) => {
      console.error(`Could not open ${link}:`, error)
    })
  })
}

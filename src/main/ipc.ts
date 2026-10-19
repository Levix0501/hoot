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
  type AddProjectResult,
  type CreateLabelGroupResult,
  type CreateLabelResult,
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
import { MAX_PROMPT_LENGTH } from '../shared/hoot-cli'
import { browserLink } from '../shared/links'
import type { ParentChange } from '../shared/sub-issues'
import { CODING_TOOL_IDS, TOOL_IDS } from '../shared/tools'
import type { WorkflowStep } from '../shared/workflows'
import type {
  CreateIssueWorktreeResult,
  CreateWorktreeRequest,
  DeleteWorktreeResult,
  NewWorktreeOptionsResult,
  RemoveWorktreeResult,
} from '../shared/worktrees'
import type { AgentService } from './agents/agent-service'
import { issueDescription, issuePriority, issueStatus, issueTitle } from './issues/issue-schemas'
import type { IssueStore } from './issues/issue-store'
import { LabelError, type LabelStore } from './labels/label-store'
import type { ProjectRootResult } from './projects/project-root'
import type { ProjectStore } from './projects/project-store'
import type { QuitGuard } from './quit-guard'
import type { SentIssue } from './session/launch'
import { SessionError, type SessionManager } from './session/session-manager'
import type { SessionStartRequests } from './session/session-starts'
import type { AppearanceStore } from './settings/appearance-store'
import type { PermissionLevelStore } from './settings/permission-level-store'
import type { SidebarStateStore } from './settings/sidebar-state-store'
import type { ToolService } from './tools/tool-service'
import type { UpdateService } from './updates/update-service'
import type { WorkflowExecutor } from './workflows/workflow-executor'
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
  permissionLevels: PermissionLevelStore
  sidebar: SidebarStateStore
  appearance: AppearanceStore
  sessions: SessionManager
  quitGuard: QuitGuard
  updates: UpdateService
  worktrees: WorktreeService
  workflows: WorkflowExecutor
  /** The sessions hoot asked for, which the window answers. */
  sessionStarts: SessionStartRequests
  resolveProjectRoot(directory: string): Promise<ProjectRootResult>
}

const sessionId = z.string().min(1).max(100)
const terminalDimension = z.number().int().positive().max(9_999)
const rowId = z.number().int().positive()
const startSessionRequest = z.object({
  id: sessionId,
  projectRoot: z.string().min(1),
  worktreePath: z.string().min(1).nullable(),
  toolId: z.enum(TOOL_IDS),
  issueId: rowId.nullable(),
  startedBy: z.enum(['user', 'agent']).optional(),
  prompt: z.string().max(MAX_PROMPT_LENGTH).optional(),
  permissionLevel: z.string().min(1).max(100).optional(),
  cols: terminalDimension,
  rows: terminalDimension,
}) satisfies z.ZodType<StartSessionRequest>
const projectRoot = z.string().min(1)
const worktreeArguments = z.tuple([projectRoot, z.string().min(1)])
const branchName = z.string().max(1_000)
const createWorktreeRequest = z.object({
  projectRoot,
  branch: branchName.min(1),
  base: z.string().min(1),
  nested: z
    .array(z.object({ relativePath: z.string().min(1), base: z.string().min(1) }))
    .max(1_000),
}) satisfies z.ZodType<CreateWorktreeRequest>
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
const agentId = z.enum(CODING_TOOL_IDS)
/**
 * Text put on the clipboard: what is selected in a session's terminal, up to
 * its whole scrollback, or what one of its programs puts there, which
 * xterm.js takes in sequences of at most 10 million characters; an issue's
 * identifier or title; what the About page tells of Hoot; or the line that
 * puts Hoot's folder of agents on PATH.
 */
const clipboardText = z.string().max(10_000_000)

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
}

export function registerIpc(deps: IpcDependencies): void {
  const { handle, on, send } = trustedIpc(deps.getWindow)

  handle(IpcChannel.getStartupState, (): StartupState => ({ kind: 'ready' }))

  handle(IpcChannel.listProjects, () => deps.projects.list())

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

    const resolved = await deps.resolveProjectRoot(directory)
    switch (resolved.kind) {
      case 'bare':
        return { kind: 'bare', path: directory }
      case 'unknown-main-worktree':
        return { kind: 'unknown-main-worktree', path: directory }
      case 'error':
        return { kind: 'error', message: resolved.message }
      case 'ok': {
        const { added, project } = deps.projects.add(resolved.root)
        if (!added) return { kind: 'duplicate', project }
        deps.worktrees.addProject(project.root)
        send(IpcChannel.projectsChanged, deps.projects.list())
        return { kind: 'added', project }
      }
    }
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
    // Its worktrees, their files and branches stay as they are.
    deps.worktrees.removeProject(root)
    // Removing a project closes its sessions, which have all ended.
    deps.sessions.forgetProject(root)
    send(IpcChannel.projectsChanged, deps.projects.list())
    return { ok: true }
  })

  handle(IpcChannel.getTools, () => deps.tools.settledState())
  handle(IpcChannel.redetectTools, () => deps.tools.detect())
  deps.tools.on('changed', (state) => send(IpcChannel.toolsChanged, state))

  handle(IpcChannel.getAgents, () => deps.agents.getState())
  on(IpcChannel.detectAgents, () => void deps.agents.detect())
  deps.agents.on('changed', (state) => send(IpcChannel.agentsChanged, state))
  on(IpcChannel.installAgent, (id) => {
    const parsed = agentId.safeParse(id)
    if (parsed.success) deps.agents.install(parsed.data)
  })
  on(IpcChannel.updateAgent, (id) => {
    const parsed = agentId.safeParse(id)
    if (parsed.success) deps.agents.update(parsed.data)
  })
  on(IpcChannel.cancelAgentOperation, (id) => {
    const parsed = agentId.safeParse(id)
    if (parsed.success) deps.agents.cancel(parsed.data)
  })

  handle(IpcChannel.getPermissionLevels, () => deps.permissionLevels.all())
  deps.permissionLevels.on('changed', (settings) =>
    send(IpcChannel.permissionLevelsChanged, settings),
  )

  handle(IpcChannel.getWindowState, (): WindowState => ({
    sidebarOpen: deps.sidebar.open,
    sidebarWidth: deps.sidebar.width,
    collapsedProjects: deps.sidebar.collapsedProjects,
    fullScreen: deps.getWindow()?.isFullScreen() ?? false,
  }))
  on(IpcChannel.setSidebarOpen, (open) => {
    const parsed = z.boolean().safeParse(open)
    if (parsed.success) deps.sidebar.setOpen(parsed.data)
  })
  on(IpcChannel.setSidebarWidth, (width) => {
    const parsed = z.number().safeParse(width)
    if (parsed.success) deps.sidebar.setWidth(parsed.data)
  })
  on(IpcChannel.setProjectExpanded, (...args) => {
    const parsed = z.tuple([rowId, z.boolean()]).safeParse(args)
    if (!parsed.success) return
    const [id, expanded] = parsed.data
    // Only a project in the list is kept collapsed.
    if (!expanded && !deps.projects.list().some((project) => project.id === id)) return
    deps.sidebar.setProjectCollapsed(id, !expanded)
  })

  handle(IpcChannel.getAppearance, () => deps.appearance.appearance)
  on(IpcChannel.setAppearance, (appearance) => {
    const parsed = z.enum(APPEARANCES).safeParse(appearance)
    if (parsed.success) deps.appearance.select(parsed.data)
  })
  deps.appearance.on('changed', (appearance) => send(IpcChannel.appearanceChanged, appearance))

  handle(IpcChannel.listSessions, () => deps.sessions.list())

  handle(IpcChannel.startSession, async (_event, value): Promise<StartSessionResult> => {
    const parsed = startSessionRequest.safeParse(value)
    if (!parsed.success) return { ok: false, message: 'Invalid session request.' }
    const request = parsed.data
    const project = deps.projects.find(request.projectRoot)
    if (!project) {
      return { ok: false, message: 'The project is not in the list.' }
    }
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
        // And the step of the issue's workflow the session starts at: the one
        // of the label it carries now.
        const start = deps.workflows.sessionStart(saved.id, issueIdentifier(saved.id))
        if (!start.ok) return start
        step = start.step
        const { prompt } = request
        issue = {
          title: saved.title,
          description: saved.description,
          branch: worktree.branch,
          workflowFile: start.workflowFile,
          firstMessage: prompt === undefined ? start.firstMessage : () => prompt,
        }
      }
    }
    try {
      const session = await deps.sessions.start(request, issue)
      // Work on the issue goes on in the session from now on.
      if (request.issueId !== null && step !== null) {
        deps.workflows.sessionStarted(request.issueId, step, request.startedBy ?? 'user')
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
  handle(IpcChannel.currentWorktree, (_event, ...args) => {
    const parsed = worktreeArguments.safeParse(args)
    return parsed.success ? deps.worktrees.currentWorktree(...parsed.data) : null
  })
  deps.worktrees.on('changed', (root, worktrees) =>
    send(IpcChannel.worktreesChanged, root, worktrees),
  )

  handle(IpcChannel.newWorktreeOptions, (_event, value): Promise<NewWorktreeOptionsResult> => {
    const parsed = projectRoot.safeParse(value)
    return parsed.success
      ? deps.worktrees.newWorktreeOptions(parsed.data)
      : Promise.resolve({ ok: false, message: 'Invalid project.' })
  })

  handle(IpcChannel.checkBranchName, (_event, value) => {
    const parsed = branchName.safeParse(value)
    return parsed.success ? deps.worktrees.isValidBranchName(parsed.data) : false
  })

  handle(IpcChannel.previewWorktreePath, (_event, ...args) => {
    const parsed = z.tuple([projectRoot, branchName]).safeParse(args)
    return parsed.success ? deps.worktrees.previewPath(...parsed.data) : null
  })

  handle(IpcChannel.worktreeSubmodules, (_event, ...args) => {
    const parsed = submoduleArguments.safeParse(args)
    return parsed.success ? deps.worktrees.submodules(...parsed.data) : []
  })

  handle(IpcChannel.createWorktree, (_event, value) => {
    const parsed = createWorktreeRequest.safeParse(value)
    if (!parsed.success) return { ok: false, reason: 'invalid', message: 'Invalid request.' }
    return deps.worktrees.create(parsed.data)
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

  handle(IpcChannel.inspectWorktree, (_event, ...args) => {
    const parsed = worktreeArguments.safeParse(args)
    if (!parsed.success) return { ok: false, message: 'Invalid request.' }
    return deps.worktrees.inspect(...parsed.data)
  })

  handle(IpcChannel.deleteWorktree, async (_event, ...args): Promise<DeleteWorktreeResult> => {
    const parsed = z.tuple([projectRoot, z.string().min(1), z.boolean()]).safeParse(args)
    if (!parsed.success) return { ok: false, reason: 'not-found', message: 'Invalid request.' }
    const [root, worktreePath, discard] = parsed.data
    // Also a session in a project's worktree inside it, which deleting it would delete.
    const running = () => deps.sessions.isRunningWithin(worktreePath)
    if (running()) {
      return {
        ok: false,
        reason: 'running',
        message: 'End the running sessions in this worktree before deleting it.',
      }
    }
    const result = await deps.worktrees.delete(root, worktreePath, discard, running)
    // Its sessions, which have all ended, close with it.
    if (result.ok) deps.sessions.forgetWorktree(worktreePath)
    return result
  })

  handle(IpcChannel.removeWorktree, async (_event, ...args): Promise<RemoveWorktreeResult> => {
    const parsed = worktreeArguments.safeParse(args)
    if (!parsed.success) return { ok: false, message: 'Invalid request.' }
    const result = await deps.worktrees.removeMissing(...parsed.data)
    if (result.ok) deps.sessions.forgetWorktree(parsed.data[1])
    return result
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
  deps.workflows.on('issues-completed', (issues) => send(IpcChannel.issuesChanged, issues))

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

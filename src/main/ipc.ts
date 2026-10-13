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
import { APPEARANCES } from '../shared/appearance'
import {
  IpcChannel,
  type AddProjectResult,
  type StartSessionRequest,
  type StartSessionResult,
  type StartupState,
  type WindowState,
} from '../shared/ipc'
import {
  ISSUE_TITLE_MAX_LENGTH,
  type Issue,
  type IssueChanges,
  type IssueResult,
  type NewIssue,
} from '../shared/issues'
import { browserLink } from '../shared/links'
import { TOOL_IDS } from '../shared/tools'
import type {
  CreateWorktreeRequest,
  DeleteWorktreeResult,
  RemoveWorktreeResult,
} from '../shared/worktrees'
import { issueDescription, issuePriority, issueStatus, issueTitle } from './issues/issue-schemas'
import type { IssueStore } from './issues/issue-store'
import type { ProjectRootResult } from './projects/project-root'
import type { ProjectStore } from './projects/project-store'
import type { QuitGuard } from './quit-guard'
import type { SentIssue } from './session/launch'
import { SessionError, type SessionManager } from './session/session-manager'
import type { AppearanceStore } from './settings/appearance-store'
import type { PermissionLevelStore } from './settings/permission-level-store'
import type { SidebarStateStore } from './settings/sidebar-state-store'
import type { ToolService } from './tools/tool-service'
import type { WorktreeService } from './worktrees/worktree-service'

export interface IpcDependencies {
  getWindow(): BrowserWindow | null
  projects: ProjectStore
  issues: IssueStore
  tools: ToolService
  permissionLevels: PermissionLevelStore
  sidebar: SidebarStateStore
  appearance: AppearanceStore
  sessions: SessionManager
  quitGuard: QuitGuard
  worktrees: WorktreeService
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
const issueChanges = z.strictObject({
  title: issueTitle.optional(),
  description: issueDescription.optional(),
  status: issueStatus.optional(),
  priority: issuePriority.optional(),
  projectId: rowId.nullable().optional(),
}) satisfies z.ZodType<IssueChanges>
/** The longest text put on the clipboard, which only ever gets an issue's identifier or title. */
const clipboardText = z.string().max(ISSUE_TITLE_MAX_LENGTH)

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

/**
 * What a session started from an issue's page sends Claude Code: the issue's
 * title and description as they are saved now. Or why it cannot be sent: the
 * issue is gone, or belongs to another project or to none.
 */
function issueToSend(
  issues: IssueStore,
  projectId: number,
  issueId: number,
): { ok: true; issue: SentIssue } | { ok: false; message: string } {
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
  return { ok: true, issue: { title: issue.title, description: issue.description } }
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
 * learns why, and can show the file in Finder or quit.
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
      case 'not-git':
        return { kind: 'not-git', path: directory }
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

  handle(IpcChannel.getPermissionLevels, () => deps.permissionLevels.all())
  deps.permissionLevels.on('changed', (settings) =>
    send(IpcChannel.permissionLevelsChanged, settings),
  )

  handle(IpcChannel.getWindowState, (): WindowState => ({
    sidebarOpen: deps.sidebar.open,
    collapsedProjects: deps.sidebar.collapsedProjects,
    fullScreen: deps.getWindow()?.isFullScreen() ?? false,
  }))
  on(IpcChannel.setSidebarOpen, (open) => {
    const parsed = z.boolean().safeParse(open)
    if (parsed.success) deps.sidebar.setOpen(parsed.data)
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
    let issue: SentIssue | null = null
    if (request.issueId !== null) {
      // Only Claude Code is sent issues, in the project's main worktree.
      if (request.toolId !== 'claude' || request.worktreePath !== null) {
        return { ok: false, message: 'Invalid session request.' }
      }
      const sent = issueToSend(deps.issues, project.id, request.issueId)
      if (!sent.ok) return sent
      issue = sent.issue
    }
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
    }
    try {
      return { ok: true, session: await deps.sessions.start(request, issue) }
    } catch (error) {
      if (error instanceof SessionError) return { ok: false, message: error.message }
      throw error
    }
  })

  handle(IpcChannel.closeSession, async (_event, value) => {
    const parsed = sessionId.safeParse(value)
    if (parsed.success) await deps.sessions.close(parsed.data)
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

  handle(IpcChannel.listWorktrees, () => deps.worktrees.listAll())
  handle(IpcChannel.currentWorktree, (_event, ...args) => {
    const parsed = worktreeArguments.safeParse(args)
    return parsed.success ? deps.worktrees.currentWorktree(...parsed.data) : null
  })
  deps.worktrees.on('changed', (root, worktrees) =>
    send(IpcChannel.worktreesChanged, root, worktrees),
  )

  handle(IpcChannel.newWorktreeOptions, (_event, value) => {
    const parsed = projectRoot.safeParse(value)
    return parsed.success ? deps.worktrees.newWorktreeOptions(parsed.data) : null
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

  handle(IpcChannel.deleteIssue, (_event, value) => {
    const parsed = rowId.safeParse(value)
    if (!parsed.success) return { ok: false, message: 'Invalid issue.' }
    try {
      return deps.issues.delete(parsed.data) ? { ok: true } : { ok: false, message: noIssue }
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }
  })

  on(IpcChannel.writeClipboardText, (value) => {
    const parsed = clipboardText.safeParse(value)
    if (parsed.success) clipboard.writeText(parsed.data)
  })

  on(IpcChannel.openExternalLink, (value) => {
    const link = typeof value === 'string' ? browserLink(value) : null
    if (link === null) return
    shell.openExternal(link).catch((error: unknown) => {
      console.error(`Could not open ${link}:`, error)
    })
  })
}

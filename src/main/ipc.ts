import { z } from 'zod'
import {
  dialog,
  ipcMain,
  type BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron'
import {
  IpcChannel,
  type AddProjectResult,
  type StartSessionRequest,
  type StartSessionResult,
  type WindowState,
} from '../shared/ipc'
import { TOOL_IDS } from '../shared/tools'
import type { ProjectRootResult } from './projects/project-root'
import type { ProjectStore } from './projects/project-store'
import type { QuitGuard } from './quit-guard'
import { SessionError, type SessionManager } from './session/session-manager'
import type { PermissionLevelStore } from './settings/permission-level-store'
import type { SidebarStateStore } from './settings/sidebar-state-store'
import type { ToolService } from './tools/tool-service'

export interface IpcDependencies {
  getWindow(): BrowserWindow | null
  projects: ProjectStore
  tools: ToolService
  permissionLevels: PermissionLevelStore
  sidebar: SidebarStateStore
  sessions: SessionManager
  quitGuard: QuitGuard
  resolveProjectRoot(directory: string): Promise<ProjectRootResult>
}

const sessionId = z.string().min(1).max(100)
const terminalDimension = z.number().int().positive().max(9_999)
const startSessionRequest = z.object({
  id: sessionId,
  projectRoot: z.string().min(1),
  toolId: z.enum(TOOL_IDS),
  cols: terminalDimension,
  rows: terminalDimension,
}) satisfies z.ZodType<StartSessionRequest>
const projectRoot = z.string().min(1)
const writeArguments = z.tuple([sessionId, z.string(), z.boolean().optional()])
const resizeArguments = z.tuple([sessionId, terminalDimension, terminalDimension])

export function registerIpc(deps: IpcDependencies): void {
  const trusted = (event: IpcMainInvokeEvent | IpcMainEvent) => {
    const window = deps.getWindow()
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
    const window = deps.getWindow()
    if (window && !window.isDestroyed()) window.webContents.send(channel, ...args)
  }

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
        send(IpcChannel.projectsChanged, deps.projects.list())
        return { kind: 'added', project }
      }
    }
  })

  handle(IpcChannel.removeProject, (_event, value) => {
    const parsed = projectRoot.safeParse(value)
    if (!parsed.success) return { ok: false, message: 'Invalid project.' }
    const root = parsed.data
    if (deps.sessions.isRunningIn(root)) {
      return {
        ok: false,
        message: 'Close the running sessions of this project before removing it.',
      }
    }
    deps.projects.remove(root)
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
    fullScreen: deps.getWindow()?.isFullScreen() ?? false,
  }))
  on(IpcChannel.setSidebarOpen, (open) => {
    const parsed = z.boolean().safeParse(open)
    if (parsed.success) deps.sidebar.setOpen(parsed.data)
  })

  handle(IpcChannel.listSessions, () => deps.sessions.list())

  handle(IpcChannel.startSession, async (_event, value): Promise<StartSessionResult> => {
    const parsed = startSessionRequest.safeParse(value)
    if (!parsed.success) return { ok: false, message: 'Invalid session request.' }
    const request = parsed.data
    if (!deps.projects.find(request.projectRoot)) {
      return { ok: false, message: 'The project is not in the list.' }
    }
    try {
      return { ok: true, session: await deps.sessions.start(request) }
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
}

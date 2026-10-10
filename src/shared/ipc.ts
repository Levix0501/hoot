import type { PermissionLevelSettings } from './permission-levels'
import type { SessionInfo } from './session'
import type { ToolId } from './tools'
import type {
  CreateWorktreeRequest,
  CreateWorktreeResult,
  DeleteWorktreeResult,
  InspectWorktreeResult,
  NewWorktreeOptions,
  RemoveWorktreeResult,
  WorktreeInfo,
} from './worktrees'

export interface Project {
  /** Canonical path of the main worktree's top-level directory. */
  root: string
  /** Display name, the last path segment of `root`. */
  name: string
}

export type AddProjectResult =
  | { kind: 'added'; project: Project }
  | { kind: 'duplicate'; project: Project }
  | { kind: 'cancelled' }
  | { kind: 'not-git'; path: string }
  | { kind: 'bare'; path: string }
  | { kind: 'unknown-main-worktree'; path: string }
  | { kind: 'error'; message: string }

export interface ToolAvailability {
  id: ToolId
  available: boolean
  /** Absolute path of the command found in the login shell PATH. */
  path: string | null
}

export interface ToolsState {
  detecting: boolean
  tools: ToolAvailability[]
  /** Set when the login shell environment could not be read. */
  error: string | null
}

export interface StartSessionRequest {
  id: string
  projectRoot: string
  /** The root of one of the project's worktrees to run in, or `null` for the main worktree. */
  worktreePath: string | null
  toolId: ToolId
  cols: number
  rows: number
}

export type StartSessionResult = { ok: true; session: SessionInfo } | { ok: false; message: string }

export interface WindowState {
  /** Whether the sidebar is expanded, as it was when Hoot last showed or hid it. */
  sidebarOpen: boolean
  /** Whether the window is in full screen, where macOS hides the traffic lights. */
  fullScreen: boolean
}

export const IpcChannel = {
  listProjects: 'projects:list',
  addProject: 'projects:add',
  removeProject: 'projects:remove',
  projectsChanged: 'projects:changed',
  addProjectRequested: 'projects:add-requested',
  getTools: 'tools:get',
  redetectTools: 'tools:redetect',
  toolsChanged: 'tools:changed',
  getPermissionLevels: 'permission-levels:get',
  permissionLevelsChanged: 'permission-levels:changed',
  listSessions: 'session:list',
  startSession: 'session:start',
  closeSession: 'session:close',
  writeSession: 'session:write',
  resizeSession: 'session:resize',
  sessionData: 'session:data',
  sessionUpdated: 'session:updated',
  sessionCommand: 'session:command',
  getWindowState: 'window:get-state',
  setSidebarOpen: 'window:set-sidebar-open',
  toggleSidebarRequested: 'window:toggle-sidebar-requested',
  fullScreenChanged: 'window:full-screen-changed',
  confirmQuit: 'app:confirm-quit',
  quitResponse: 'app:quit-response',
  listWorktrees: 'worktrees:list',
  worktreesChanged: 'worktrees:changed',
  newWorktreeOptions: 'worktrees:new-options',
  checkBranchName: 'worktrees:check-branch-name',
  previewWorktreePath: 'worktrees:preview-path',
  worktreeSubmodules: 'worktrees:submodules',
  createWorktree: 'worktrees:create',
  inspectWorktree: 'worktrees:inspect',
  deleteWorktree: 'worktrees:delete',
  removeWorktree: 'worktrees:remove',
  revealWorktree: 'worktrees:reveal',
  copyWorktreePath: 'worktrees:copy-path',
} as const

/**
 * A session command chosen in the application menu. `back` and `forward` show
 * the session shown before or after the current one.
 */
export type SessionCommand =
  | 'close-current'
  | 'select-next'
  | 'select-previous'
  | 'back'
  | 'forward'

/** API exposed to the renderer by the preload script as `window.hoot`. */
export interface HootApi {
  testHooks: boolean
  listProjects(): Promise<Project[]>
  addProject(): Promise<AddProjectResult>
  removeProject(root: string): Promise<{ ok: boolean; message?: string }>
  onProjectsChanged(listener: (projects: Project[]) => void): () => void
  /** The application menu asked to add a project. */
  onAddProjectRequested(listener: () => void): () => void
  getTools(): Promise<ToolsState>
  redetectTools(): Promise<ToolsState>
  onToolsChanged(listener: (state: ToolsState) => void): () => void
  /** The permission level selected for each coding tool in the Agents menu. */
  getPermissionLevels(): Promise<PermissionLevelSettings>
  onPermissionLevelsChanged(listener: (settings: PermissionLevelSettings) => void): () => void
  /** The sessions that have started, oldest first. */
  listSessions(): Promise<SessionInfo[]>
  startSession(request: StartSessionRequest): Promise<StartSessionResult>
  /** Ends the session's process if it still runs, then forgets the session. */
  closeSession(id: string): Promise<void>
  writeSession(id: string, data: string, binary?: boolean): void
  resizeSession(id: string, cols: number, rows: number): void
  onSessionData(listener: (id: string, data: string) => void): () => void
  onSessionUpdated(listener: (session: SessionInfo) => void): () => void
  /** The application menu chose a session command. */
  onSessionCommand(listener: (command: SessionCommand) => void): () => void
  getWindowState(): Promise<WindowState>
  /** Saves whether the sidebar is expanded, so that Hoot opens with it as it was left. */
  setSidebarOpen(open: boolean): void
  /** The application menu asked to show or hide the sidebar. */
  onToggleSidebarRequested(listener: () => void): () => void
  onFullScreenChanged(listener: (fullScreen: boolean) => void): () => void
  /** Quitting needs confirmation because `runningSessions` sessions are running. */
  onConfirmQuit(listener: (runningSessions: number) => void): () => void
  respondToQuit(confirmed: boolean): void
  /** The worktrees of every project in the list, by project root. */
  listWorktrees(): Promise<Record<string, WorktreeInfo[]>>
  onWorktreesChanged(listener: (projectRoot: string, worktrees: WorktreeInfo[]) => void): () => void
  /** What the new worktree dialog offers; `null` when the project is not in the list. */
  getNewWorktreeOptions(projectRoot: string): Promise<NewWorktreeOptions | null>
  /** Whether Git accepts the name as a new branch's name. */
  checkBranchName(name: string): Promise<boolean>
  /** Where a new worktree of the branch would be created, also with `~` for the home directory. */
  previewWorktreePath(
    projectRoot: string,
    branch: string,
  ): Promise<{ path: string; displayPath: string } | null>
  /** The submodules in the base branches' commits of the repositories that would take part. */
  getWorktreeSubmodules(
    projectRoot: string,
    participants: Array<{ relativePath: string; base: string }>,
  ): Promise<string[]>
  createWorktree(request: CreateWorktreeRequest): Promise<CreateWorktreeResult>
  /** Checks what deleting a worktree would delete and lose. */
  inspectWorktree(projectRoot: string, worktreePath: string): Promise<InspectWorktreeResult>
  /** Deletes a worktree; with `discard` false, only one with nothing to lose. */
  deleteWorktree(
    projectRoot: string,
    worktreePath: string,
    discard: boolean,
  ): Promise<DeleteWorktreeResult>
  /** Removes the registrations of a worktree whose folder is missing. */
  removeWorktree(projectRoot: string, worktreePath: string): Promise<RemoveWorktreeResult>
  revealWorktree(projectRoot: string, worktreePath: string): void
  copyWorktreePath(projectRoot: string, worktreePath: string): void
}

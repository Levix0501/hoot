import type { PermissionLevelSettings } from './permission-levels'
import type { SessionInfo } from './session'
import type { ToolId } from './tools'

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
  toolId: ToolId
  cols: number
  rows: number
}

export type StartSessionResult = { ok: true; session: SessionInfo } | { ok: false; message: string }

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
  confirmQuit: 'app:confirm-quit',
  quitResponse: 'app:quit-response',
} as const

/** A session command chosen in the application menu. */
export type SessionCommand = 'close-current' | 'select-next' | 'select-previous'

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
  /** Quitting needs confirmation because `runningSessions` sessions are running. */
  onConfirmQuit(listener: (runningSessions: number) => void): () => void
  respondToQuit(confirmed: boolean): void
}

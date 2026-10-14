import type { AgentOperationSummary, AgentsState } from './agents'
import type { AppInfo } from './app-info'
import type { Appearance } from './appearance'
import type { Issue, IssueChanges, IssueResult, NewIssue } from './issues'
import type { PermissionLevelSettings } from './permission-levels'
import type { QuitReason, SessionInfo } from './session'
import type { CodingToolId, ToolId } from './tools'
import type { UpdateStatus } from './updates'
import type { WindowControls } from './window-controls'
import type {
  CreateIssueWorktreeResult,
  CreateWorktreeRequest,
  CreateWorktreeResult,
  DeleteWorktreeResult,
  InspectWorktreeResult,
  NewWorktreeOptionsResult,
  RemoveWorktreeResult,
  WorktreeInfo,
} from './worktrees'

export interface Project {
  /** Stays the same when the project is removed from the list and added again. */
  id: number
  /**
   * Canonical path of the project's folder: the top-level directory of a Git
   * repository's main worktree, or a folder outside Git.
   */
  root: string
  /** Display name, the last path segment of `root`. */
  name: string
}

export type AddProjectResult =
  | { kind: 'added'; project: Project }
  | { kind: 'duplicate'; project: Project }
  | { kind: 'cancelled' }
  | { kind: 'bare'; path: string }
  | { kind: 'unknown-main-worktree'; path: string }
  | { kind: 'error'; message: string }

export interface ToolAvailability {
  id: ToolId
  available: boolean
  /**
   * Absolute path of the command found in the login shell PATH or, for a
   * coding tool on macOS, else in Hoot's folder of agents.
   */
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
  /**
   * The issue whose start button started the session, a Claude Code session
   * in one of the project's worktrees, which is sent the issue; `null` for
   * every other session.
   */
  issueId: number | null
  /**
   * The id of the permission level the tool starts at, as it was picked when
   * the session was asked for; without it, the level picked when the session
   * starts.
   */
  permissionLevel?: string
  cols: number
  rows: number
}

export type StartSessionResult = { ok: true; session: SessionInfo } | { ok: false; message: string }

export interface WindowState {
  /** Whether the sidebar is expanded, as it was when Hoot last showed or hid it. */
  sidebarOpen: boolean
  /** The sidebar's width in CSS pixels, as it was last resized. */
  sidebarWidth: number
  /** The ids of the projects collapsed in the sidebar, as they were left; the others are expanded. */
  collapsedProjects: number[]
  /** Whether the window is in full screen, where macOS hides the traffic lights. */
  fullScreen: boolean
}

/**
 * Whether Hoot could open its database when it started. Without it, the
 * window only says why and where the database is.
 */
export type StartupState =
  | { kind: 'ready' }
  | {
      kind: 'database-error'
      /** What went wrong, as SQLite or the file system said. */
      message: string
      /** The database file's full path. */
      path: string
    }

export const IpcChannel = {
  getStartupState: 'app:get-startup-state',
  getAppInfo: 'app:get-info',
  revealDatabase: 'app:reveal-database',
  quit: 'app:quit',
  listProjects: 'projects:list',
  addProject: 'projects:add',
  removeProject: 'projects:remove',
  projectsChanged: 'projects:changed',
  addProjectRequested: 'projects:add-requested',
  getTools: 'tools:get',
  redetectTools: 'tools:redetect',
  toolsChanged: 'tools:changed',
  getAgents: 'agents:get',
  detectAgents: 'agents:detect',
  agentsChanged: 'agents:changed',
  installAgent: 'agents:install',
  updateAgent: 'agents:update',
  cancelAgentOperation: 'agents:cancel',
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
  setSidebarWidth: 'window:set-sidebar-width',
  setProjectExpanded: 'window:set-project-expanded',
  toggleSidebarRequested: 'window:toggle-sidebar-requested',
  fullScreenChanged: 'window:full-screen-changed',
  showSettingsRequested: 'settings:show-requested',
  showAboutRequested: 'settings:show-about-requested',
  getAppearance: 'appearance:get',
  setAppearance: 'appearance:set',
  appearanceChanged: 'appearance:changed',
  confirmQuit: 'app:confirm-quit',
  quitResponse: 'app:quit-response',
  getUpdateStatus: 'updates:get-status',
  updateStatusChanged: 'updates:status-changed',
  checkForUpdates: 'updates:check',
  installUpdate: 'updates:install',
  updateFailed: 'updates:failed',
  listWorktrees: 'worktrees:list',
  currentWorktree: 'worktrees:current',
  worktreesChanged: 'worktrees:changed',
  newWorktreeOptions: 'worktrees:new-options',
  checkBranchName: 'worktrees:check-branch-name',
  previewWorktreePath: 'worktrees:preview-path',
  worktreeSubmodules: 'worktrees:submodules',
  createWorktree: 'worktrees:create',
  createIssueWorktree: 'worktrees:create-for-issue',
  readWorktrees: 'worktrees:read',
  inspectWorktree: 'worktrees:inspect',
  deleteWorktree: 'worktrees:delete',
  removeWorktree: 'worktrees:remove',
  revealWorktree: 'worktrees:reveal',
  copyWorktreePath: 'worktrees:copy-path',
  listIssues: 'issues:list',
  createIssue: 'issues:create',
  updateIssue: 'issues:update',
  deleteIssue: 'issues:delete',
  issueCreated: 'issues:created',
  writeClipboardText: 'clipboard:write-text',
  openExternalLink: 'links:open-external',
} as const

/**
 * A session command chosen in the application menu. `back` and `forward` show
 * the page shown before or after the current one: a session, an Issues page or
 * the settings.
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
  /** The window's own buttons, and the room the page leaves for them in its top row. */
  windowControls: WindowControls
  /** The app that shows files and folders: Finder, or File Explorer on Windows. */
  fileManager: string
  /**
   * Whether Hoot manages agents here: shows the Agents page in the settings,
   * and sends to it from the new session menu. On macOS only.
   */
  manageAgents: boolean
  getStartupState(): Promise<StartupState>
  /** What the About page tells of Hoot and of what it runs on. */
  getAppInfo(): Promise<AppInfo>
  /**
   * Shows the database file, or the nearest folder of it there is, in Finder
   * (File Explorer on Windows).
   */
  revealDatabase(): void
  quit(): void
  listProjects(): Promise<Project[]>
  addProject(): Promise<AddProjectResult>
  removeProject(root: string): Promise<{ ok: boolean; message?: string }>
  onProjectsChanged(listener: (projects: Project[]) => void): () => void
  /** The application menu asked to add a project. */
  onAddProjectRequested(listener: () => void): () => void
  getTools(): Promise<ToolsState>
  redetectTools(): Promise<ToolsState>
  onToolsChanged(listener: (state: ToolsState) => void): () => void
  /** The agents of the Agents page, as last read, with their operations. */
  getAgents(): Promise<AgentsState>
  /**
   * Reads the login shell environment again, looks for every agent's
   * installation and version, and reads every agent's latest version.
   */
  detectAgents(): void
  onAgentsChanged(listener: (state: AgentsState) => void): () => void
  /** Installs an agent, now or after the operations before it. */
  installAgent(id: CodingToolId): void
  /** Updates an agent's installation, now or after the operations before it. */
  updateAgent(id: CodingToolId): void
  /** Cancels an agent's operation, waiting or running. */
  cancelAgentOperation(id: CodingToolId): void
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
  /** Saves the sidebar's width, so that Hoot opens with it as wide as it was left. */
  setSidebarWidth(width: number): void
  /** Saves whether a project is expanded in the sidebar, so that Hoot opens with it as it was left. */
  setProjectExpanded(projectId: number, expanded: boolean): void
  /** The application menu asked to show or hide the sidebar. */
  onToggleSidebarRequested(listener: () => void): () => void
  onFullScreenChanged(listener: (fullScreen: boolean) => void): () => void
  /** The application menu asked to show the settings. */
  onShowSettingsRequested(listener: () => void): () => void
  /** The application menu asked to show the settings' About page. */
  onShowAboutRequested(listener: () => void): () => void
  /** The appearance picked in the settings, which Hoot shows in. */
  getAppearance(): Promise<Appearance>
  /** Picks an appearance, which applies at once and is saved for the next start. */
  setAppearance(appearance: Appearance): void
  onAppearanceChanged(listener: (appearance: Appearance) => void): () => void
  /**
   * Quitting, or restarting into an update, needs confirmation because
   * `runningSessions` sessions are running, or agents are being installed or
   * updated, or waiting to be.
   */
  onConfirmQuit(
    listener: (
      runningSessions: number,
      reason: QuitReason,
      agentOperations: AgentOperationSummary[],
    ) => void,
  ): () => void
  respondToQuit(confirmed: boolean): void
  /** Where Hoot is with a newer version of itself, and how its latest look for one went. */
  getUpdateStatus(): Promise<UpdateStatus>
  onUpdateStatusChanged(listener: (status: UpdateStatus) => void): () => void
  /**
   * Looks for a newer version of Hoot, unless one is being downloaded or
   * installed; a look already in progress serves instead. `onUpdateStatusChanged`
   * says how it goes.
   */
  checkForUpdates(): void
  /** Downloads the newer version, unless it is downloaded already, then restarts Hoot into it. */
  installUpdate(): void
  /** Downloading or installing the newer version failed, for this reason. */
  onUpdateFailed(listener: (message: string) => void): () => void
  /** The worktrees of every project in the list, by project root. */
  listWorktrees(): Promise<Record<string, WorktreeInfo[]>>
  /**
   * Reads a project's worktrees again, which `onWorktreesChanged` then
   * reports, and returns the worktree at a root as it is now, or `null` when
   * there is none.
   */
  currentWorktree(projectRoot: string, worktreePath: string): Promise<WorktreeInfo | null>
  onWorktreesChanged(listener: (projectRoot: string, worktrees: WorktreeInfo[]) => void): () => void
  /**
   * What the new worktree dialog offers, or why it offers nothing: the project
   * is not in the list, or not a Git repository.
   */
  getNewWorktreeOptions(projectRoot: string): Promise<NewWorktreeOptionsResult>
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
  /**
   * Creates the worktree of an issue of the project, as its start button
   * does: a new branch named after the issue, from the branch checked out in
   * the main worktree, with the inner repositories the new worktree dialog
   * includes by default.
   */
  createIssueWorktree(projectRoot: string, issueId: number): Promise<CreateIssueWorktreeResult>
  /**
   * Reads a project's worktrees again, which `onWorktreesChanged` then
   * reports, and returns them; `null` when the project is not in the list.
   */
  readWorktrees(projectRoot: string): Promise<WorktreeInfo[] | null>
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
  /**
   * The issues without a project and those of the projects in the list, in
   * the order they were created.
   */
  listIssues(): Promise<Issue[]>
  createIssue(issue: NewIssue): Promise<IssueResult>
  /** Changes what `changes` gives of an issue, leaving the rest as it is. */
  updateIssue(id: number, changes: IssueChanges): Promise<IssueResult>
  /** Deletes an issue for good. */
  deleteIssue(id: number): Promise<{ ok: boolean; message?: string }>
  /** An issue was created other than from the window: by hoot, in a session. */
  onIssueCreated(listener: (issue: Issue) => void): () => void
  /**
   * Puts text on the clipboard. Through the main process, which can write it
   * while the window does not have the focus.
   */
  writeClipboardText(text: string): void
  /** Opens an http or https address in the default browser; other addresses are ignored. */
  openExternalLink(url: string): void
}

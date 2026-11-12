import type { AgentOperationSummary, AgentsState } from './agents'
import type { AppInfo } from './app-info'
import type { Appearance } from './appearance'
import type { ChatInfo, SavedSessionInfo } from './chats'
import type { Dependencies, Dependency } from './dependencies'
import type { DroppedPathQuoting } from './dropped-path-quoting'
import type { FilePanelLayout } from './file-panel'
import type {
  AddFileResult,
  FileVersion,
  ListFolderResult,
  PanelFolder,
  ReadFileResult,
  WriteFileResult,
} from './files'
import type { HookEventReport } from './hoot-cli'
import type { Issue, IssueChanges, IssueResult, NewIssue } from './issues'
import type { Label, LabelActor, LabelEvent, LabelGroup, Labels } from './labels'
import type { AgentLaunchSettingsChange, LaunchSettings } from './launch-settings'
import type { ProjectFolderInfo } from './project-folders'
import type { QuitReason, SessionInfo } from './session'
import type { SidebarGroupId } from './sidebar-groups'
import type { ParentChange, SubIssues } from './sub-issues'
import type { CodingToolId, ToolId } from './tools'
import type { UpdateStatus } from './updates'
import type { WindowControls } from './window-controls'
import type { WindowsPty } from './windows-pty'
import type {
  CreateIssueWorktreeResult,
  CreateWorktreeRequest,
  CreateWorktreeResult,
  NewWorktreeOptionsResult,
  RemoveWorktreeResult,
  StartDeletionResult,
  StartMergeResult,
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
  | {
      /**
       * The folder is in no Git repository: with the user's confirmation,
       * Hoot runs `git init` there and commits its files, then adds it.
       */
      kind: 'needs-init'
      folder: string
      /** How many files the first commit would hold. */
      fileCount: number
      /** The folder has a `.gitignore`, which leaves files out of the commit. */
      hasGitignore: boolean
    }
  | {
      /** The folder's Git repository has no commit yet: Hoot would make its first commit, then add it. */
      kind: 'needs-first-commit'
      folder: string
      fileCount: number
      hasGitignore: boolean
    }

/** A folder the user confirmed Hoot may initialize or commit, and how. */
export interface AddProjectConfirmation {
  folder: string
  mode: 'init' | 'first-commit'
}

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
  /** The project's root, or for a chat the folder its agent runs in. */
  projectRoot: string
  /**
   * The root of one of the project's worktrees to run in, or `null` for the
   * main worktree, the project's own folder.
   */
  worktreePath: string | null
  /**
   * The chat whose agent the session runs, which has no project and runs in
   * the chat's folder; `null` or left out for a session of a project.
   */
  chatId?: string | null
  /**
   * The saved session whose agent the session runs, in the worktree the
   * request names, or with none, in the project's own folder; `null` or left
   * out for every other session.
   */
  savedSessionId?: string | null
  toolId: ToolId
  /**
   * The issue the session is started from, a Claude Code session in one of
   * the project's worktrees, which is sent the issue; `null` for every other
   * session.
   */
  issueId: number | null
  /**
   * Who opened a session started from an issue: the user, with its start
   * button or Start new session, or an agent, with `hoot session start`.
   * The user when it is left out.
   */
  startedBy?: LabelActor
  /**
   * The first message of a session started from an issue, given by
   * `hoot session start --prompt-file`, instead of the one of the issue's
   * workflow.
   */
  prompt?: string
  cols: number
  rows: number
}

export type StartSessionResult = { ok: true; session: SessionInfo } | { ok: false; message: string }

/** A chat Hoot made, or why it could not. */
export type CreateChatResult = { ok: true; chat: ChatInfo } | { ok: false; message: string }

/** A saved session Hoot made, or why it could not. */
export type CreateSavedSessionResult =
  | { ok: true; session: SavedSessionInfo }
  | { ok: false; message: string }

/** Whether a chat or saved session was deleted, or why not. */
export type DeleteChatResult = { ok: true } | { ok: false; message: string }

/** Whether the parents of issues were changed, or why not. */
export type SubIssueChangeResult = { ok: true } | { ok: false; message: string }

/** Whether dependencies were made or removed, or why not. */
export type DependencyChangeResult = { ok: true } | { ok: false; message: string }

/**
 * The dependency a new issue is created with: the issue it blocks, which is
 * then blocked by it, or the issue it is blocked by.
 */
export type NewIssueDependency = { blocking: number } | { blockedBy: number }

/** Whether labels or groups were created, changed or deleted, or given to an issue, or why not. */
export type LabelChangeResult = { ok: true } | { ok: false; message: string }

/** A label created, or why none was. */
export type CreateLabelResult = { ok: true; label: Label } | { ok: false; message: string }

/** A group created, or why none was. */
export type CreateLabelGroupResult =
  | { ok: true; group: LabelGroup }
  | { ok: false; message: string }

/** A label to create, from the window: its name as entered, color, description and group. */
export interface NewLabelRequest {
  name: string
  color: string
  description: string
  groupId: number | null
  /** An issue to give the new label to, as the label picker of an issue's page does. */
  issueId?: number
}

/** What changes about a label, from the window; what is left out stays as it is. */
export interface LabelChangeRequest {
  name?: string
  color?: string
  description?: string
  groupId?: number | null
}

/** Labels to give an issue, in order, and labels to take off it, by id. */
export interface IssueLabelsRequest {
  add: number[]
  remove: number[]
}

/**
 * That hoot asked for a session for an issue, with `hoot session start`:
 * the window starts it as the issue's start button does, without showing
 * it, and answers with `answerSessionStart` under the request's id.
 */
export interface SessionStartRequest {
  requestId: string
  issueId: number
  /** The first message, instead of the one of the issue's workflow; `null` for that one. */
  prompt: string | null
}

/** How a session asked for by hoot started: the worktree it runs in, or why it did not start. */
export type SessionStartAnswer = { ok: true; worktreePath: string } | { ok: false; message: string }

export interface WindowState {
  /** Whether the sidebar is expanded, as it was when Hoot last showed or hid it. */
  sidebarOpen: boolean
  /** The sidebar's width in CSS pixels, as it was last resized. */
  sidebarWidth: number
  /** The groups collapsed in the sidebar, as they were left; the others are expanded. */
  collapsedGroups: SidebarGroupId[]
  /** The ids of the projects collapsed in the sidebar, as they were left; the others are expanded. */
  collapsedProjects: number[]
  /** The roots of the worktrees collapsed in the sidebar, as they were left; the others are expanded. */
  collapsedWorktrees: string[]
  /**
   * The roots of the projects whose Local row is collapsed in the sidebar, as
   * they were left; the others are expanded.
   */
  collapsedLocal: string[]
  /** Whether the file panel is shown and how wide its parts are, as they were left. */
  filePanel: FilePanelLayout
  /** Whether the window is in full screen, where macOS hides the traffic lights. */
  fullScreen: boolean
  /** Whether the window is the system's active window. */
  focused: boolean
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
  addProjectConfirmed: 'projects:add-confirmed',
  removeProject: 'projects:remove',
  projectsChanged: 'projects:changed',
  addProjectRequested: 'projects:add-requested',
  getTools: 'tools:get',
  toolsChanged: 'tools:changed',
  getAgents: 'agents:get',
  enterAgentsPage: 'agents:enter-page',
  detectAgents: 'agents:detect',
  agentsChanged: 'agents:changed',
  installAgent: 'agents:install',
  updateAgent: 'agents:update',
  updateAllAgents: 'agents:update-all',
  cancelAgentOperation: 'agents:cancel',
  getLaunchSettings: 'launch-settings:get',
  setDefaultAgent: 'launch-settings:set-default-agent',
  setYoloMode: 'launch-settings:set-yolo-mode',
  setConfirmClose: 'launch-settings:set-confirm-close',
  setAgentLaunchSettings: 'launch-settings:set-agent',
  launchSettingsChanged: 'launch-settings:changed',
  listSessions: 'session:list',
  startSession: 'session:start',
  closeSession: 'session:close',
  writeSession: 'session:write',
  resizeSession: 'session:resize',
  sessionData: 'session:data',
  sessionUpdated: 'session:updated',
  sessionHookEvent: 'session:hook-event',
  sessionCommand: 'session:command',
  listChats: 'chats:list',
  createChat: 'chats:create',
  renameChat: 'chats:rename',
  setChatTitle: 'chats:set-title',
  deleteChat: 'chats:delete',
  chatsChanged: 'chats:changed',
  listSavedSessions: 'saved-sessions:list',
  createSavedSession: 'saved-sessions:create',
  renameSavedSession: 'saved-sessions:rename',
  setSavedSessionTitle: 'saved-sessions:set-title',
  deleteSavedSession: 'saved-sessions:delete',
  savedSessionsChanged: 'saved-sessions:changed',
  getWindowState: 'window:get-state',
  setSidebarOpen: 'window:set-sidebar-open',
  setSidebarWidth: 'window:set-sidebar-width',
  setGroupExpanded: 'window:set-group-expanded',
  setProjectExpanded: 'window:set-project-expanded',
  setWorktreeExpanded: 'window:set-worktree-expanded',
  setLocalExpanded: 'window:set-local-expanded',
  toggleSidebarRequested: 'window:toggle-sidebar-requested',
  setFilePanelOpen: 'window:set-file-panel-open',
  setFileTreeWidth: 'window:set-file-tree-width',
  setFileEditorWidth: 'window:set-file-editor-width',
  toggleFilePanelRequested: 'window:toggle-file-panel-requested',
  fullScreenChanged: 'window:full-screen-changed',
  windowFocusChanged: 'window:focus-changed',
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
  worktreesChanged: 'worktrees:changed',
  worktreesRemoved: 'worktrees:removed',
  newWorktreeOptions: 'worktrees:new-options',
  worktreeSubmodules: 'worktrees:submodules',
  createWorktree: 'worktrees:create',
  createIssueWorktree: 'worktrees:create-for-issue',
  readWorktrees: 'worktrees:read',
  removeWorktree: 'worktrees:remove',
  startMerge: 'worktrees:start-merge',
  startDeletion: 'worktrees:start-deletion',
  revealWorktree: 'worktrees:reveal',
  copyWorktreePath: 'worktrees:copy-path',
  listProjectFolders: 'project-folders:list',
  projectFolderChanged: 'project-folders:changed',
  revealProjectFolder: 'project-folders:reveal',
  copyProjectFolderPath: 'project-folders:copy-path',
  listFolder: 'files:list-folder',
  readFile: 'files:read',
  writeFile: 'files:write',
  addFile: 'files:add',
  watchFiles: 'files:watch',
  filesChanged: 'files:changed',
  revealFile: 'files:reveal',
  copyFilePath: 'files:copy-path',
  listIssues: 'issues:list',
  createIssue: 'issues:create',
  updateIssue: 'issues:update',
  deleteIssue: 'issues:delete',
  issueCreated: 'issues:created',
  createSubIssue: 'issues:create-sub-issue',
  listSubIssues: 'issues:list-sub-issues',
  setIssueParents: 'issues:set-parents',
  subIssuesChanged: 'issues:sub-issues-changed',
  listDependencies: 'issues:list-dependencies',
  changeDependencies: 'issues:change-dependencies',
  createDependentIssue: 'issues:create-dependent',
  dependenciesChanged: 'issues:dependencies-changed',
  issuesChanged: 'issues:changed',
  changeIssueLabels: 'issues:change-labels',
  listLabels: 'labels:list',
  labelsChanged: 'labels:changed',
  listLabelEvents: 'labels:list-events',
  labelEventsAdded: 'labels:events-added',
  createLabel: 'labels:create',
  editLabel: 'labels:edit',
  deleteLabel: 'labels:delete',
  createLabelGroup: 'labels:create-group',
  deleteLabelGroup: 'labels:delete-group',
  sessionStartRequested: 'session:start-requested',
  answerSessionStart: 'session:answer-start',
  writeClipboardText: 'clipboard:write-text',
  openExternalLink: 'links:open-external',
} as const

/**
 * A session command chosen in the application menu. `back` and `forward` show
 * the page shown before or after the current one: a session, an Issues page or
 * the settings.
 */
export type SessionCommand =
  | 'new-chat'
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
  /**
   * Whether the keys of Windows terminals copy and paste in a session's
   * terminal, Ctrl+C and Ctrl+V among them: on Windows. On macOS ⌘C and ⌘V
   * do, through the Edit menu.
   */
  windowsClipboardKeys: boolean
  /** The app that shows files and folders: Finder, or File Explorer on Windows. */
  fileManager: string
  /**
   * Whether Hoot manages agents here: shows the Agents page in the settings,
   * and sends to it from the new session menu. On macOS and Windows.
   */
  manageAgents: boolean
  /**
   * The pseudo terminal sessions run in on Windows, which their terminals
   * are set up for; none elsewhere.
   */
  windowsPty: WindowsPty | undefined
  /**
   * How a session's terminal quotes the paths of the files and folders
   * dropped on it: as Windows Terminal does on Windows, as a POSIX shell
   * does elsewhere.
   */
  droppedPathQuoting: DroppedPathQuoting
  /**
   * The path of a file or folder dropped on the window from Finder (File
   * Explorer on Windows) or another app; empty for a file that is not on disk.
   */
  pathForFile(file: File): string
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
  /** Asks for a folder to add; one that needs a first commit says so, with what it would hold. */
  addProject(): Promise<AddProjectResult>
  /** Adds a folder the user confirmed Hoot may initialize, or make its first commit in. */
  addProjectConfirmed(confirmation: AddProjectConfirmation): Promise<AddProjectResult>
  removeProject(root: string): Promise<{ ok: boolean; message?: string }>
  onProjectsChanged(listener: (projects: Project[]) => void): () => void
  /** The application menu asked to add a project. */
  onAddProjectRequested(listener: () => void): () => void
  getTools(): Promise<ToolsState>
  onToolsChanged(listener: (state: ToolsState) => void): () => void
  /** The agents of the Agents page, as last read, with their operations. */
  getAgents(): Promise<AgentsState>
  /**
   * The Agents page was opened: detects if it is the first time since Hoot
   * started, or the last detection started 20 hours ago or more.
   */
  enterAgentsPage(): void
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
  /** Updates every agent that can be updated, one after another. */
  updateAllAgents(): void
  /** Cancels an agent's operation while it waits; one that runs goes on to its end. */
  cancelAgentOperation(id: CodingToolId): void
  /**
   * The default agent, the YOLO mode switch, whether closing a running
   * session asks first, and each agent's launch settings.
   */
  getLaunchSettings(): Promise<LaunchSettings>
  /** Makes an agent the default agent. */
  setDefaultAgent(id: CodingToolId): void
  /** Turns YOLO mode on or off for the sessions that start from now on. */
  setYoloMode(on: boolean): void
  /** Turns on or off asking before a running session is closed. */
  setConfirmClose(on: boolean): void
  /** Changes an agent's launch settings for the sessions that start from now on. */
  setAgentLaunchSettings(id: CodingToolId, change: AgentLaunchSettingsChange): void
  onLaunchSettingsChanged(listener: (settings: LaunchSettings) => void): () => void
  /** The sessions that have started, oldest first. */
  listSessions(): Promise<SessionInfo[]>
  startSession(request: StartSessionRequest): Promise<StartSessionResult>
  /** Ends the session's process if it still runs, then forgets the session. */
  closeSession(id: string): Promise<void>
  writeSession(id: string, data: string, binary?: boolean): void
  resizeSession(id: string, cols: number, rows: number): void
  onSessionData(listener: (id: string, data: string) => void): () => void
  onSessionUpdated(listener: (session: SessionInfo) => void): () => void
  /**
   * A running Claude Code session's hook reported an event, which comes in
   * order with the session's output, as `onSessionData` gives it.
   */
  onSessionHookEvent(listener: (id: string, report: HookEventReport) => void): () => void
  /** The application menu chose a session command. */
  onSessionCommand(listener: (command: SessionCommand) => void): () => void
  /** Every chat, in the order of the sidebar's Chats group. */
  listChats(): Promise<ChatInfo[]>
  /** Makes a chat of an agent, in a new folder of its own, and says which. */
  createChat(toolId: CodingToolId): Promise<CreateChatResult>
  /** Gives a chat another name; an empty name gives it its default name again. */
  renameChat(id: string, name: string): void
  /** Notes the terminal title the chat's agent set, which names the chat. */
  setChatTitle(id: string, title: string): void
  /**
   * Deletes a chat for good, once its agent has ended: its folder goes to the
   * Trash unless another chat runs in it. Settles once it is deleted.
   */
  deleteChat(id: string): Promise<DeleteChatResult>
  /**
   * The chats changed: one was made, opened, renamed, removed or deleted, or
   * went on in another conversation.
   */
  onChatsChanged(listener: (chats: ChatInfo[]) => void): () => void
  /**
   * Every saved session, oldest first, as they show below their worktrees and
   * their projects' Local rows.
   */
  listSavedSessions(): Promise<SavedSessionInfo[]>
  /**
   * Makes a saved session of an agent in a worktree of a project, or with
   * `null` for the worktree, in the project's own folder.
   */
  createSavedSession(
    projectRoot: string,
    worktreePath: string | null,
    toolId: CodingToolId,
  ): Promise<CreateSavedSessionResult>
  /** Gives a saved session another name; an empty name gives it its default name again. */
  renameSavedSession(id: string, name: string): void
  /** Notes the terminal title the saved session's agent set, which names the session. */
  setSavedSessionTitle(id: string, title: string): void
  /** Deletes a saved session for good, once its agent has ended; settles once it is deleted. */
  deleteSavedSession(id: string): Promise<DeleteChatResult>
  /**
   * The saved sessions changed: one was made, renamed, removed or deleted, or
   * went on in another conversation.
   */
  onSavedSessionsChanged(listener: (sessions: SavedSessionInfo[]) => void): () => void
  getWindowState(): Promise<WindowState>
  /** Saves whether the sidebar is expanded, so that Hoot opens with it as it was left. */
  setSidebarOpen(open: boolean): void
  /** Saves the sidebar's width, so that Hoot opens with it as wide as it was left. */
  setSidebarWidth(width: number): void
  /** Saves whether a group is expanded in the sidebar, so that Hoot opens with it as it was left. */
  setGroupExpanded(group: SidebarGroupId, expanded: boolean): void
  /** Saves whether a project is expanded in the sidebar, so that Hoot opens with it as it was left. */
  setProjectExpanded(projectId: number, expanded: boolean): void
  /** Saves whether a worktree is expanded in the sidebar, so that Hoot opens with it as it was left. */
  setWorktreeExpanded(projectRoot: string, worktreePath: string, expanded: boolean): void
  /**
   * Saves whether a project's Local row is expanded in the sidebar, so that
   * Hoot opens with it as it was left.
   */
  setLocalExpanded(projectRoot: string, expanded: boolean): void
  /** The application menu asked to show or hide the sidebar. */
  onToggleSidebarRequested(listener: () => void): () => void
  /** Saves whether the file panel is shown, so that Hoot opens with it as it was left. */
  setFilePanelOpen(open: boolean): void
  /** Saves the width of the file panel's tree, so that Hoot opens with it as wide as it was left. */
  setFileTreeWidth(width: number): void
  /** Saves the width of the file panel's open files, so that Hoot opens with them as wide as they were left. */
  setFileEditorWidth(width: number): void
  /** The application menu asked to show or hide the file panel. */
  onToggleFilePanelRequested(listener: () => void): () => void
  onFullScreenChanged(listener: (fullScreen: boolean) => void): () => void
  /** The window became the system's active window, or stopped being it. */
  onWindowFocusChanged(listener: (focused: boolean) => void): () => void
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
  onWorktreesChanged(listener: (projectRoot: string, worktrees: WorktreeInfo[]) => void): () => void
  /**
   * Worktrees of a project that were gone were cleaned up, as their worktrees
   * were read; Hoot no longer keeps anything of them. Sent before
   * `onWorktreesChanged` reports the worktrees without them.
   */
  onWorktreesRemoved(listener: (projectRoot: string, worktreePaths: string[]) => void): () => void
  /**
   * What the new worktree dialog offers, or why it offers nothing: the project
   * is not in the list, or not a Git repository. For a new worktree made
   * `from` one of the project's worktrees, by its root, also the branch each
   * of that worktree's members has checked out, or nothing once it is gone.
   */
  getNewWorktreeOptions(projectRoot: string, from?: string): Promise<NewWorktreeOptionsResult>
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
  /**
   * Removes a worktree whose folder is missing, or that Git no longer lists:
   * its registrations, and what Hoot keeps of it, such as its saved sessions.
   */
  removeWorktree(projectRoot: string, worktreePath: string): Promise<RemoveWorktreeResult>
  /**
   * Makes the saved session in the project's own folder that has an agent
   * merge a worktree into it, named after the worktree, which is sent what
   * to merge when it first starts and judges the rest itself. Nothing is
   * checked first; only a project folder or worktree that is gone stops it.
   */
  startMerge(
    projectRoot: string,
    worktreePath: string,
    toolId: CodingToolId,
  ): Promise<StartMergeResult>
  /**
   * Makes the saved session in the project's own folder that has an agent
   * delete a worktree and its branch, named after the worktree, which is
   * sent what to delete when it first starts and judges the rest itself.
   * Nothing is checked first; only a project folder or worktree that is
   * gone stops it.
   */
  startDeletion(
    projectRoot: string,
    worktreePath: string,
    toolId: CodingToolId,
  ): Promise<StartDeletionResult>
  revealWorktree(projectRoot: string, worktreePath: string): void
  copyWorktreePath(projectRoot: string, worktreePath: string): void
  /**
   * The own folder of every project in the list, by project root, once Hoot
   * has looked at it: whether it is there, and what is checked out in it.
   */
  listProjectFolders(): Promise<Record<string, ProjectFolderInfo>>
  /**
   * A project's own folder changed: it went or came back, or another branch
   * or commit was checked out in it, however that was done.
   */
  onProjectFolderChanged(
    listener: (projectRoot: string, folder: ProjectFolderInfo) => void,
  ): () => void
  /** Shows a project's own folder in Finder (File Explorer on Windows). */
  revealProjectFolder(projectRoot: string): void
  /** Puts the path of a project's own folder on the clipboard. */
  copyProjectFolderPath(projectRoot: string): void
  /**
   * The entries of a folder in a file panel's folder, by its path from that
   * folder (`''` for the folder itself, else ending with `/`); see
   * `src/shared/files.ts`.
   */
  listFolder(folder: PanelFolder, directory: string): Promise<ListFolderResult>
  /** Reads a file of a file panel's folder as text. */
  readFile(folder: PanelFolder, file: string): Promise<ReadFileResult>
  /**
   * Writes a file of a file panel's folder, unless it changed since it was at
   * `expected`; with a byte order mark before `content` when `bom`.
   */
  writeFile(
    folder: PanelFolder,
    file: string,
    content: string,
    expected: FileVersion,
    bom: boolean,
  ): Promise<WriteFileResult>
  /**
   * Puts a file pasted or dropped into the document `document` of a file
   * panel's folder next to it, under `name` or a numbered name no other file
   * there has; a dropped file already in the folder, at `source` (`''` when
   * it is not on disk), stays where it is. Resolves with the file's path.
   */
  addFileNextTo(
    folder: PanelFolder,
    document: string,
    name: string,
    bytes: Uint8Array,
    source: string,
  ): Promise<AddFileResult>
  /**
   * Follows `entries` of a file panel's folder, its open files and expanded
   * folders, in place of what was followed before; nothing for `null`.
   */
  watchFiles(folder: PanelFolder | null, entries: string[]): void
  /** An entry followed with `watchFiles` changed, appeared or went away; `folder` is its root. */
  onFilesChanged(listener: (folder: string, entry: string) => void): () => void
  /** Shows an entry of a file panel's folder in Finder (File Explorer on Windows). */
  revealFile(folder: PanelFolder, entry: string): void
  /** Puts the full path of an entry of a file panel's folder on the clipboard. */
  copyFilePath(folder: PanelFolder, entry: string): void
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
  /** Creates an issue as the last sub-issue of a parent. */
  createSubIssue(parentId: number, issue: NewIssue): Promise<IssueResult>
  /** The parent of every issue that has one, those of removed projects included. */
  listSubIssues(): Promise<SubIssues>
  /** Gives issues other parents, or none, all together or, when one cannot be given, not at all. */
  setIssueParents(changes: ParentChange[]): Promise<SubIssueChangeResult>
  /**
   * The parents of issues changed, from the window or from hoot, or an issue
   * with a parent or sub-issues was deleted; these are all of them now.
   */
  onSubIssuesChanged(listener: (subIssues: SubIssues) => void): () => void
  /** Every dependency, those of the issues of removed projects included. */
  listDependencies(): Promise<Dependencies>
  /**
   * Removes dependencies and makes others, all together or, when one cannot
   * be, not at all.
   */
  changeDependencies(change: {
    add: Dependency[]
    remove: Dependency[]
  }): Promise<DependencyChangeResult>
  /** Creates an issue with a dependency on another, or neither when the dependency cannot be made. */
  createDependentIssue(issue: NewIssue, dependency: NewIssueDependency): Promise<IssueResult>
  /**
   * The dependencies changed, from the window or from hoot, or an issue with
   * some was deleted; these are all of them now.
   */
  onDependenciesChanged(listener: (dependencies: Dependencies) => void): () => void
  /**
   * Issues changed other than from the window, as when Hoot completed them
   * once their sub-issues were completed; these are them as they are now.
   */
  onIssuesChanged(listener: (issues: Issue[]) => void): () => void
  /** Every label and group, and the labels of every issue, those of removed projects included. */
  listLabels(): Promise<Labels>
  /** The labels changed, from the window or from hoot; these are all of them now. */
  onLabelsChanged(listener: (labels: Labels) => void): () => void
  /** The activity of the labels of the issues Hoot shows, in the order it happened. */
  listLabelEvents(): Promise<LabelEvent[]>
  /** Issues were given labels or had labels taken off: these entries of their activity are new. */
  onLabelEventsAdded(listener: (events: LabelEvent[]) => void): () => void
  /** Creates a label, and gives it to the issue the request names, if any. */
  createLabel(label: NewLabelRequest): Promise<CreateLabelResult>
  /** Changes a label's name, color, description or group. */
  editLabel(id: number, changes: LabelChangeRequest): Promise<LabelChangeResult>
  /** Deletes a label, which every issue carrying it no longer does. */
  deleteLabel(id: number): Promise<LabelChangeResult>
  createLabelGroup(name: string): Promise<CreateLabelGroupResult>
  /** Deletes a group; its labels stay, without a group. */
  deleteLabelGroup(id: number): Promise<LabelChangeResult>
  /** Gives an issue labels and takes others off it, as the user does. */
  changeIssueLabels(issueId: number, change: IssueLabelsRequest): Promise<LabelChangeResult>
  /** hoot asked for a session for an issue, which the window starts without showing it. */
  onSessionStartRequested(listener: (request: SessionStartRequest) => void): () => void
  /** Says how a session that hoot asked for started. */
  answerSessionStart(requestId: string, answer: SessionStartAnswer): void
  /**
   * Puts text on the clipboard. Through the main process, which can write it
   * while the window does not have the focus.
   */
  writeClipboardText(text: string): void
  /** Opens an http or https address in the default browser; other addresses are ignored. */
  openExternalLink(url: string): void
}

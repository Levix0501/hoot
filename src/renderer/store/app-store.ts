import { createElement, type ReactNode } from 'react'
import { toast } from 'sonner'
import { create } from 'zustand'
import { type AgentOperationSummary, type AgentsState } from '../../shared/agents'
import type { AppInfo } from '../../shared/app-info'
import { DEFAULT_APPEARANCE, type Appearance } from '../../shared/appearance'
import { ISSUE_WORKFLOW } from '../../shared/built-in-workflow'
import { chatAgent, type ChatInfo } from '../../shared/chats'
import {
  blockedByIdsOf,
  blockingIdsOf,
  waitCounts,
  waitedOnIds,
  type Dependencies,
  type Dependency,
  type WaitCounts,
} from '../../shared/dependencies'
import type {
  LabelChangeRequest,
  NewLabelRequest,
  Project,
  SessionCommand,
  SessionStartAnswer,
  ToolsState,
} from '../../shared/ipc'
import { issueWorktree } from '../../shared/issue-worktrees'
import {
  isCompleted,
  isIssueOpen,
  issueIdentifier,
  issueTitle,
  statusOnceStarted,
  type Issue,
  type IssueChanges,
  type IssuePriority,
  type IssueStatus,
  type IssueView,
} from '../../shared/issues'
import {
  labelsOfIssue,
  type LabelActor,
  type LabelEvent,
  type Labels,
  type NamedLabel,
} from '../../shared/labels'
import {
  withAgentLaunchSettingsChange,
  withDefaultAgent,
  withYoloMode,
  type AgentLaunchSettingsChange,
  type LaunchSettings,
} from '../../shared/launch-settings'
import {
  isNormalExit,
  type QuitReason,
  type SessionExit,
  type SessionInfo,
} from '../../shared/session'
import { SIDEBAR_WIDTH, sidebarWidthWithin } from '../../shared/sidebar-width'
import { startBlockers, startBlockerText, type StartBlocker } from '../../shared/start-blockers'
import { parentOf, subIssueIdsOf, type ParentChange, type SubIssues } from '../../shared/sub-issues'
import { getTool, type CodingToolId, type ToolId } from '../../shared/tools'
import type { UpdateCheck, UpdateState } from '../../shared/updates'
import { workflowProgress, type WorkflowProgress } from '../../shared/workflows'
import type {
  CreateIssueWorktreeResult,
  WorktreeInfo,
  WorktreeInspection,
} from '../../shared/worktrees'
import { afterHookEvent, afterTitle, type Attention, type Failure } from '../lib/session-state'
import { api } from '../lib/api'
import { isOnList, type ProjectChoice } from '../lib/project-choices'
import type { SessionShortcut } from '../lib/session-shortcuts'
import {
  createSessionTerminal,
  setTerminalColorScheme,
  setTerminalInputEnabled,
  systemColorScheme,
  type SessionTerminal,
} from '../terminal/session-terminal'
import {
  canStep,
  currentEntry,
  emptyHistory,
  forget,
  issueListPage,
  issuePage,
  isSettingsPage,
  samePage,
  sessionPage,
  settingsPage,
  step,
  visit,
  type Page,
  type PageHistory,
} from './page-history'
import {
  currentAfterClosing,
  orderedChatSessions,
  relativeSession,
  sidebarOrder,
} from './session-order'
import { worktreeRows, type WorktreeRow } from './worktree-rows'

/** The pages of the settings: Agents where Hoot manages them, Appearance, Labels, and About. */
export type SettingsSection = 'agents' | 'appearance' | 'labels' | 'about'

/**
 * How the issue list's Label filter matches the labels checked in it: issues
 * with any of them, or with all of them.
 */
export type LabelMatch = 'any' | 'all'

/** A session as the window shows it. */
export interface UiSession {
  id: string
  projectRoot: string
  /** The root of the worktree it runs in, or `null` for the project's main worktree. */
  worktreePath: string | null
  /** The chat whose agent it runs, which belongs to no project; `null` for a session. */
  chatId: string | null
  toolId: ToolId
  /**
   * The issue the session was opened from, which Claude Code is sent when it
   * starts; `null` for any other session.
   */
  issueId: number | null
  /**
   * `starting` covers the time until the process runs. A starting session
   * already counts as running.
   */
  status: 'starting' | 'running' | 'exited'
  exit: SessionExit | null
  /** The terminal title the session's program set last; empty until it sets one. */
  title: string
  /**
   * For Claude Code, when the output arrived that last set a working title
   * after one that is not; see `afterHookEvent`.
   */
  workingSince: number | null
  /**
   * For Claude Code, the dialog its hooks last said waits for the user, until
   * it works again; see `sessionState`.
   */
  attention: Attention
  /** For Claude Code, the latest turns its hooks told of; see `afterHookEvent`. */
  turns: readonly string[]
  /**
   * For Claude Code, the turn its hooks said stopped on an API error, until a
   * later one starts; see `sessionState`.
   */
  failure: Failure | null
  /**
   * For Claude Code, whether it stopped working while the session was not
   * being viewed, and the session has not been viewed since.
   */
  unread: boolean
  /** The name the user gave the session, if any. */
  customName: string | null
  /** Set once the session is being closed, until it is gone. */
  closing: boolean
}

/** Whether a session's process started, or why it did not. */
export type LaunchResult = { ok: true } | { ok: false; message: string }

/** What is entered in the new issue dialog, before the issue is created. */
export interface NewIssueDraft {
  title: string
  /** Markdown. */
  description: string
  status: IssueStatus
  priority: IssuePriority
  /** The project the issue is to belong to, or `null` for none. */
  projectId: ProjectChoice
}

/**
 * What the new issue dialog starts with: an issue in the backlog, without a
 * priority or a project.
 */
export const emptyNewIssueDraft: NewIssueDraft = {
  title: '',
  description: '',
  status: 'backlog',
  priority: 0,
  projectId: null,
}

/** What is entered in the card for a new sub-issue, before the issue is created. */
export type SubIssueDraft = NewIssueDraft

/**
 * The picker of issues open for an issue: of its parent, for Sub-issue of…;
 * of issues to become its sub-issues, for Parent of…; of an issue it is to be
 * blocked by, for Blocked by…; or of an issue to be blocked by it, for
 * Blocking….
 */
export interface IssuePicker {
  kind: 'parent' | 'sub-issues' | 'blocked-by' | 'blocking'
  issueId: number
}

/**
 * The dialog for a new issue with a dependency on an issue, open from its
 * Blocked by… picker, for a new issue that blocks it (`blocked-by`), or from
 * its Blocking… picker, for one blocked by it (`blocking`); with the title
 * typed in the picker's search field.
 */
export interface DependentIssueDialog {
  kind: 'blocked-by' | 'blocking'
  issueId: number
  title: string
}

/** The deletion of a worktree, from checking it until it is deleted or cancelled. */
export interface WorktreeDeletion {
  projectRoot: string
  path: string
  /** Checking what would be lost, asking for confirmation, or deleting. */
  phase: 'checking' | 'confirm' | 'deleting'
  inspection: WorktreeInspection | null
  /** What went wrong while checking or deleting. */
  error: string | null
}

export interface AppState {
  initialized: boolean
  projects: Project[]
  /** Each project's worktrees as Git lists them, by project root, once they have been read. */
  worktrees: Record<string, WorktreeInfo[]>
  /** The last known state of every worktree listed since Hoot started, by root. */
  knownWorktrees: Record<string, WorktreeInfo>
  /** The project whose new worktree dialog is open. */
  newWorktreeProject: string | null
  worktreeDeletion: WorktreeDeletion | null
  tools: ToolsState
  /** The agents of the Agents page and their operations; `null` until they are known. */
  agents: AgentsState | null
  /**
   * The default agent, the YOLO mode switch and each agent's launch settings;
   * `null` until they are known.
   */
  launchSettings: LaunchSettings | null
  /** Every session, in the order they were started. */
  sessions: UiSession[]
  /** Every chat, in the order of the sidebar's Chats group. */
  chats: ChatInfo[]
  /**
   * The issues whose start button is creating a worktree for them, until
   * their session shows or creating it fails.
   */
  startingIssues: readonly number[]
  /**
   * The issues whose start button or Start new session was clicked to start
   * a session for them, from the click until their session shows in the
   * sidebar, or the start ends without one: one entry for each start.
   */
  issueStarts: readonly number[]
  /** What the window shows; `null` for the empty page. */
  currentPage: Page | null
  /** The pages shown one after another, for going back and forward. */
  history: PageHistory
  /** The issues without a project, and those of the projects in the list. */
  issues: Issue[]
  /**
   * Every label and group, and the labels of every issue, those of removed
   * projects included; the version is -1 until they have been read.
   */
  labels: Labels
  /**
   * The activity of the labels of the issues Hoot shows, by issue id, in the
   * order it happened.
   */
  labelEvents: Record<number, LabelEvent[]>
  /**
   * The parent of every issue that has one, those of removed projects
   * included; the version is -1 until they have been read.
   */
  subIssues: SubIssues
  /**
   * Every dependency, those of the issues of removed projects included; the
   * version is -1 until they have been read.
   */
  dependencies: Dependencies
  /** The picker of issues open for an issue, from Sub-issue of…, Parent of…, Blocked by… or Blocking…. */
  issuePicker: IssuePicker | null
  /** The dialog for a new issue with a dependency, open from a picker's last item. */
  dependentIssueDialog: DependentIssueDialog | null
  /**
   * What is checked in the issue list's Project filter: projects of the list,
   * and `null` for No project. The list shows every issue while nothing is
   * checked, as when Hoot starts.
   */
  checkedProjects: ProjectChoice[]
  /**
   * The labels checked in the issue list's Label filter, by id. The list
   * shows every issue while none is checked, as when Hoot starts.
   */
  checkedLabels: number[]
  /** Whether the Label filter shows the issues with any of its labels, or with all of them. */
  labelMatch: LabelMatch
  /** The view the issue list shows: all issues when Hoot starts. */
  issueView: IssueView
  /** The status groups the issue list has collapsed: none when Hoot starts. */
  collapsedIssueGroups: IssueStatus[]
  /** Whether the new issue dialog is open. It closes when the page shown changes. */
  newIssueDialogOpen: boolean
  /**
   * What is entered in the new issue dialog, wherever it is opened, until the
   * issue is created or Hoot quits.
   */
  newIssueDraft: NewIssueDraft
  /** Whether the new issue dialog stays open after it creates an issue, for the next one. */
  createMore: boolean
  /** An issue the user asked to delete, while Hoot asks for confirmation. */
  issueDeletion: number | null
  /** The session the rename dialog is open for. */
  renamingSessionId: string | null
  /** The chat the rename dialog is open for. */
  renamingChatId: string | null
  /** A running session the user asked to close, while Hoot asks for confirmation. */
  closeConfirmation: string | null
  /**
   * While Hoot asks whether to quit, or to restart into an update: how many
   * sessions are running, which agents are being installed or updated or wait
   * to be, and which of the two it asks.
   */
  quitConfirmation: {
    runningSessions: number
    reason: QuitReason
    agentOperations: AgentOperationSummary[]
  } | null
  /** Where Hoot is with a newer version of itself, which an Update button beside Settings offers. */
  update: UpdateState
  /** How Hoot's latest look for a newer version went; `null` until it has been read. */
  updateCheck: UpdateCheck | null
  /** What the About page tells of Hoot and of what it runs on; `null` until it has been read. */
  appInfo: AppInfo | null
  /** Whether the sidebar is expanded, also while the settings are shown in its place. */
  sidebarOpen: boolean
  /**
   * The sidebar's width in CSS pixels, as it was last resized; a window too
   * narrow for it to leave the main area its narrowest width shows it narrower.
   */
  sidebarWidth: number
  /**
   * Whether the sidebar's edge is being dragged, and the sidebar's width
   * follows the pointer at once, without sliding.
   */
  sidebarResizing: boolean
  /**
   * Whether the sidebar's edge is held, from the pointer pressing it to the
   * pointer being let go of, which outlasts the resizing above: the pointer
   * shows the resize cursor, and no text is selected, while the sidebar
   * slides out and back in as well.
   */
  sidebarEdgeDragging: boolean
  /** The projects collapsed in the sidebar, by id; every other project is expanded. */
  collapsedProjects: ReadonlySet<number>
  /** Whether the window is in full screen. */
  fullScreen: boolean
  /** Whether the window is the system's active window. */
  windowFocused: boolean
  /** The appearance picked in the settings. */
  appearance: Appearance
  /**
   * The page of the settings shown last since Hoot started, which they show
   * again when they are shown: Appearance until another is shown. Showing
   * another is not recorded in the history.
   */
  settingsSection: SettingsSection

  /**
   * Reads the window's state and the appearance picked, and follows their
   * changes. Called before the first render, so that the sidebar opens as it
   * was left, without sliding.
   */
  initializeWindow(): Promise<void>
  initialize(): Promise<void>
  addProject(): Promise<void>
  removeProject(root: string): Promise<void>
  redetectTools(): Promise<void>
  /**
   * Tells Hoot that the Agents page opened: it detects the first time since
   * Hoot started, and once the last detection started 20 hours ago or more.
   */
  enterAgentsPage(): void
  /**
   * Reads the login shell environment again, looks for every agent's
   * installation and version, and reads every agent's latest version.
   */
  detectAgents(): void
  installAgent(id: CodingToolId): void
  updateAgent(id: CodingToolId): void
  /** Updates every agent that can be updated, one after another. */
  updateAllAgents(): void
  cancelAgentOperation(id: CodingToolId): void
  /** Makes an agent the default agent. */
  setDefaultAgent(id: CodingToolId): void
  /** Turns YOLO mode on or off for the sessions that start from now on. */
  setYoloMode(on: boolean): void
  /** Changes an agent's launch settings for the sessions that start from now on. */
  changeAgentLaunchSettings(id: CodingToolId, change: AgentLaunchSettingsChange): void
  /** Starts a session in the project's main worktree, or in one of its worktrees. */
  newSession(projectRoot: string, toolId: ToolId, worktreePath?: string | null): void
  /**
   * Opens a new chat with `toolId`, or with the default agent while it can be
   * used, else the first agent that can: a chat of the agent, shown in the
   * main area, and its agent's process started. Without an agent that can be
   * used, opens the Agents page and says that one must be installed or turned
   * on. Until the first detection of the agents finishes, nothing happens.
   */
  newChat(toolId?: CodingToolId): Promise<void>
  /**
   * Shows a chat's page and, when no process of it runs, starts its agent in
   * the chat's folder, continuing its conversation; a chat that ended
   * unexpectedly continues in a new session.
   */
  openChat(chatId: string): void
  /** Continues a chat whose agent ended unexpectedly, as its Resume button does. */
  resumeChat(chatId: string): void
  /** Asks for confirmation before closing a running chat's agent, as closing a session does. */
  closeChat(chatId: string): void
  startRenamingChat(chatId: string): void
  /** Ends renaming a chat; `null` keeps its name as it was. */
  finishRenamingChat(chatId: string, name: string | null): void
  /**
   * Starts work on an open issue, as its start button does. While a session
   * opened from the issue is in the sidebar, shows the one opened last,
   * whatever project the issue belongs to since. Otherwise, unless work on
   * it cannot be started now, opens a session for it as `startNewSession`
   * does.
   */
  startIssue(issueId: number): Promise<void>
  /**
   * Opens another session for an issue, as its Start new session does,
   * unless work on it cannot be started now, when it says why: saves the
   * changes to the issue made so far, then starts Claude Code, as the Agents
   * page has it, in the issue's worktree in the project it belongs to, after
   * creating one when it has none; the session is shown once it is added,
   * whatever page is shown by then, and is sent the issue.
   */
  startNewSession(issueId: number): Promise<void>
  /**
   * Starts a session for an issue as hoot asked, as `startNewSession` does,
   * without showing it, with `prompt` as its first message when one is
   * given; settles once it has started, or could not.
   */
  startSessionForAgent(issueId: number, prompt: string | null): Promise<SessionStartAnswer>
  /** Starts a session's process; settles with whether it started, and why not. */
  launchSession(id: string, cols: number, rows: number): Promise<LaunchResult>
  /** Shows a session and puts the keyboard focus in its terminal. */
  selectSession(id: string): void
  runShortcut(shortcut: SessionShortcut): void
  runMenuCommand(command: SessionCommand): void
  /** Shows the page shown before the current one, if any. */
  goBack(): void
  /** Shows the page shown after the current one, if any. */
  goForward(): void
  /**
   * Shows the settings in place of the sidebar and the main area, at a page
   * of theirs; without one, at the page they showed last.
   */
  showSettings(section?: SettingsSection): void
  /** Shows another page of the settings, without recording it in the history. */
  selectSettingsSection(section: SettingsSection): void
  /**
   * Leaves the settings as going back does. Without a page before them, shows
   * the empty page instead, and takes the settings out of the history.
   */
  leaveSettings(): void
  /** Picks an appearance, which applies at once and is saved for the next start. */
  setAppearance(appearance: Appearance): void
  /**
   * Shows the issue list, with what is checked in its Project filter as it
   * is. The list is one page in the history, whatever is checked.
   */
  showIssueList(): void
  /** Shows the issue list with only a project checked in its Project filter. */
  showProjectIssues(projectId: number): void
  /** Checks these in the issue list's Project filter, and nothing else. */
  setCheckedProjects(checked: readonly ProjectChoice[]): void
  /** Checks these labels in the issue list's Label filter, and no other. */
  setCheckedLabels(checked: readonly number[]): void
  setLabelMatch(match: LabelMatch): void
  /** Shows another view of the issue list; not recorded in the history. */
  setIssueView(view: IssueView): void
  /** Expands or collapses a status group of the issue list. */
  setIssueGroupOpen(status: IssueStatus, open: boolean): void
  showIssue(issueId: number): void
  /**
   * Opens the new issue dialog, with what was entered in it before. While its
   * title and description are empty, the issue is to belong to `projectId`,
   * or to no project for `null`; `preset` sets the status or the priority to
   * start from.
   */
  openNewIssue(
    projectId: ProjectChoice,
    preset?: Partial<Pick<NewIssueDraft, 'status' | 'priority'>>,
  ): void
  /** Closes the new issue dialog, keeping what is entered in it. */
  closeNewIssue(): void
  updateNewIssueDraft(changes: Partial<NewIssueDraft>): void
  setCreateMore(createMore: boolean): void
  /**
   * Creates an issue from what is entered in the new issue dialog, and says
   * so. The dialog closes, unless it is to create more, when it keeps the
   * status, the priority and the project for the next issue; with `open`, it
   * shows the new issue instead. Settles with the new issue, or `null` when
   * none was created.
   */
  createIssue(options?: { open?: boolean }): Promise<Issue | null>
  /**
   * Changes an issue at once and saves the change in the background, one
   * save at a time for each issue, so that the latest change is saved last.
   */
  updateIssue(issueId: number, changes: IssueChanges): void
  /** Settles once the changes made to an issue so far are saved, or failed to be. */
  whenIssueSaved(issueId: number): Promise<void>
  /** Asks for confirmation before deleting an issue, which cannot be undone. */
  requestDeleteIssue(issueId: number): void
  answerDeleteIssue(confirmed: boolean): void
  /** Deletes an issue for good; its page, if shown, gives way to the issue list. */
  deleteIssue(issueId: number): Promise<void>
  /**
   * Creates an issue as the last sub-issue of a parent, from what is entered
   * in the card for it; says why when it cannot. Settles with the new issue,
   * or `null` when none was created.
   */
  createSubIssue(parentId: number, draft: SubIssueDraft): Promise<Issue | null>
  /**
   * Gives issues other parents, or none, all together; says why, under
   * `failure`, when it cannot. Settles with whether they were given.
   */
  setIssueParents(changes: ParentChange[], failure: string): Promise<boolean>
  /**
   * Opens the picker of a parent (Sub-issue of…), of sub-issues (Parent of…),
   * of an issue it is blocked by (Blocked by…) or of one it blocks
   * (Blocking…) for an issue.
   */
  openIssuePicker(kind: IssuePicker['kind'], issueId: number): void
  closeIssuePicker(): void
  /**
   * Makes and removes dependencies; says why, under `failure`, when they
   * cannot be. Settles with whether they were.
   */
  changeDependencies(
    change: { add?: Dependency[]; remove?: Dependency[] },
    failure: string,
  ): Promise<boolean>
  /**
   * Closes the picker, and opens the dialog for a new issue that blocks the
   * picker's issue (`blocked-by`) or is blocked by it (`blocking`), with a title.
   */
  openDependentIssue(kind: DependentIssueDialog['kind'], issueId: number, title: string): void
  closeDependentIssue(): void
  /**
   * Creates an issue from what is entered in the dialog for a new issue with a
   * dependency, with that dependency, and says so; or says why it cannot.
   * Settles with the new issue, or `null` when none was created.
   */
  createDependentIssue(draft: NewIssueDraft): Promise<Issue | null>
  /** Puts an issue's identifier, such as "ISS-12", on the clipboard. */
  copyIssueIdentifier(issueId: number): void
  copyIssueTitle(issueId: number): void
  /**
   * Gives an issue labels and takes others off it, as the user does; says
   * why when it cannot. Settles with whether it did.
   */
  changeIssueLabels(
    issueId: number,
    change: { add?: number[]; remove?: number[] },
  ): Promise<boolean>
  /**
   * Creates a label from what is entered, and says why when it cannot;
   * gives it to the issue the request names, if any. Settles with whether it
   * did.
   */
  createLabel(label: NewLabelRequest): Promise<boolean>
  /** Changes a label; says why when it cannot. Settles with whether it did. */
  editLabel(id: number, changes: LabelChangeRequest): Promise<boolean>
  /** Deletes a label, which every issue carrying it no longer does; says why when it cannot. */
  deleteLabel(id: number): Promise<boolean>
  /** Creates a group of labels; says why when it cannot. Settles with whether it did. */
  createLabelGroup(name: string): Promise<boolean>
  /** Deletes a group, whose labels stay without one; says why when it cannot. */
  deleteLabelGroup(id: number): Promise<boolean>
  /**
   * Expands or collapses the sidebar, and saves its state; not while the
   * settings are shown in its place.
   */
  setSidebarOpen(open: boolean): void
  /** Sets the sidebar's width, brought within its limits, and saves it. */
  setSidebarWidth(width: number): void
  setSidebarResizing(resizing: boolean): void
  /** Notes that the sidebar's edge is held from now until it is let go of. */
  setSidebarEdgeDragging(dragging: boolean): void
  /** Expands or collapses a project in the sidebar, and saves its state. */
  setProjectExpanded(projectId: number, expanded: boolean): void
  /** Closes a session, asking for confirmation first while it runs. */
  requestCloseSession(id: string): void
  answerCloseConfirmation(confirmed: boolean): void
  /** Closes a session without asking: ends its process if it runs, then removes it. */
  closeSession(id: string): Promise<void>
  startRenaming(id: string): void
  /** Ends renaming; `null` keeps the name as it was. */
  finishRenaming(id: string, name: string | null): void
  answerQuit(confirmed: boolean): void
  /** Downloads the newer version, unless it is downloaded already, then restarts Hoot into it. */
  installUpdate(): void
  /** Looks for a newer version, unless one is being downloaded or installed. */
  checkForUpdates(): void
  openNewWorktreeDialog(projectRoot: string): void
  closeNewWorktreeDialog(): void
  /**
   * Reads the project's worktrees again and, unless the worktree is gone,
   * missing or locked now, checks it and asks for confirmation before
   * deleting it.
   */
  requestDeleteWorktree(projectRoot: string, path: string): void
  answerDeleteWorktree(confirmed: boolean): Promise<void>
  /**
   * Removes the registrations of a worktree whose folder is missing, unless
   * reading the project's worktrees again shows it gone or no longer missing.
   */
  removeMissingWorktree(projectRoot: string, path: string): Promise<void>
}

declare global {
  interface Window {
    /** Exposed only when the app runs with test hooks. */
    hootTestHooks?: {
      /** The terminal of the current session. */
      readonly terminal: SessionTerminal['terminal'] | undefined
      terminalOf(sessionId: string): SessionTerminal['terminal'] | undefined
    }
  }
}

/** The terminal of every session, which exists for as long as the session. */
const terminals = new Map<string, SessionTerminal>()

/**
 * For the terminal of every session, when each piece written to it that it
 * has not read yet arrived, oldest first: what a piece does, such as setting
 * the title, counts from then, however long the terminal takes to read it.
 */
const arrivals = new Map<string, number[]>()

/** Writes to a session's terminal what arrived for it now, and calls `onRead` once it is read. */
function writeArrived(id: string, data: string, onRead?: () => void): void {
  const terminal = terminals.get(id)?.terminal
  const pending = arrivals.get(id)
  if (!terminal || !pending) return
  pending.push(Date.now())
  terminal.write(data, () => {
    pending.shift()
    onRead?.()
  })
}

export function getSessionTerminal(id: string | null): SessionTerminal | undefined {
  return id === null ? undefined : terminals.get(id)
}

/**
 * The session the main area shows, or `null` when it shows an Issues page or
 * the empty page, or when the window shows the settings.
 */
export function currentSessionId(state: Pick<AppState, 'currentPage'>): string | null {
  return state.currentPage?.kind === 'session' ? state.currentPage.sessionId : null
}

/**
 * The session the user is viewing: the one the main area shows, while the
 * window is the system's active window; `null` for none.
 */
export function viewedSessionId(
  state: Pick<AppState, 'currentPage' | 'windowFocused'>,
): string | null {
  return state.windowFocused ? currentSessionId(state) : null
}

/**
 * Whether a page shows a session among `sessionIds`, or the page of an issue
 * among `issueIds`. The issue list and the settings are never among them.
 */
function pageIn(
  page: Page,
  sessionIds: ReadonlySet<string>,
  issueIds: ReadonlySet<number>,
): boolean {
  if (page.kind === 'session') return sessionIds.has(page.sessionId)
  return page.kind === 'issue' && issueIds.has(page.issueId)
}

/** What is checked in the issue list's Project filter, without the projects that left the list. */
function withoutProjects(
  checked: ProjectChoice[],
  projectIds: ReadonlySet<number>,
): ProjectChoice[] {
  const kept = checked.filter((choice) => choice === null || !projectIds.has(choice))
  return kept.length === checked.length ? checked : kept
}

/**
 * The issues with one replaced by its new state; unchanged without it, as
 * when its project left the list while it was being changed.
 */
function withIssue(issues: readonly Issue[], issue: Issue): Issue[] {
  return issues.map((entry) => (entry.id === issue.id ? issue : entry))
}

/** An issue as it is once changes not saved yet are saved, as far as Hoot can tell now. */
function withChanges(issue: Issue, changes: IssueChanges | undefined): Issue {
  if (!changes) return issue
  const status = changes.status ?? issue.status
  let { completedAt } = issue
  if (status !== issue.status) completedAt = isCompleted(status) ? Date.now() : null
  return {
    ...issue,
    projectId: changes.projectId === undefined ? issue.projectId : changes.projectId,
    title: changes.title === undefined ? issue.title : issueTitle(changes.title),
    description: changes.description ?? issue.description,
    priority: changes.priority ?? issue.priority,
    status,
    completedAt,
  }
}

/** Text from the user shown in a message; marked so it is not mistaken for interface text. */
function userText(text: string): ReactNode {
  return createElement('span', { 'data-user-text': '' }, text)
}

/** Puts text on the clipboard, and says so. */
function copyText(text: string): void {
  api.writeClipboardText(text)
  toast.success('Copied to the clipboard.', { description: userText(text) })
}

/**
 * Hands what the editors of issues have not passed on yet, such as a
 * description typed a moment ago, to the store.
 */
const issueEditorFlushes = new Set<() => void>()

/** Registers an editor's flush, until the returned function unregisters it. */
export function onFlushIssueEdits(flush: () => void): () => void {
  issueEditorFlushes.add(flush)
  return () => issueEditorFlushes.delete(flush)
}

/** A file path shown in a message; marked so it is not mistaken for interface text. */
function pathText(path: string): ReactNode {
  return createElement('span', { 'data-path': '' }, path)
}

/** The message of something thrown, such as a failed call to the main process. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Why a worktree, as it is now, cannot be deleted; `null` when it can. */
function whyNotDeletable(worktree: WorktreeInfo | null): string | null {
  if (worktree === null) return 'The worktree no longer exists.'
  if (worktree.missing) return 'The folder of the worktree is missing.'
  if (worktree.locked) return 'The worktree is locked.'
  return null
}

/** True while a session is starting or running. */
export function isSessionRunning(session: UiSession): boolean {
  return session.status !== 'exited'
}

function fromInfo(info: SessionInfo, chat?: ChatInfo): UiSession {
  return {
    ...info,
    title: chat?.title ?? '',
    workingSince: null,
    attention: null,
    turns: [],
    failure: null,
    unread: false,
    customName: chat?.customName ?? null,
    closing: false,
  }
}

/**
 * The worktree of an issue: among the worktrees of the project it belongs to
 * now, as Hoot last read them, the first on one of its branches whose folder
 * exists, in the sidebar's order; `null` without one, as for an issue
 * without a project.
 */
export function issueWorktreeOf(
  state: Pick<AppState, 'projects' | 'worktrees'>,
  issue: Pick<Issue, 'id' | 'projectId'>,
): WorktreeInfo | null {
  const project = state.projects.find((candidate) => candidate.id === issue.projectId)
  return project ? issueWorktree(state.worktrees[project.root] ?? [], issue.id) : null
}

/** A session that could not be started for an issue, and why. */
function fail(message: string): SessionStartAnswer {
  return { ok: false, message }
}

/** The session opened last from an issue that is in the sidebar, if any. */
export function latestIssueSession(
  state: Pick<AppState, 'sessions'>,
  issueId: number,
): UiSession | undefined {
  return state.sessions.findLast((session) => session.issueId === issueId)
}

/** An issue's parent, unless it has none or Hoot does not show it, as of a removed project. */
export function shownParentOf(
  state: Pick<AppState, 'issues' | 'subIssues'>,
  issueId: number,
): Issue | undefined {
  const parentId = parentOf(state.subIssues.links, issueId)
  return parentId === null ? undefined : state.issues.find((issue) => issue.id === parentId)
}

/**
 * An issue's sub-issues that Hoot shows, without those of removed projects,
 * in the order they last became its sub-issues.
 */
export function shownSubIssuesOf(
  state: Pick<AppState, 'issues' | 'subIssues'>,
  issueId: number,
): Issue[] {
  const byId = new Map(state.issues.map((issue) => [issue.id, issue]))
  return subIssueIdsOf(state.subIssues.links, issueId).flatMap((id) => byId.get(id) ?? [])
}

/**
 * The issues Hoot shows that an issue is blocked by, done and canceled ones
 * too, in the order it became blocked by them.
 */
export function shownBlockedByOf(
  state: Pick<AppState, 'issues' | 'dependencies'>,
  issueId: number,
): Issue[] {
  const byId = new Map(state.issues.map((issue) => [issue.id, issue]))
  return blockedByIdsOf(state.dependencies.links, issueId).flatMap((id) => byId.get(id) ?? [])
}

/**
 * The issues Hoot shows that are blocked by an issue, done and canceled ones
 * too, in the order they became blocked by it.
 */
export function shownBlockingOf(
  state: Pick<AppState, 'issues' | 'dependencies'>,
  issueId: number,
): Issue[] {
  const byId = new Map(state.issues.map((issue) => [issue.id, issue]))
  return blockingIdsOf(state.dependencies.links, issueId).flatMap((id) => byId.get(id) ?? [])
}

const NO_WAITING: WaitCounts = { waitedOn: 0, waiting: 0 }

/** The wait counts of every issue, worked out once for the issues and dependencies they are of. */
let waitCountCache: {
  issues: readonly Issue[]
  links: readonly Dependency[]
  counts: Map<number, WaitCounts>
} | null = null

/**
 * How many issues an issue waits on, and how many wait on it: an issue waits
 * on an issue it is blocked by while Hoot shows both and neither is done nor
 * canceled.
 */
export function waitCountsOf(
  state: Pick<AppState, 'issues' | 'dependencies'>,
  issueId: number,
): WaitCounts {
  const { issues } = state
  const { links } = state.dependencies
  if (waitCountCache?.issues !== issues || waitCountCache.links !== links) {
    const shown = new Map(issues.map((issue) => [issue.id, issue]))
    waitCountCache = { issues, links, counts: waitCounts(shown, links) }
  }
  return waitCountCache.counts.get(issueId) ?? NO_WAITING
}

/** The labels of every issue, worked out once for the labels they are of. */
let issueLabelCache: { labels: Labels; byIssue: Map<number, NamedLabel[]> } | null = null

const NO_LABELS: NamedLabel[] = []

/**
 * The labels an issue carries, with their groups' names, in the order Hoot
 * lists labels; the same array for as long as they stay the same.
 */
export function issueLabelsOf(state: Pick<AppState, 'labels'>, issueId: number): NamedLabel[] {
  if (issueLabelCache?.labels !== state.labels) {
    issueLabelCache = { labels: state.labels, byIssue: new Map() }
  }
  const cached = issueLabelCache.byIssue.get(issueId)
  if (cached) return cached
  const found = labelsOfIssue(state.labels, issueId)
  const labels = found.length === 0 ? NO_LABELS : found
  issueLabelCache.byIssue.set(issueId, labels)
  return labels
}

/** The id of the group of the workflow every issue follows, once the labels have been read. */
function workflowGroupId(labels: Labels): number | undefined {
  return labels.groups.find((group) => group.workflow === ISSUE_WORKFLOW.name)?.id
}

/** The progress of every issue, worked out once for the labels it is of. */
let progressCache: { labels: Labels; byIssue: Map<number, WorkflowProgress> } | null = null

/**
 * Where an issue is in its workflow: by the label of the workflow's group it
 * carries; the same object for as long as its labels stay the same.
 */
export function issueProgressOf(
  state: Pick<AppState, 'labels'>,
  issueId: number,
): WorkflowProgress {
  if (progressCache?.labels !== state.labels) {
    progressCache = { labels: state.labels, byIssue: new Map() }
  }
  const cached = progressCache.byIssue.get(issueId)
  if (cached) return cached
  const groupId = workflowGroupId(state.labels)
  const progress = workflowProgress(
    ISSUE_WORKFLOW,
    issueLabelsOf(state, issueId)
      .filter((label) => groupId !== undefined && label.groupId === groupId)
      .map((label) => label.name),
  )
  progressCache.byIssue.set(issueId, progress)
  return progress
}

/** The activity of an issue's labels, in the order it happened. */
const NO_EVENTS: LabelEvent[] = []
export function labelEventsOf(state: Pick<AppState, 'labelEvents'>, issueId: number): LabelEvent[] {
  return state.labelEvents[issueId] ?? NO_EVENTS
}

/**
 * Whether the issue list shows an issue for what is checked in its Project
 * and Label filters: of a project checked, or any while none is; and with
 * any or all of the labels checked, as the filter matches them, or any
 * while none is.
 */
export function isListed(
  state: Pick<AppState, 'checkedProjects' | 'checkedLabels' | 'labelMatch' | 'labels'>,
  issue: Pick<Issue, 'id' | 'projectId'>,
): boolean {
  if (!isOnList(issue, state.checkedProjects)) return false
  if (state.checkedLabels.length === 0) return true
  const carried = new Set(issueLabelsOf(state, issue.id).map((label) => label.id))
  return state.labelMatch === 'all'
    ? state.checkedLabels.every((id) => carried.has(id))
    : state.checkedLabels.some((id) => carried.has(id))
}

/** The issues Hoot shows by id, worked out once for the issues they are of. */
let shownIssueCache: { issues: readonly Issue[]; shown: Map<number, Issue> } | null = null

/**
 * Every reason work on an issue cannot be started now: Claude Code is being
 * checked for or is not installed, it has no project, it waits on issues, or
 * its workflow is finished. None when it can be.
 */
export function startBlockersOf(
  state: Pick<AppState, 'tools' | 'issues' | 'dependencies' | 'labels'>,
  issue: Pick<Issue, 'id' | 'projectId'>,
): StartBlocker[] {
  if (shownIssueCache?.issues !== state.issues) {
    shownIssueCache = {
      issues: state.issues,
      shown: new Map(state.issues.map((entry) => [entry.id, entry])),
    }
  }
  const { shown } = shownIssueCache
  return startBlockers(
    state.tools,
    issue,
    waitedOnIds(shown, state.dependencies.links, issue.id),
    issueProgressOf(state, issue.id),
  )
}

/** Says why the worktree of an issue could not be created, with Git's own words in its font. */
function failToCreateIssueWorktree(
  issueId: number,
  { reason, message }: Extract<CreateIssueWorktreeResult, { ok: false }>,
): void {
  toast.error(`Could not create a worktree for ${issueIdentifier(issueId)}.`, {
    description:
      reason === 'failed'
        ? createElement(
            'pre',
            {
              className: 'max-h-48 overflow-auto font-mono text-xs whitespace-pre-wrap',
              'data-path': '',
              'data-testid': 'issue-worktree-error',
            },
            message,
          )
        : createElement('span', { 'data-testid': 'issue-worktree-error' }, message),
    duration: 15_000,
  })
}

/** Says that Git created a worktree but reported a problem, with what Git said. */
export function warnAboutWorktree(warning: string): void {
  toast.warning('The worktree was created, but Git reported a problem.', {
    description: createElement(
      'pre',
      {
        className: 'max-h-48 overflow-auto font-mono text-xs whitespace-pre-wrap',
        'data-path': '',
        'data-testid': 'worktree-warning',
      },
      warning,
    ),
    duration: 15_000,
  })
}

/** The worktree rows of a project: its worktrees, and those its sessions run in. */
export function projectWorktreeRows(
  state: Pick<AppState, 'worktrees' | 'knownWorktrees' | 'sessions'>,
  projectRoot: string,
): WorktreeRow[] {
  return worktreeRows(
    state.worktrees[projectRoot],
    sessionWorktrees(state.sessions, projectRoot),
    state.knownWorktrees,
  )
}

/** The worktrees a project's sessions run in, without duplicates. */
export function sessionWorktrees(sessions: readonly UiSession[], projectRoot: string): string[] {
  return [
    ...new Set(
      sessions
        .filter((session) => session.projectRoot === projectRoot && session.worktreePath !== null)
        .map((session) => session.worktreePath!),
    ),
  ]
}

/**
 * Every session in switch order: the sessions of the projects in sidebar
 * order, then the running chats in the order of the Chats group, which is
 * where chats come in the sidebar.
 */
export function orderedSessions(
  state: Pick<AppState, 'projects' | 'worktrees' | 'knownWorktrees' | 'sessions' | 'chats'>,
  /** Sessions that are being closed count too, at the place of their chat. */
  closing: ReadonlySet<string> = new Set(),
): UiSession[] {
  const sessions = sidebarOrder(
    state.projects,
    state.sessions.filter((session) => session.chatId === null),
    (root) => projectWorktreeRows(state, root).map((row) => row.path),
  )
  const chats = orderedChatSessions(state.chats, state.sessions, isSessionRunning, closing)
  return [...sessions, ...chats]
}

function updateSession(
  sessions: UiSession[],
  id: string,
  changes: Partial<UiSession>,
): UiSession[] {
  return sessions.map((session) => (session.id === id ? { ...session, ...changes } : session))
}

/** Puts the keyboard focus in the current session's terminal. */
export function focusCurrentTerminal(): void {
  getSessionTerminal(currentSessionId(useAppStore.getState()))?.terminal.focus()
}

/**
 * Where a menu or dialog moves the keyboard focus when it closes: into the
 * current session's terminal, or where it would go anyway when the main area
 * shows no session. A menu that opened the picker of issues leaves the focus
 * where the picker put it.
 */
export function focusAfterOverlay(): HTMLElement | boolean {
  const { issuePicker, dependentIssueDialog } = useAppStore.getState()
  if (issuePicker !== null || dependentIssueDialog !== null) return false
  const id = currentSessionId(useAppStore.getState())
  if (id === null) return true
  // A terminal that is not on screen yet takes the focus once it is.
  return getSessionTerminal(id)?.terminal.textarea ?? false
}

/**
 * Before the settings take the place of the sidebar and the main area, what
 * has the keyboard focus gives it up as when another page takes it, such as
 * an issue's description being edited, which saves what was typed.
 */
function blurBeforeSettings(): void {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
}

export const useAppStore = create<AppState>()((set, get) => {
  const findSession = (id: string) => get().sessions.find((session) => session.id === id)
  const findIssue = (id: number) => get().issues.find((issue) => issue.id === id)

  /** Creates a session's terminal, wired to the session's process. */
  const openTerminal = (id: string): SessionTerminal => {
    const sessionTerminal = createSessionTerminal(systemColorScheme())
    const { terminal } = sessionTerminal
    // Also while the session is not shown: programs expect answers to their
    // terminal queries, and the session's name follows its title.
    terminal.onData((data) => api.writeSession(id, data))
    terminal.onBinary((data) => api.writeSession(id, data, true))
    terminal.onResize(({ cols, rows }) => api.resizeSession(id, cols, rows))
    // What Claude Code is doing follows its title too, from when the output
    // that set it arrived.
    terminal.onTitleChange((title) => {
      const session = findSession(id)
      if (!session || session.title === title) return
      const arrivedAt = arrivals.get(id)?.[0] ?? Date.now()
      const change = afterTitle(session, title, viewedSessionId(get()) === id, arrivedAt)
      set((state) => ({
        sessions: updateSession(state.sessions, id, { title, ...change }),
        ...(session.chatId === null || title === ''
          ? {}
          : {
              chats: state.chats.map((chat) =>
                chat.id === session.chatId ? { ...chat, title } : chat,
              ),
            }),
      }))
      // The name of a chat follows the last title its agent set, as a session's does.
      if (session.chatId !== null && title !== '') api.setChatTitle(session.chatId, title)
    })
    terminals.set(id, sessionTerminal)
    arrivals.set(id, [])
    return sessionTerminal
  }

  /**
   * Expands the project of a session that has just become the current one,
   * however it became current, so that its row shows in the sidebar.
   */
  const expandProjectOf = (page: Page | null) => {
    if (page?.kind !== 'session') return
    const { sessions, projects, setProjectExpanded } = get()
    const session = sessions.find((candidate) => candidate.id === page.sessionId)
    const project = projects.find((candidate) => candidate.root === session?.projectRoot)
    if (project) setProjectExpanded(project.id, true)
  }

  /**
   * Shows a page other than by going back or forward, recording it in the
   * history. Showing the current session again only puts the keyboard focus
   * in its terminal.
   */
  const showPage = (page: Page) => {
    const { currentPage } = get()
    // Also a session shown again becomes current again.
    expandProjectOf(page)
    if (samePage(currentPage, page)) {
      if (page.kind === 'session') focusCurrentTerminal()
      return
    }
    getSessionTerminal(currentSessionId(get()))?.terminal.blur()
    // The terminal view of a session takes the focus once it is shown.
    set((state) => ({
      currentPage: page,
      history: visit(state.history, page),
      newIssueDialogOpen: false,
    }))
  }

  /**
   * Takes the pages of closed sessions, and of the issues of removed
   * projects, out of the window, and the closed sessions with their
   * terminals; the issue list stays. When the current page is among them, a
   * closed session gives way to the next session in sidebar order (or the
   * previous one when there is none after it), which is recorded in the
   * history; without another session, and for the page of a removed
   * project's issue, the page of the history's current entry is shown, or
   * the empty page without one.
   */
  const removePages = (
    ids: ReadonlySet<string>,
    projectIds: ReadonlySet<number> = new Set(),
    projects?: Project[],
  ) => {
    let sessionShown = false
    const keep = (id: string | null) => (id !== null && ids.has(id) ? null : id)
    set((state) => {
      const goneIssues = new Set(
        state.issues
          .filter((issue) => issue.projectId !== null && projectIds.has(issue.projectId))
          .map((issue) => issue.id),
      )
      const gone = (page: Page) => pageIn(page, ids, goneIssues)
      // The history forgets the pages before it records the one shown instead.
      let history = forget(state.history, gone)
      let currentPage = state.currentPage
      if (currentPage !== null && gone(currentPage)) {
        const order = orderedSessions(state, ids).map((session) => session.id)
        const next =
          currentPage.kind === 'session'
            ? currentAfterClosing(order, currentPage.sessionId, ids)
            : null
        if (next !== null) {
          currentPage = sessionPage(next)
          history = visit(history, currentPage)
          sessionShown = true
        } else {
          currentPage = currentEntry(history)
          sessionShown = currentPage?.kind === 'session'
        }
      }
      for (const id of goneIssues) unsavedChanges.delete(id)
      const draft = state.newIssueDraft
      return {
        projects: projects ?? state.projects,
        sessions: state.sessions.filter((session) => !ids.has(session.id)),
        currentPage,
        history,
        renamingSessionId: keep(state.renamingSessionId),
        closeConfirmation: keep(state.closeConfirmation),
        // What was entered for a removed project's issues goes with them.
        issues: state.issues.filter((issue) => !goneIssues.has(issue.id)),
        checkedProjects: withoutProjects(state.checkedProjects, projectIds),
        // A draft for a removed project is for no project, and keeps the rest.
        newIssueDraft:
          draft.projectId !== null && projectIds.has(draft.projectId)
            ? { ...draft, projectId: null }
            : draft,
        newIssueDialogOpen: state.newIssueDialogOpen && currentPage === state.currentPage,
        issueDeletion:
          state.issueDeletion !== null && goneIssues.has(state.issueDeletion)
            ? null
            : state.issueDeletion,
        issuePicker:
          state.issuePicker !== null && goneIssues.has(state.issuePicker.issueId)
            ? null
            : state.issuePicker,
        dependentIssueDialog:
          state.dependentIssueDialog !== null && goneIssues.has(state.dependentIssueDialog.issueId)
            ? null
            : state.dependentIssueDialog,
      }
    })
    if (sessionShown) expandProjectOf(get().currentPage)
    // Once the window no longer shows them.
    setTimeout(() => {
      for (const id of ids) {
        terminals.get(id)?.terminal.dispose()
        terminals.delete(id)
        arrivals.delete(id)
      }
      // A newly shown session's terminal takes the focus by itself. Otherwise
      // give the focus back to the terminal if what had it went away.
      const focused = document.activeElement
      if (!sessionShown && (focused === null || focused === document.body)) {
        focusCurrentTerminal()
      }
    }, 0)
  }

  /** Closes sessions, whose processes have ended, and takes them out of the window. */
  const removeSessions = (ids: readonly string[]) => removePages(new Set(ids))

  /**
   * Replaces Issues pages that are gone, and the history's entries of them,
   * with another page, recorded as any page shown is.
   */
  const replacePages = (gone: (page: Page) => boolean, page: Page) => {
    getSessionTerminal(currentSessionId(get()))?.terminal.blur()
    set((state) => {
      const history = forget(state.history, gone)
      return { currentPage: page, history: visit(history, page), newIssueDialogOpen: false }
    })
  }

  /** Whether the issues have been read since Hoot started. */
  let issuesRead = false

  /** Shows the chats as they are now, in the order the sidebar lists them. */
  const applyChats = (chats: ChatInfo[]) => {
    set((state) => ({
      chats,
      renamingChatId:
        state.renamingChatId !== null && !chats.some((chat) => chat.id === state.renamingChatId)
          ? null
          : state.renamingChatId,
    }))
  }

  /**
   * Shows the labels as they are now, unless newer ones are shown already;
   * the Label filter forgets the labels deleted.
   */
  const applyLabels = (labels: Labels) => {
    if (labels.version < get().labels.version) return
    const ids = new Set(labels.labels.map((label) => label.id))
    set((state) => {
      const checked = state.checkedLabels.filter((id) => ids.has(id))
      return {
        labels,
        checkedLabels:
          checked.length === state.checkedLabels.length ? state.checkedLabels : checked,
      }
    })
  }

  /** Adds entries to the activity of the labels of their issues, each once. */
  const addLabelEvents = (events: readonly LabelEvent[]) => {
    if (events.length === 0) return
    set((state) => {
      const labelEvents = { ...state.labelEvents }
      for (const event of events) {
        const known = labelEvents[event.issueId] ?? []
        if (known.some((entry) => entry.id === event.id)) continue
        labelEvents[event.issueId] = [...known, event].toSorted((a, b) => a.id - b.id)
      }
      return { labelEvents }
    })
  }

  /** Reads the labels and the activity of the issues' labels again. */
  const loadLabels = () => {
    void api
      .listLabels()
      .then(applyLabels, (error: unknown) => console.error('Could not read the labels:', error))
    void api
      .listLabelEvents()
      .then(addLabelEvents, (error: unknown) =>
        console.error("Could not read the activity of the issues' labels:", error),
      )
  }

  /**
   * Shows issues as Hoot changed them other than from the window, with the
   * changes to them not saved yet; an issue the window does not show stays
   * out.
   */
  const applyChangedIssues = (changed: readonly Issue[]) => {
    set((state) => {
      let { issues } = state
      for (const issue of changed) {
        issues = withIssue(issues, withChanges(issue, unsavedChanges.get(issue.id)))
      }
      return { issues }
    })
  }

  /** Shows the parents of issues as they are now, unless newer ones are shown already. */
  const applySubIssues = (subIssues: SubIssues) => {
    if (subIssues.version >= get().subIssues.version) set({ subIssues })
  }

  /** Shows the dependencies as they are now, unless newer ones are shown already. */
  const applyDependencies = (dependencies: Dependencies) => {
    if (dependencies.version >= get().dependencies.version) set({ dependencies })
  }

  /**
   * Reads the issues again, showing them with the changes to them not saved
   * yet; those of a project that has left the list by then stay out.
   */
  const loadIssues = () => {
    issuesRead = true
    loadLabels()
    void api
      .listSubIssues()
      .then(applySubIssues, (error: unknown) =>
        console.error('Could not read the parents of the issues:', error),
      )
    void api
      .listDependencies()
      .then(applyDependencies, (error: unknown) =>
        console.error('Could not read the dependencies of the issues:', error),
      )
    void api.listIssues().then(
      (issues) =>
        set((state) => {
          const listed = new Set(state.projects.map((project) => project.id))
          return {
            issues: issues
              .filter((issue) => issue.projectId === null || listed.has(issue.projectId))
              .map((issue) => withChanges(issue, unsavedChanges.get(issue.id))),
          }
        }),
      (error: unknown) => console.error('Could not list the issues:', error),
    )
  }

  /**
   * Applies a new project list: the sessions of projects that left it are
   * closed, and the pages of their issues go; a project that left it is
   * expanded when it is added again. The issues are read once Hoot knows its
   * projects, and again when a project joins the list, bringing its issues.
   */
  const applyProjects = (projects: Project[]) => {
    const state = get()
    const ids = new Set(projects.map((project) => project.id))
    const roots = new Set(projects.map((project) => project.root))
    const known = new Set(state.projects.map((project) => project.id))
    const removed = new Set(
      state.projects.filter((project) => !ids.has(project.id)).map((project) => project.id),
    )
    const orphaned = state.sessions
      .filter((session) => session.chatId === null && !roots.has(session.projectRoot))
      .map((session) => session.id)
    // Their processes have all ended: a project cannot be removed while one runs.
    if (orphaned.length > 0 || removed.size > 0) removePages(new Set(orphaned), removed, projects)
    else set({ projects })
    set((current) => {
      // Forgotten as the main process forgets them.
      const collapsed = [...current.collapsedProjects].filter((id) => ids.has(id))
      return {
        worktrees: Object.fromEntries(
          Object.entries(current.worktrees).filter(([root]) => roots.has(root)),
        ),
        collapsedProjects:
          collapsed.length === current.collapsedProjects.size
            ? current.collapsedProjects
            : new Set(collapsed),
      }
    })
    if (!issuesRead || projects.some((project) => !known.has(project.id))) loadIssues()
  }

  /** Applies a project's worktrees as Git lists them now. */
  const applyWorktrees = (projectRoot: string, worktrees: WorktreeInfo[]) => {
    set((state) => ({
      worktrees: { ...state.worktrees, [projectRoot]: worktrees },
      knownWorktrees: {
        ...state.knownWorktrees,
        ...Object.fromEntries(worktrees.map((worktree) => [worktree.path, worktree])),
      },
    }))
  }

  /** Whether Delete was chosen and the worktree is being read again before it is checked. */
  let preparingDeletion = false

  /** Closes the ended sessions of a worktree that is gone, as its deletion does. */
  const closeEndedSessionsIn = (path: string) => {
    const ended = get()
      .sessions.filter((session) => session.worktreePath === path && !isSessionRunning(session))
      .map((session) => session.id)
    if (ended.length > 0) removeSessions(ended)
  }

  const selectAt = (index: number) => {
    const session = orderedSessions(get())[index]
    if (session) get().selectSession(session.id)
  }

  const selectRelative = (offset: 1 | -1) => {
    const order = orderedSessions(get()).map((session) => session.id)
    const id = relativeSession(order, currentSessionId(get()), offset)
    if (id !== null) get().selectSession(id)
  }

  /** Goes back (-1) or forward (1) among the pages shown. */
  const stepHistory = (offset: -1 | 1) => {
    const { history } = get()
    const stepped = step(history, offset)
    const page = stepped && currentEntry(stepped)
    if (!stepped || page === null) return
    getSessionTerminal(currentSessionId(get()))?.terminal.blur()
    if (isSettingsPage(page)) blurBeforeSettings()
    // The terminal view of a session takes the focus once it is shown.
    set({ history: stepped, currentPage: page, newIssueDialogOpen: false })
    expandProjectOf(page)
  }

  /**
   * Adds a session, which is shown at once unless `show` is false; its
   * terminal view starts the process with the size the terminal has on
   * screen, once it is shown. Returns its id.
   */
  const addSession = (
    projectRoot: string,
    toolId: ToolId,
    worktreePath: string | null,
    issueId: number | null = null,
    show = true,
    chat: ChatInfo | null = null,
  ): string => {
    const id = crypto.randomUUID()
    openTerminal(id)
    if (show) getSessionTerminal(currentSessionId(get()))?.terminal.blur()
    set((state) => ({
      sessions: [
        ...state.sessions,
        {
          id,
          projectRoot,
          worktreePath,
          chatId: chat?.id ?? null,
          toolId,
          issueId,
          status: 'starting',
          exit: null,
          title: chat?.title ?? '',
          workingSince: null,
          attention: null,
          turns: [],
          failure: null,
          unread: false,
          customName: chat?.customName ?? null,
          closing: false,
        },
      ],
      ...(show
        ? {
            currentPage: sessionPage(id),
            history: visit(state.history, sessionPage(id)),
            newIssueDialogOpen: false,
          }
        : {}),
    }))
    // Its row shows in the sidebar, also when its project was collapsed.
    expandProjectOf(sessionPage(id))
    return id
  }

  const closeCurrent = () => {
    const { closeConfirmation, quitConfirmation } = get()
    const id = currentSessionId(get())
    // While Hoot waits for an answer, ⌘W does not ask anything else; and
    // without a session shown, it closes nothing.
    if (id === null || closeConfirmation !== null || quitConfirmation !== null) return
    get().requestCloseSession(id)
  }

  /** Changes to issues not sent to the main process yet, by issue id. */
  const unsavedChanges = new Map<number, IssueChanges>()
  /** The saving of each issue under way, until all its changes are sent and answered. */
  const savings = new Map<number, Promise<void>>()

  /** Sends an issue's changes, one batch at a time, until none are left. */
  const saveIssue = async (issueId: number) => {
    try {
      for (
        let changes = unsavedChanges.get(issueId);
        changes;
        changes = unsavedChanges.get(issueId)
      ) {
        unsavedChanges.delete(issueId)
        const result = await api
          .updateIssue(issueId, changes)
          .catch((error: unknown) => ({ ok: false as const, message: errorMessage(error) }))
        if (result.ok) {
          // Changes made meanwhile still show.
          const saved = withChanges(result.issue, unsavedChanges.get(issueId))
          set((state) => ({ issues: withIssue(state.issues, saved) }))
          continue
        }
        toast.error('Could not save the issue.', { description: result.message })
        // Show the issue as it is saved.
        loadIssues()
      }
    } finally {
      savings.delete(issueId)
    }
  }

  /**
   * Marks the start of an issue's session as under way, or no longer: a
   * second click meanwhile does not start another.
   */
  const setIssueStart = (issueId: number, underWay: boolean) => {
    set((state) => ({
      issueStarts: underWay
        ? [...state.issueStarts, issueId]
        : state.issueStarts.filter((id) => id !== issueId),
    }))
  }

  /** Shows on an issue's start button whether a worktree is being created for it. */
  const setStarting = (issueId: number, starting: boolean) => {
    set((state) => {
      if (state.startingIssues.includes(issueId) === starting) return state
      return {
        startingIssues: starting
          ? [...state.startingIssues, issueId]
          : state.startingIssues.filter((id) => id !== issueId),
      }
    })
  }

  /** Changes to issues under way, so that a second click does not repeat one. */
  const issueRequests = new Set<string>()
  const once = async (key: string, request: () => Promise<void>) => {
    if (issueRequests.has(key)) return
    issueRequests.add(key)
    try {
      await request()
    } finally {
      issueRequests.delete(key)
    }
  }

  /** How each session opened from an issue is to start, by its id, until it starts. */
  const launchOptions = new Map<string, { by: LabelActor; prompt: string | null }>()
  /** The sessions whose process has been asked to start, which is asked only once. */
  const launchesRequested = new Set<string>()
  /**
   * The sessions being opened for each issue, one after another, so that a
   * second one finds the worktree the first created.
   */
  const issueSessionQueues = new Map<number, Promise<void>>()

  /** Runs `task` once the sessions opened for the issue before it have been. */
  const queuedForIssue = <T>(issueId: number, task: () => Promise<T>): Promise<T> => {
    const before = issueSessionQueues.get(issueId) ?? Promise.resolve()
    const run = before.then(task)
    const settled = run.then(
      () => {},
      () => {},
    )
    issueSessionQueues.set(issueId, settled)
    void settled.then(() => {
      if (issueSessionQueues.get(issueId) === settled) issueSessionQueues.delete(issueId)
    })
    return run
  }

  /**
   * Opens a session for an issue: saves the changes to the issue made so
   * far, then starts Claude Code, as the Agents page has it, in the issue's
   * worktree in the project it belongs to, after creating one when it has
   * none. A session for the user is shown once it is added and started by
   * its terminal view; one for an agent is started at once, without being
   * shown, and nothing is said in the window of why it could not start.
   */
  const openIssueSession = (
    issueId: number,
    { show, by, prompt }: { show: boolean; by: LabelActor; prompt: string | null },
  ): Promise<SessionStartAnswer> => {
    const quiet = by === 'agent'
    const identifier = issueIdentifier(issueId)
    return queuedForIssue(issueId, async () => {
      // The worktree is named after the issue as it is saved, which Claude Code is sent.
      for (const flush of issueEditorFlushes) flush()
      await get().whenIssueSaved(issueId)
      const saved = findIssue(issueId)
      if (!saved) return fail(`${identifier} no longer exists.`)
      const project = get().projects.find((candidate) => candidate.id === saved.projectId)
      if (!project) return fail(`${identifier} has no project, in which its worktree would be.`)
      // As Git lists them now, which the sidebar then shows too.
      let worktrees: WorktreeInfo[] | null
      try {
        worktrees = await api.readWorktrees(project.root)
      } catch (error) {
        if (!quiet) {
          toast.error(`Could not start work on ${identifier}.`, {
            description: errorMessage(error),
          })
        }
        return fail(errorMessage(error))
      }
      if (worktrees === null) return fail(`${project.name} is no longer in Hoot's list.`)
      let worktreePath = issueWorktree(worktrees, issueId)?.path ?? null
      if (worktreePath === null) {
        // Creating a worktree takes a while, which the start button shows.
        setStarting(issueId, true)
        try {
          const result = await api
            .createIssueWorktree(project.root, issueId)
            .catch((error: unknown) => ({
              ok: false as const,
              reason: 'failed' as const,
              message: errorMessage(error),
            }))
          if (!result.ok) {
            if (!quiet) failToCreateIssueWorktree(issueId, result)
            return fail(`Could not create a worktree for ${identifier}: ${result.message}`)
          }
          // Unless its project left the list meanwhile.
          if (!get().projects.some((candidate) => candidate.id === project.id)) {
            return fail(`${project.name} is no longer in Hoot's list.`)
          }
          if (result.warning && !quiet) warnAboutWorktree(result.warning)
          worktreePath = result.path
        } finally {
          setStarting(issueId, false)
        }
      }
      const id = addSession(project.root, 'claude', worktreePath, issueId, show)
      launchOptions.set(id, { by, prompt })
      if (show) return { ok: true, worktreePath }
      // Not shown, its terminal view does not start it: it starts with the terminal's size.
      const terminal = terminals.get(id)?.terminal
      const launched = await get().launchSession(id, terminal?.cols ?? 80, terminal?.rows ?? 24)
      return launched.ok ? { ok: true, worktreePath } : launched
    })
  }

  return {
    initialized: false,
    projects: [],
    worktrees: {},
    knownWorktrees: {},
    newWorktreeProject: null,
    worktreeDeletion: null,
    tools: { detecting: true, tools: [], error: null },
    agents: null,
    launchSettings: null,
    sessions: [],
    chats: [],
    startingIssues: [],
    issueStarts: [],
    currentPage: null,
    history: emptyHistory,
    issues: [],
    labels: { version: -1, groups: [], labels: [], issueLabels: [] },
    labelEvents: {},
    subIssues: { version: -1, links: [] },
    dependencies: { version: -1, links: [] },
    issuePicker: null,
    dependentIssueDialog: null,
    checkedProjects: [],
    checkedLabels: [],
    labelMatch: 'any',
    issueView: 'all',
    collapsedIssueGroups: [],
    newIssueDialogOpen: false,
    newIssueDraft: emptyNewIssueDraft,
    createMore: false,
    issueDeletion: null,
    renamingSessionId: null,
    renamingChatId: null,
    closeConfirmation: null,
    quitConfirmation: null,
    update: { kind: 'none' },
    updateCheck: null,
    appInfo: null,
    sidebarOpen: true,
    sidebarWidth: SIDEBAR_WIDTH.default,
    sidebarResizing: false,
    sidebarEdgeDragging: false,
    collapsedProjects: new Set(),
    fullScreen: false,
    windowFocused: false,
    appearance: DEFAULT_APPEARANCE,
    settingsSection: 'appearance',

    async initializeWindow() {
      api.onToggleSidebarRequested(() => get().setSidebarOpen(!get().sidebarOpen))
      api.onFullScreenChanged((fullScreen) => set({ fullScreen }))
      api.onWindowFocusChanged((windowFocused) => set({ windowFocused }))
      api.onAppearanceChanged((appearance) => set({ appearance }))
      const [{ sidebarOpen, sidebarWidth, collapsedProjects, fullScreen, focused }, appearance] =
        await Promise.all([api.getWindowState(), api.getAppearance()])
      set({
        sidebarOpen,
        sidebarWidth,
        collapsedProjects: new Set(collapsedProjects),
        fullScreen,
        windowFocused: focused,
        appearance,
      })
    },

    async initialize() {
      if (get().initialized) return
      set({ initialized: true })

      if (api.testHooks) {
        window.hootTestHooks = {
          get terminal() {
            return getSessionTerminal(currentSessionId(get()))?.terminal
          },
          terminalOf: (id) => terminals.get(id)?.terminal,
        }
      }

      // Every terminal, shown or not, takes the colors of the appearance in
      // effect when it changes: the one picked in the settings, or macOS's.
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        const scheme = systemColorScheme()
        for (const sessionTerminal of terminals.values()) {
          setTerminalColorScheme(sessionTerminal, scheme)
        }
      })
      api.onSessionData((id, data) => writeArrived(id, data))
      // Taken once the terminal has read what the session wrote before it,
      // such as the title Claude Code sets when a dialog opens.
      api.onSessionHookEvent((id, report) =>
        writeArrived(id, '', () => {
          const session = findSession(id)
          if (!session) return
          const change = afterHookEvent(session, report)
          if (Object.keys(change).length === 0) return
          set((state) => ({ sessions: updateSession(state.sessions, id, change) }))
        }),
      )
      api.onProjectsChanged(applyProjects)
      // An issue created by hoot in a session joins its project's issues, and
      // so shows wherever they show; nothing else changes.
      api.onIssueCreated((issue) =>
        set((state) =>
          state.projects.some((project) => project.id === issue.projectId) &&
          !state.issues.some((entry) => entry.id === issue.id)
            ? { issues: [...state.issues, issue] }
            : state,
        ),
      )
      // Wherever the change came from: hoot in a session, or this window.
      api.onLabelsChanged(applyLabels)
      api.onLabelEventsAdded(addLabelEvents)
      // As when Hoot completed an issue once its sub-issues were.
      api.onIssuesChanged(applyChangedIssues)
      // hoot asked for a session for an issue: started without being shown.
      api.onSessionStartRequested(({ requestId, issueId, prompt }) => {
        void get()
          .startSessionForAgent(issueId, prompt)
          .catch((error: unknown) => ({ ok: false as const, message: errorMessage(error) }))
          .then((answer) => api.answerSessionStart(requestId, answer))
      })
      // Wherever the change came from: hoot in a session, or this window.
      api.onSubIssuesChanged(applySubIssues)
      // Wherever the change came from: hoot in a session, or this window.
      api.onDependenciesChanged(applyDependencies)
      api.onToolsChanged((tools) => set({ tools }))
      api.onAgentsChanged((agents) => set({ agents }))
      // Set as soon as it arrives: a change reported after it is newer.
      void api.getAgents().then((agents) => set((state) => ({ agents: state.agents ?? agents })))
      api.onLaunchSettingsChanged((launchSettings) => set({ launchSettings }))
      api.onSessionUpdated((info) => {
        if (!findSession(info.id)) return
        set((state) => ({
          sessions: updateSession(state.sessions, info.id, {
            status: info.status,
            exit: info.exit,
          }),
        }))
        if (info.status !== 'exited') return
        const sessionTerminal = terminals.get(info.id)
        if (sessionTerminal) setTerminalInputEnabled(sessionTerminal, false)
        // A normal exit closes the session; any other end keeps it for reading.
        if (info.exit && isNormalExit(info.exit)) void get().closeSession(info.id)
      })
      api.onSessionCommand((command) => get().runMenuCommand(command))
      let chatsRead = false
      api.onChatsChanged((chats) => {
        chatsRead = true
        applyChats(chats)
      })
      api.onShowSettingsRequested(() => get().showSettings())
      api.onShowAboutRequested(() => get().showSettings('about'))
      api.onConfirmQuit((runningSessions, reason, agentOperations) =>
        set({ quitConfirmation: { runningSessions, reason, agentOperations } }),
      )
      api.onUpdateStatusChanged(({ state, check }) => set({ update: state, updateCheck: check }))
      api.onUpdateFailed((message) => {
        toast.error('Could not update Hoot.', { description: message })
      })
      // Set as soon as it arrives, not with the reads below: a change
      // reported after it is newer, and must not be overwritten by it.
      void api
        .getUpdateStatus()
        .then(({ state, check }) => set({ update: state, updateCheck: check }))
      void api.getAppInfo().then((appInfo) => set({ appInfo }))
      api.onAddProjectRequested(() => void get().addProject())
      // Changes reported while the list is read are newer than the list.
      const changedWorktrees = new Set<string>()
      api.onWorktreesChanged((root, worktrees) => {
        changedWorktrees.add(root)
        applyWorktrees(root, worktrees)
      })
      // Read in the background: listing worktrees waits for Git, the projects do not.
      void api.listWorktrees().then(
        (worktrees) => {
          for (const [root, list] of Object.entries(worktrees)) {
            if (!changedWorktrees.has(root)) applyWorktrees(root, list)
          }
        },
        (error: unknown) => console.error('Could not list the worktrees:', error),
      )

      const [projects, sessions, launchSettings, chats] = await Promise.all([
        api.listProjects(),
        api.listSessions(),
        api.getLaunchSettings(),
        api.listChats(),
      ])
      // A setting changed while this was read is reported by the change event, which is newer.
      set((state) => ({ launchSettings: state.launchSettings ?? launchSettings }))
      if (!chatsRead) applyChats(chats)
      applyProjects(projects)
      // After a reload of the window, show the sessions that are still there.
      const known = new Set(get().sessions.map((session) => session.id))
      const reloaded = sessions.filter((session) => !known.has(session.id))
      for (const session of reloaded) openTerminal(session.id)
      if (reloaded.length > 0) {
        const shown = get().currentPage
        set((state) => {
          const all = [
            ...state.sessions,
            ...reloaded.map((info) =>
              fromInfo(
                info,
                info.chatId === null
                  ? undefined
                  : state.chats.find((chat) => chat.id === info.chatId),
              ),
            ),
          ]
          const first = orderedSessions({ ...state, sessions: all })[0]
          const currentPage =
            state.currentPage ?? (first === undefined ? null : sessionPage(first.id))
          return {
            sessions: all,
            currentPage,
            history:
              currentPage === null || state.currentPage !== null
                ? state.history
                : visit(state.history, currentPage),
          }
        })
        if (shown === null) expandProjectOf(get().currentPage)
      }
      const tools = await api.getTools()
      set({ tools })
    },

    async addProject() {
      const result = await api.addProject()
      switch (result.kind) {
        case 'added': {
          const { projects } = get()
          if (!projects.some((project) => project.id === result.project.id)) {
            applyProjects([...projects, result.project])
          }
          toast.success('Project added.', { description: pathText(result.project.root) })
          break
        }
        case 'duplicate':
          toast.info('This project is already in the list.', {
            description: pathText(result.project.root),
          })
          break
        case 'bare':
          toast.error('Bare repositories are not supported yet.', {
            description: pathText(result.path),
          })
          break
        case 'unknown-main-worktree':
          toast.error(
            'The main worktree of this repository cannot be determined, so it is not supported yet.',
            { description: pathText(result.path) },
          )
          break
        case 'error':
          toast.error('Could not add the project.', { description: result.message })
          break
        case 'cancelled':
          break
      }
    },

    async removeProject(root) {
      const result = await api.removeProject(root)
      if (!result.ok) {
        toast.error('Could not remove the project.', { description: result.message })
        return
      }
      applyProjects(get().projects.filter((project) => project.root !== root))
    },

    async redetectTools() {
      set((state) => ({ tools: { ...state.tools, detecting: true } }))
      const tools = await api.redetectTools()
      set({ tools })
    },

    enterAgentsPage() {
      api.enterAgentsPage()
    },

    detectAgents() {
      api.detectAgents()
    },

    installAgent(id) {
      api.installAgent(id)
    },

    updateAgent(id) {
      api.updateAgent(id)
    },

    updateAllAgents() {
      api.updateAllAgents()
    },

    cancelAgentOperation(id) {
      api.cancelAgentOperation(id)
    },

    setDefaultAgent(id) {
      const launchSettings = withDefaultAgent(get().launchSettings, id)
      if (launchSettings !== null) set({ launchSettings })
      api.setDefaultAgent(id)
    },

    setYoloMode(on) {
      const launchSettings = withYoloMode(get().launchSettings, on)
      if (launchSettings !== null) set({ launchSettings })
      api.setYoloMode(on)
    },

    changeAgentLaunchSettings(id, change) {
      const launchSettings = withAgentLaunchSettingsChange(get().launchSettings, id, change)
      if (launchSettings !== null) set({ launchSettings })
      api.setAgentLaunchSettings(id, change)
    },

    newSession(projectRoot, toolId, worktreePath = null) {
      addSession(projectRoot, toolId, worktreePath, null)
    },

    async newChat(toolId) {
      const { tools, launchSettings } = get()
      // The first detection of the agents says which can start a chat; until
      // it has finished, a click does nothing.
      if (tools.detecting) return
      const agent = chatAgent(tools, launchSettings, toolId ?? null)
      if (agent === null) {
        toast.error('Could not start a chat.', {
          description: 'Install an agent or turn one on in the Agents page first.',
        })
        get().showSettings('agents')
        return
      }
      const result = await api
        .createChat(agent)
        .catch((error: unknown) => ({ ok: false as const, message: errorMessage(error) }))
      if (!result.ok) {
        toast.error('Could not start a chat.', { description: result.message })
        return
      }
      set((state) => ({
        chats: [result.chat, ...state.chats.filter((chat) => chat.id !== result.chat.id)],
      }))
      get().openChat(result.chat.id)
    },

    openChat(chatId) {
      const chat = get().chats.find((candidate) => candidate.id === chatId)
      if (!chat) return
      const running = get().sessions.find(
        (session) => session.chatId === chatId && isSessionRunning(session),
      )
      if (running) {
        // A chat that is running only shows its page, without another process.
        showPage(sessionPage(running.id))
        return
      }
      // An agent that ended unexpectedly leaves its page with the last output
      // and a Resume button; continuing it starts a new session.
      const ended = get().sessions.find((session) => session.chatId === chatId)
      if (ended) {
        void api.closeSession(ended.id)
        set((state) => ({
          sessions: state.sessions.filter((session) => session.id !== ended.id),
        }))
        // Its terminal goes once the new page is in place.
        setTimeout(() => {
          terminals.get(ended.id)?.terminal.dispose()
          terminals.delete(ended.id)
          arrivals.delete(ended.id)
        }, 0)
      }
      addSession(chat.folder, chat.toolId, null, null, true, chat)
    },

    resumeChat(chatId) {
      get().openChat(chatId)
    },

    closeChat(chatId) {
      const running = get().sessions.find(
        (session) => session.chatId === chatId && isSessionRunning(session),
      )
      if (running) get().requestCloseSession(running.id)
    },

    startRenamingChat(chatId) {
      if (get().chats.some((chat) => chat.id === chatId)) set({ renamingChatId: chatId })
    },

    finishRenamingChat(chatId, name) {
      set((state) => ({
        renamingChatId: state.renamingChatId === chatId ? null : state.renamingChatId,
        chats:
          name === null
            ? state.chats
            : state.chats.map((chat) =>
                chat.id === chatId ? { ...chat, customName: name === '' ? null : name } : chat,
              ),
        sessions:
          name === null
            ? state.sessions
            : state.sessions.map((session) =>
                session.chatId === chatId
                  ? { ...session, customName: name === '' ? null : name }
                  : session,
              ),
      }))
      if (name !== null) api.renameChat(chatId, name)
    },

    async startIssue(issueId) {
      const latest = latestIssueSession(get(), issueId)
      if (latest) {
        get().selectSession(latest.id)
        return
      }
      // Clicking again while the issue's session is being started does nothing.
      if (get().issueStarts.includes(issueId)) return
      const issue = findIssue(issueId)
      if (!issue || !isIssueOpen(issue)) return
      if (startBlockersOf(get(), issue).length > 0) return
      await get().startNewSession(issueId)
    },

    async startNewSession(issueId) {
      const issue = findIssue(issueId)
      if (!issue) return
      const blockers = startBlockersOf(get(), issue)
      if (blockers.length > 0) {
        toast.error(`Could not start a session for ${issueIdentifier(issueId)}.`, {
          description: blockers.map(startBlockerText).join(' '),
        })
        return
      }
      // Under way until its session shows, or until the start ends without one.
      setIssueStart(issueId, true)
      try {
        await openIssueSession(issueId, { show: true, by: 'user', prompt: null })
      } finally {
        setIssueStart(issueId, false)
      }
    },

    startSessionForAgent(issueId, prompt) {
      return openIssueSession(issueId, { show: false, by: 'agent', prompt })
    },

    async launchSession(id, cols, rows) {
      const session = findSession(id)
      if (!session || session.status !== 'starting' || session.closing) {
        return { ok: false, message: 'The session was closed before it started.' }
      }
      // Once, whether its terminal view or hoot's request starts it.
      if (launchesRequested.has(id)) return { ok: false, message: 'The session is starting.' }
      launchesRequested.add(id)
      const options = launchOptions.get(id)
      launchOptions.delete(id)
      const result = await api.startSession({
        id,
        projectRoot: session.projectRoot,
        worktreePath: session.worktreePath,
        ...(session.chatId === null ? {} : { chatId: session.chatId }),
        toolId: session.toolId,
        issueId: session.issueId,
        ...(options === undefined ? {} : { startedBy: options.by }),
        ...(options === undefined || options.prompt === null ? {} : { prompt: options.prompt }),
        cols,
        rows,
      })
      // Work on the issue has started: one in the backlog or to do is in progress now.
      if (result.ok && session.issueId !== null) {
        const issue = findIssue(session.issueId)
        const status = issue && statusOnceStarted(issue.status)
        if (issue && status && status !== issue.status) get().updateIssue(issue.id, { status })
      }
      const started = findSession(id)
      // Closed while it was starting.
      if (!started || started.closing) {
        return result.ok ? { ok: true } : { ok: false, message: result.message }
      }
      if (result.ok) {
        // Session events may already have moved the session on (it can exit right away).
        if (started.status === 'starting') {
          set((state) => ({
            sessions: updateSession(state.sessions, id, {
              status: result.session.status,
              exit: result.session.exit,
            }),
          }))
        }
        // Resizes made while the process was starting do not reach it, so pass
        // on the size the terminal has now if it changed since the start request.
        const size = terminals.get(id)?.terminal
        if (size && (size.cols !== cols || size.rows !== rows)) {
          api.resizeSession(id, size.cols, size.rows)
        }
        return { ok: true }
      }
      // hoot, which asked for it, says why.
      if (options?.by !== 'agent') {
        toast.error(`Could not start ${getTool(session.toolId).label}.`, {
          description: result.message,
        })
      }
      removeSessions([id])
      return { ok: false, message: result.message }
    },

    selectSession(id) {
      if (findSession(id)) showPage(sessionPage(id))
    },

    runShortcut(shortcut) {
      switch (shortcut.kind) {
        case 'select':
          selectAt(shortcut.index)
          break
        case 'next':
          selectRelative(1)
          break
        case 'previous':
          selectRelative(-1)
          break
        case 'back':
          stepHistory(-1)
          break
        case 'forward':
          stepHistory(1)
          break
        case 'close':
          closeCurrent()
          break
        case 'settings':
          get().showSettings()
          break
      }
    },

    runMenuCommand(command) {
      switch (command) {
        case 'new-chat':
          void get().newChat()
          break
        case 'close-current':
          closeCurrent()
          break
        case 'select-next':
          selectRelative(1)
          break
        case 'select-previous':
          selectRelative(-1)
          break
        case 'back':
          stepHistory(-1)
          break
        case 'forward':
          stepHistory(1)
          break
      }
    },

    goBack() {
      stepHistory(-1)
    },

    goForward() {
      stepHistory(1)
    },

    showSettings(section) {
      if (section) set({ settingsSection: section })
      if (isSettingsPage(get().currentPage)) return
      blurBeforeSettings()
      showPage(settingsPage)
    },

    selectSettingsSection(section) {
      set({ settingsSection: section })
    },

    leaveSettings() {
      const { currentPage, history } = get()
      if (!isSettingsPage(currentPage)) return
      if (canStep(history, -1)) {
        stepHistory(-1)
        return
      }
      set((state) => ({ currentPage: null, history: forget(state.history, isSettingsPage) }))
    },

    setAppearance(appearance) {
      if (appearance === get().appearance) return
      set({ appearance })
      api.setAppearance(appearance)
    },

    showIssueList() {
      showPage(issueListPage)
    },

    showProjectIssues(projectId) {
      if (!get().projects.some((project) => project.id === projectId)) return
      set({ checkedProjects: [projectId] })
      showPage(issueListPage)
    },

    setCheckedProjects(checked) {
      const { projects } = get()
      set({
        checkedProjects: checked.filter(
          (choice) => choice === null || projects.some((project) => project.id === choice),
        ),
      })
    },

    setCheckedLabels(checked) {
      const ids = new Set(get().labels.labels.map((label) => label.id))
      set({ checkedLabels: checked.filter((id) => ids.has(id)) })
    },

    setLabelMatch(match) {
      set({ labelMatch: match })
    },

    setIssueView(view) {
      set({ issueView: view })
    },

    setIssueGroupOpen(status, open) {
      set((state) => {
        const collapsed = state.collapsedIssueGroups.filter((entry) => entry !== status)
        return { collapsedIssueGroups: open ? collapsed : [...collapsed, status] }
      })
    },

    showIssue(issueId) {
      if (findIssue(issueId)) showPage(issuePage(issueId))
    },

    openNewIssue(projectId, preset = {}) {
      set((state) => {
        const draft = state.newIssueDraft
        // Once something is entered, the draft keeps the project it has.
        const started = draft.title !== '' || draft.description !== ''
        const listed =
          projectId !== null && state.projects.some((project) => project.id === projectId)
        return {
          newIssueDialogOpen: true,
          newIssueDraft: {
            ...draft,
            projectId: started ? draft.projectId : listed ? projectId : null,
            ...preset,
          },
        }
      })
    },

    closeNewIssue() {
      set({ newIssueDialogOpen: false })
    },

    updateNewIssueDraft(changes) {
      set((state) => ({ newIssueDraft: { ...state.newIssueDraft, ...changes } }))
    },

    setCreateMore(createMore) {
      set({ createMore })
    },

    async createIssue({ open = false } = {}) {
      let created: Issue | null = null
      await once('create', async () => {
        const draft = get().newIssueDraft
        const result = await api
          .createIssue(draft)
          .catch((error: unknown) => ({ ok: false as const, message: errorMessage(error) }))
        if (!result.ok) {
          toast.error('Could not create the issue.', { description: result.message })
          return
        }
        const { issue } = result
        // Unless its project left the list while the issue was being created.
        if (
          issue.projectId !== null &&
          !get().projects.some((project) => project.id === issue.projectId)
        ) {
          return
        }
        created = issue
        const more = get().createMore && !open
        set((state) => ({
          // Unless the issues were read again meanwhile, with it.
          issues: state.issues.some((entry) => entry.id === issue.id)
            ? state.issues
            : [...state.issues, issue],
          newIssueDraft: more
            ? { ...state.newIssueDraft, title: '', description: '' }
            : emptyNewIssueDraft,
          newIssueDialogOpen: more && state.newIssueDialogOpen,
        }))
        if (open) {
          get().showIssue(issue.id)
          return
        }
        toast.success(`${issueIdentifier(issue.id)} created`, {
          description: userText(issue.title),
          action: { label: 'View issue', onClick: () => get().showIssue(issue.id) },
        })
      })
      return created
    },

    updateIssue(issueId, changes) {
      const issue = findIssue(issueId)
      if (!issue) return
      set((state) => ({ issues: withIssue(state.issues, withChanges(issue, changes)) }))
      unsavedChanges.set(issueId, { ...unsavedChanges.get(issueId), ...changes })
      if (!savings.has(issueId)) savings.set(issueId, saveIssue(issueId))
    },

    whenIssueSaved(issueId) {
      return savings.get(issueId) ?? Promise.resolve()
    },

    requestDeleteIssue(issueId) {
      if (findIssue(issueId) && get().issueDeletion === null) set({ issueDeletion: issueId })
    },

    answerDeleteIssue(confirmed) {
      const issueId = get().issueDeletion
      if (issueId === null) return
      set({ issueDeletion: null })
      if (confirmed) void get().deleteIssue(issueId)
    },

    async deleteIssue(issueId) {
      await once(`delete:${issueId}`, async () => {
        const issue = findIssue(issueId)
        if (!issue) return
        // What is still to be saved would only fail to be.
        unsavedChanges.delete(issueId)
        await get().whenIssueSaved(issueId)
        const result = await api
          .deleteIssue(issueId)
          .catch((error: unknown) => ({ ok: false, message: errorMessage(error) }))
        if (!result.ok) {
          toast.error('Could not delete the issue.', { description: result.message })
          return
        }
        set((state) => {
          // Its activity went with it.
          const { [issueId]: _deleted, ...labelEvents } = state.labelEvents
          return {
            issues: state.issues.filter((entry) => entry.id !== issueId),
            labelEvents,
            issuePicker: state.issuePicker?.issueId === issueId ? null : state.issuePicker,
            dependentIssueDialog:
              state.dependentIssueDialog?.issueId === issueId ? null : state.dependentIssueDialog,
          }
        })
        // Its page has gone already if its project left the list meanwhile.
        const gone = (page: Page) => page.kind === 'issue' && page.issueId === issueId
        const { currentPage } = get()
        if (currentPage !== null && gone(currentPage)) {
          replacePages(gone, issueListPage)
        } else {
          set((state) => ({ history: forget(state.history, gone) }))
        }
      })
    },

    async createSubIssue(parentId, draft) {
      const result = await api
        .createSubIssue(parentId, draft)
        .catch((error: unknown) => ({ ok: false as const, message: errorMessage(error) }))
      if (!result.ok) {
        toast.error('Could not create the sub-issue.', { description: result.message })
        return null
      }
      const { issue } = result
      // Unless its project left the list while the issue was being created.
      if (
        issue.projectId !== null &&
        !get().projects.some((project) => project.id === issue.projectId)
      ) {
        return null
      }
      set((state) => ({
        // Unless the issues were read again meanwhile, with it.
        issues: state.issues.some((entry) => entry.id === issue.id)
          ? state.issues
          : [...state.issues, issue],
      }))
      return issue
    },

    async setIssueParents(changes, failure) {
      const result = await api
        .setIssueParents(changes)
        .catch((error: unknown) => ({ ok: false as const, message: errorMessage(error) }))
      if (!result.ok) toast.error(failure, { description: result.message })
      return result.ok
    },

    openIssuePicker(kind, issueId) {
      if (findIssue(issueId)) set({ issuePicker: { kind, issueId } })
    },

    closeIssuePicker() {
      set({ issuePicker: null })
    },

    async changeDependencies({ add = [], remove = [] }, failure) {
      const result = await api
        .changeDependencies({ add, remove })
        .catch((error: unknown) => ({ ok: false as const, message: errorMessage(error) }))
      if (!result.ok) toast.error(failure, { description: result.message })
      return result.ok
    },

    openDependentIssue(kind, issueId, title) {
      if (!findIssue(issueId)) return
      set({ issuePicker: null, dependentIssueDialog: { kind, issueId, title } })
    },

    closeDependentIssue() {
      set({ dependentIssueDialog: null })
    },

    async createDependentIssue(draft) {
      const dialog = get().dependentIssueDialog
      if (dialog === null) return null
      let created: Issue | null = null
      await once('create-dependent', async () => {
        const result = await api
          .createDependentIssue(
            draft,
            // From Blocked by…, the new issue blocks the dialog's issue.
            dialog.kind === 'blocked-by'
              ? { blocking: dialog.issueId }
              : { blockedBy: dialog.issueId },
          )
          .catch((error: unknown) => ({ ok: false as const, message: errorMessage(error) }))
        if (!result.ok) {
          toast.error('Could not create the issue.', { description: result.message })
          return
        }
        const { issue } = result
        set((state) => ({
          // Unless the issues were read again meanwhile, with it, or its project left the list.
          issues:
            state.issues.some((entry) => entry.id === issue.id) ||
            (issue.projectId !== null &&
              !state.projects.some((project) => project.id === issue.projectId))
              ? state.issues
              : [...state.issues, issue],
          dependentIssueDialog:
            state.dependentIssueDialog === dialog ? null : state.dependentIssueDialog,
        }))
        created = issue
        toast.success(`${issueIdentifier(issue.id)} created`, {
          description: userText(issue.title),
          action: { label: 'View issue', onClick: () => get().showIssue(issue.id) },
        })
      })
      return created
    },

    copyIssueIdentifier(issueId) {
      if (findIssue(issueId)) copyText(issueIdentifier(issueId))
    },

    copyIssueTitle(issueId) {
      const issue = findIssue(issueId)
      if (issue) copyText(issue.title)
    },

    async changeIssueLabels(issueId, { add = [], remove = [] }) {
      const result = await api
        .changeIssueLabels(issueId, { add, remove })
        .catch((error: unknown) => ({ ok: false as const, message: errorMessage(error) }))
      if (!result.ok) {
        toast.error(`Could not change the labels of ${issueIdentifier(issueId)}.`, {
          description: result.message,
        })
      }
      return result.ok
    },

    async createLabel(label) {
      const result = await api
        .createLabel(label)
        .catch((error: unknown) => ({ ok: false as const, message: errorMessage(error) }))
      if (!result.ok) toast.error('Could not create the label.', { description: result.message })
      return result.ok
    },

    async editLabel(id, changes) {
      const result = await api
        .editLabel(id, changes)
        .catch((error: unknown) => ({ ok: false as const, message: errorMessage(error) }))
      if (!result.ok) toast.error('Could not change the label.', { description: result.message })
      return result.ok
    },

    async deleteLabel(id) {
      const result = await api
        .deleteLabel(id)
        .catch((error: unknown) => ({ ok: false as const, message: errorMessage(error) }))
      if (!result.ok) toast.error('Could not delete the label.', { description: result.message })
      return result.ok
    },

    async createLabelGroup(name) {
      const result = await api
        .createLabelGroup(name)
        .catch((error: unknown) => ({ ok: false as const, message: errorMessage(error) }))
      if (!result.ok) toast.error('Could not create the group.', { description: result.message })
      return result.ok
    },

    async deleteLabelGroup(id) {
      const result = await api
        .deleteLabelGroup(id)
        .catch((error: unknown) => ({ ok: false as const, message: errorMessage(error) }))
      if (!result.ok) toast.error('Could not delete the group.', { description: result.message })
      return result.ok
    },

    setSidebarOpen(open) {
      const state = get()
      if (open === state.sidebarOpen || isSettingsPage(state.currentPage)) return
      set({ sidebarOpen: open })
      api.setSidebarOpen(open)
    },

    setSidebarWidth(width) {
      const within = sidebarWidthWithin(width)
      if (within === get().sidebarWidth) return
      set({ sidebarWidth: within })
      api.setSidebarWidth(within)
    },

    setSidebarResizing(resizing) {
      set({ sidebarResizing: resizing })
    },

    setSidebarEdgeDragging(dragging) {
      set({ sidebarEdgeDragging: dragging })
    },

    setProjectExpanded(projectId, expanded) {
      const { collapsedProjects } = get()
      if (collapsedProjects.has(projectId) === !expanded) return
      const collapsed = new Set(collapsedProjects)
      if (expanded) collapsed.delete(projectId)
      else collapsed.add(projectId)
      set({ collapsedProjects: collapsed })
      api.setProjectExpanded(projectId, expanded)
    },

    requestCloseSession(id) {
      const session = findSession(id)
      if (!session || session.closing) return
      if (!isSessionRunning(session)) {
        void get().closeSession(id)
        return
      }
      if (get().closeConfirmation === null) set({ closeConfirmation: id })
    },

    answerCloseConfirmation(confirmed) {
      const id = get().closeConfirmation
      if (id === null) return
      set({ closeConfirmation: null })
      if (confirmed) void get().closeSession(id)
    },

    async closeSession(id) {
      const session = findSession(id)
      if (!session || session.closing) return
      set((state) => ({
        sessions: updateSession(state.sessions, id, { closing: true }),
        renamingSessionId: state.renamingSessionId === id ? null : state.renamingSessionId,
      }))
      try {
        // Returns once the session's process, if it was still running, has ended.
        await api.closeSession(id)
      } finally {
        removeSessions([id])
      }
    },

    startRenaming(id) {
      if (findSession(id)) set({ renamingSessionId: id })
    },

    finishRenaming(id, name) {
      set((state) => ({
        renamingSessionId: state.renamingSessionId === id ? null : state.renamingSessionId,
        sessions:
          name === null
            ? state.sessions
            : updateSession(state.sessions, id, { customName: name === '' ? null : name }),
      }))
    },

    answerQuit(confirmed) {
      set({ quitConfirmation: null })
      api.respondToQuit(confirmed)
    },

    installUpdate() {
      api.installUpdate()
    },

    checkForUpdates() {
      const { update, updateCheck } = get()
      // The look starts at once, as the page asking for it shows: the main
      // process says so a moment later, or that it did not start one.
      if (
        updateCheck !== null &&
        updateCheck.kind !== 'unsupported' &&
        (update.kind === 'none' || update.kind === 'available')
      ) {
        set({ updateCheck: { kind: 'checking' } })
      }
      api.checkForUpdates()
    },

    openNewWorktreeDialog(projectRoot) {
      if (get().projects.some((project) => project.root === projectRoot)) {
        set({ newWorktreeProject: projectRoot })
      }
    },

    closeNewWorktreeDialog() {
      set({ newWorktreeProject: null })
    },
    requestDeleteWorktree(projectRoot, path) {
      if (get().worktreeDeletion !== null || preparingDeletion) return
      preparingDeletion = true
      void (async () => {
        // As it is now, which the sidebar then shows: gone, missing or locked
        // since the sidebar last showed it, it is neither checked nor deleted.
        let reason: string | null
        try {
          reason = whyNotDeletable(await api.currentWorktree(projectRoot, path))
        } catch (error) {
          reason = errorMessage(error)
        } finally {
          preparingDeletion = false
        }
        if (reason !== null) {
          toast.error('Could not delete the worktree.', { description: reason })
          return
        }
        const deletion: WorktreeDeletion = {
          projectRoot,
          path,
          phase: 'checking',
          inspection: null,
          error: null,
        }
        set({ worktreeDeletion: deletion })
        const result = await api
          .inspectWorktree(projectRoot, path)
          .catch((error: unknown) => ({ ok: false as const, message: errorMessage(error) }))
        if (get().worktreeDeletion !== deletion) return
        set({
          worktreeDeletion: result.ok
            ? { ...deletion, phase: 'confirm', inspection: result.inspection }
            : { ...deletion, phase: 'confirm', error: result.message },
        })
      })()
    },

    async answerDeleteWorktree(confirmed) {
      const deletion = get().worktreeDeletion
      if (deletion === null || deletion.phase === 'deleting') return
      if (!confirmed || deletion.phase !== 'confirm' || !deletion.inspection) {
        set({ worktreeDeletion: null })
        return
      }
      const deleting: WorktreeDeletion = { ...deletion, phase: 'deleting' }
      set({ worktreeDeletion: deleting })
      // Discarding is confirmed only for what the confirmation listed.
      const discard =
        deletion.inspection.changes.length > 0 || deletion.inspection.foreignRepositories.length > 0
      const result = await api
        .deleteWorktree(deletion.projectRoot, deletion.path, discard)
        .catch((error: unknown) => ({
          ok: false as const,
          reason: 'failed' as const,
          message: errorMessage(error),
          inspection: undefined,
        }))
      if (get().worktreeDeletion !== deleting) return
      if (result.ok) {
        set({ worktreeDeletion: null })
        closeEndedSessionsIn(deletion.path)
        return
      }
      // Something to lose appeared since the check: ask again, listing it.
      if (result.reason === 'changed' && result.inspection) {
        set({ worktreeDeletion: { ...deletion, phase: 'confirm', inspection: result.inspection } })
        return
      }
      set({ worktreeDeletion: { ...deletion, phase: 'confirm', error: result.message } })
    },

    async removeMissingWorktree(projectRoot, path) {
      const result = await api
        .removeWorktree(projectRoot, path)
        .catch((error: unknown) => ({ ok: false as const, message: errorMessage(error) }))
      if (!result.ok) {
        toast.error('Could not remove the worktree.', { description: result.message })
        return
      }
      closeEndedSessionsIn(path)
    },
  }
})

// A session Claude Code finished a turn in while it was not viewed is done
// until the user views it: shown while the window is the active one.
useAppStore.subscribe((state) => {
  const id = viewedSessionId(state)
  if (id !== null && state.sessions.some((session) => session.id === id && session.unread)) {
    useAppStore.setState({ sessions: updateSession(state.sessions, id, { unread: false }) })
  }
})

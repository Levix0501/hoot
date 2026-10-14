import { createElement, type ReactNode } from 'react'
import { toast } from 'sonner'
import { create } from 'zustand'
import { DEFAULT_APPEARANCE, type Appearance } from '../../shared/appearance'
import type { Project, SessionCommand, ToolsState } from '../../shared/ipc'
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
import type { PermissionLevelSettings } from '../../shared/permission-levels'
import {
  isNormalExit,
  type QuitReason,
  type SessionExit,
  type SessionInfo,
} from '../../shared/session'
import { SIDEBAR_WIDTH, sidebarWidthWithin } from '../../shared/sidebar-width'
import { getTool, type ToolId } from '../../shared/tools'
import type { UpdateState } from '../../shared/updates'
import type {
  CreateIssueWorktreeResult,
  WorktreeInfo,
  WorktreeInspection,
} from '../../shared/worktrees'
import { api } from '../lib/api'
import { startState } from '../lib/issue-start'
import type { ProjectChoice } from '../lib/project-choices'
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
import { currentAfterClosing, relativeSession, sidebarOrder } from './session-order'
import { worktreeRows, type WorktreeRow } from './worktree-rows'

/** A session as the window shows it. */
export interface UiSession {
  id: string
  projectRoot: string
  /** The root of the worktree it runs in, or `null` for the project's main worktree. */
  worktreePath: string | null
  toolId: ToolId
  /**
   * The issue whose start button started the session, which Claude Code is
   * sent when it starts; `null` for any other session.
   */
  issueId: number | null
  /**
   * The id of the permission level its tool is to start at, as it was picked
   * when the session was asked for; `null` for the one picked when it starts.
   */
  permissionLevel: string | null
  /**
   * `starting` covers the time until the process runs. A starting session
   * already counts as running.
   */
  status: 'starting' | 'running' | 'exited'
  exit: SessionExit | null
  /** The terminal title the session's program set last; empty until it sets one. */
  title: string
  /** The name the user gave the session, if any. */
  customName: string | null
  /** Set once the session is being closed, until it is gone. */
  closing: boolean
}

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
  /** The permission level selected for each coding tool; `null` until it is known. */
  permissionLevels: PermissionLevelSettings | null
  /** Every session, in the order they were started. */
  sessions: UiSession[]
  /**
   * The issues whose start button is creating a worktree for them, until
   * their session shows or creating it fails.
   */
  startingIssues: readonly number[]
  /** What the window shows; `null` for the empty page. */
  currentPage: Page | null
  /** The pages shown one after another, for going back and forward. */
  history: PageHistory
  /** The issues without a project, and those of the projects in the list. */
  issues: Issue[]
  /**
   * What is checked in the issue list's Project filter: projects of the list,
   * and `null` for No project. The list shows every issue while nothing is
   * checked, as when Hoot starts.
   */
  checkedProjects: ProjectChoice[]
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
  /** The session whose sidebar row shows the field for renaming it. */
  renamingSessionId: string | null
  /** A running session the user asked to close, while Hoot asks for confirmation. */
  closeConfirmation: string | null
  /**
   * While Hoot asks whether to quit, or to restart into an update: how many
   * sessions are running, and which of the two it asks.
   */
  quitConfirmation: { runningSessions: number; reason: QuitReason } | null
  /** Where Hoot is with a newer version of itself, which an Update button beside Settings offers. */
  update: UpdateState
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
  /** The projects collapsed in the sidebar, by id; every other project is expanded. */
  collapsedProjects: ReadonlySet<number>
  /** Whether the window is in full screen. */
  fullScreen: boolean
  /** The appearance picked in the settings. */
  appearance: Appearance

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
  /** Starts a session in the project's main worktree, or in one of its worktrees. */
  newSession(projectRoot: string, toolId: ToolId, worktreePath?: string | null): void
  /**
   * Starts work on an open issue, as its start button does. While a session
   * started from the issue is in the sidebar, shows that session, whatever
   * project the issue belongs to since. Otherwise, unless Claude Code or the
   * issue's project is missing, saves the changes to the issue made so far,
   * then starts Claude Code, at the permission level picked now, in the
   * issue's worktree in the project it belongs to, after creating one when it
   * has none; the session is shown once it is added, whatever page is shown
   * by then, and is sent the issue.
   */
  startIssue(issueId: number): Promise<void>
  launchSession(id: string, cols: number, rows: number): Promise<void>
  /** Shows a session and puts the keyboard focus in its terminal. */
  selectSession(id: string): void
  runShortcut(shortcut: SessionShortcut): void
  runMenuCommand(command: SessionCommand): void
  /** Shows the page shown before the current one, if any. */
  goBack(): void
  /** Shows the page shown after the current one, if any. */
  goForward(): void
  /** Shows the settings in place of the sidebar and the main area. */
  showSettings(): void
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
  /** Puts an issue's identifier, such as "ISS-12", on the clipboard. */
  copyIssueIdentifier(issueId: number): void
  copyIssueTitle(issueId: number): void
  /**
   * Expands or collapses the sidebar, and saves its state; not while the
   * settings are shown in its place.
   */
  setSidebarOpen(open: boolean): void
  /** Sets the sidebar's width, brought within its limits, and saves it. */
  setSidebarWidth(width: number): void
  setSidebarResizing(resizing: boolean): void
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

function fromInfo(info: SessionInfo): UiSession {
  return { ...info, permissionLevel: null, title: '', customName: null, closing: false }
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

/** Every session in sidebar order. */
export function orderedSessions(
  state: Pick<AppState, 'projects' | 'worktrees' | 'knownWorktrees' | 'sessions'>,
): UiSession[] {
  return sidebarOrder(state.projects, state.sessions, (root) =>
    projectWorktreeRows(state, root).map((row) => row.path),
  )
}

/** What the sidebar shows for a worktree: its branch, or its abbreviated commit. */
export function worktreeDisplayName(state: Pick<AppState, 'knownWorktrees'>, path: string): string {
  return state.knownWorktrees[path]?.displayName ?? path.split('/').filter(Boolean).at(-1) ?? path
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
 * shows no session.
 */
export function focusAfterOverlay(): HTMLElement | boolean {
  const id = currentSessionId(useAppStore.getState())
  if (id === null) return true
  // A terminal that is not on screen yet takes the focus once it is.
  return getSessionTerminal(id)?.terminal.textarea ?? false
}

/**
 * Before the settings take the place of the sidebar and the main area, what
 * has the keyboard focus gives it up as when another page takes it, such as
 * a session's name being edited, which keeps what was typed. Taken out of the
 * window with the focus, the name field would lose it.
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
    terminal.onTitleChange((title) => {
      if (findSession(id)?.title !== title) {
        set((state) => ({ sessions: updateSession(state.sessions, id, { title }) }))
      }
    })
    terminals.set(id, sessionTerminal)
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
        const order = orderedSessions(state).map((session) => session.id)
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
      }
    })
    if (sessionShown) expandProjectOf(get().currentPage)
    // Once the window no longer shows them.
    setTimeout(() => {
      for (const id of ids) {
        terminals.get(id)?.terminal.dispose()
        terminals.delete(id)
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

  /**
   * Reads the issues again, showing them with the changes to them not saved
   * yet; those of a project that has left the list by then stay out.
   */
  const loadIssues = () => {
    issuesRead = true
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
      .filter((session) => !roots.has(session.projectRoot))
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
   * Adds a session, which is shown at once; its terminal view starts the
   * process with the size the terminal has on screen.
   */
  const addSession = (
    projectRoot: string,
    toolId: ToolId,
    worktreePath: string | null,
    issueId: number | null = null,
    permissionLevel: string | null = null,
  ) => {
    const id = crypto.randomUUID()
    openTerminal(id)
    getSessionTerminal(currentSessionId(get()))?.terminal.blur()
    set((state) => ({
      sessions: [
        ...state.sessions,
        {
          id,
          projectRoot,
          worktreePath,
          toolId,
          issueId,
          permissionLevel,
          status: 'starting',
          exit: null,
          title: '',
          customName: null,
          closing: false,
        },
      ],
      currentPage: sessionPage(id),
      history: visit(state.history, sessionPage(id)),
      newIssueDialogOpen: false,
    }))
    expandProjectOf(sessionPage(id))
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

  /** The issues whose start is under way, so that a second click does not start another. */
  const issueStarts = new Set<number>()

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

  return {
    initialized: false,
    projects: [],
    worktrees: {},
    knownWorktrees: {},
    newWorktreeProject: null,
    worktreeDeletion: null,
    tools: { detecting: true, tools: [], error: null },
    permissionLevels: null,
    sessions: [],
    startingIssues: [],
    currentPage: null,
    history: emptyHistory,
    issues: [],
    checkedProjects: [],
    issueView: 'all',
    collapsedIssueGroups: [],
    newIssueDialogOpen: false,
    newIssueDraft: emptyNewIssueDraft,
    createMore: false,
    issueDeletion: null,
    renamingSessionId: null,
    closeConfirmation: null,
    quitConfirmation: null,
    update: { kind: 'none' },
    sidebarOpen: true,
    sidebarWidth: SIDEBAR_WIDTH.default,
    sidebarResizing: false,
    collapsedProjects: new Set(),
    fullScreen: false,
    appearance: DEFAULT_APPEARANCE,

    async initializeWindow() {
      api.onToggleSidebarRequested(() => get().setSidebarOpen(!get().sidebarOpen))
      api.onFullScreenChanged((fullScreen) => set({ fullScreen }))
      api.onAppearanceChanged((appearance) => set({ appearance }))
      const [{ sidebarOpen, sidebarWidth, collapsedProjects, fullScreen }, appearance] =
        await Promise.all([api.getWindowState(), api.getAppearance()])
      set({
        sidebarOpen,
        sidebarWidth,
        collapsedProjects: new Set(collapsedProjects),
        fullScreen,
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
      api.onSessionData((id, data) => terminals.get(id)?.terminal.write(data))
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
      api.onToolsChanged((tools) => set({ tools }))
      api.onPermissionLevelsChanged((permissionLevels) => set({ permissionLevels }))
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
      api.onShowSettingsRequested(() => get().showSettings())
      api.onConfirmQuit((runningSessions, reason) =>
        set({ quitConfirmation: { runningSessions, reason } }),
      )
      api.onUpdateStateChanged((update) => set({ update }))
      api.onUpdateFailed((message) => {
        toast.error('Could not update Hoot.', { description: message })
      })
      // Set as soon as it arrives, not with the reads below: a change
      // reported after it is newer, and must not be overwritten by it.
      void api.getUpdateState().then((update) => set({ update }))
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

      const [projects, sessions, permissionLevels] = await Promise.all([
        api.listProjects(),
        api.listSessions(),
        api.getPermissionLevels(),
      ])
      // A level selected while this was read is reported by the change event, which is newer.
      set((state) => ({ permissionLevels: state.permissionLevels ?? permissionLevels }))
      applyProjects(projects)
      // After a reload of the window, show the sessions that are still there.
      const known = new Set(get().sessions.map((session) => session.id))
      const reloaded = sessions.filter((session) => !known.has(session.id))
      for (const session of reloaded) openTerminal(session.id)
      if (reloaded.length > 0) {
        const shown = get().currentPage
        set((state) => {
          const all = [...state.sessions, ...reloaded.map(fromInfo)]
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

    newSession(projectRoot, toolId, worktreePath = null) {
      addSession(projectRoot, toolId, worktreePath, null)
    },

    async startIssue(issueId) {
      const started = get().sessions.find((session) => session.issueId === issueId)
      if (started) {
        get().selectSession(started.id)
        return
      }
      // Clicking again while the issue's session is being started does nothing.
      if (issueStarts.has(issueId)) return
      const state = get()
      const issue = findIssue(issueId)
      if (!issue || !isIssueOpen(issue)) return
      const expected = startState(issue, {
        sessionId: null,
        tools: state.tools,
        worktreePath: issueWorktreeOf(state, issue)?.path ?? null,
      })
      if (expected.kind !== 'worktree' && expected.kind !== 'new-worktree') return
      // The session starts at the level picked at the click, also when that
      // changes while its worktree is created.
      const permissionLevel = state.permissionLevels?.claude ?? null
      issueStarts.add(issueId)
      // Creating a worktree takes a while, which the button shows from the click.
      if (expected.kind === 'new-worktree') setStarting(issueId, true)
      try {
        // The worktree is named after the issue as it is saved, which Claude Code is sent.
        for (const flush of issueEditorFlushes) flush()
        await get().whenIssueSaved(issueId)
        const saved = findIssue(issueId)
        const project = get().projects.find((candidate) => candidate.id === saved?.projectId)
        if (!saved || !isIssueOpen(saved) || !project) return
        // As Git lists them now, which the sidebar then shows too.
        let worktrees: WorktreeInfo[] | null
        try {
          worktrees = await api.readWorktrees(project.root)
        } catch (error) {
          toast.error(`Could not start work on ${issueIdentifier(issueId)}.`, {
            description: errorMessage(error),
          })
          return
        }
        if (worktrees === null) return
        const worktree = issueWorktree(worktrees, issueId)
        if (worktree !== null) {
          setStarting(issueId, false)
          addSession(project.root, 'claude', worktree.path, issueId, permissionLevel)
          return
        }
        setStarting(issueId, true)
        const result = await api
          .createIssueWorktree(project.root, issueId)
          .catch((error: unknown) => ({
            ok: false as const,
            reason: 'failed' as const,
            message: errorMessage(error),
          }))
        if (!result.ok) {
          failToCreateIssueWorktree(issueId, result)
          return
        }
        // Unless its project left the list meanwhile.
        if (!get().projects.some((candidate) => candidate.id === project.id)) return
        // The new worktree's row shows below the project, also when it was collapsed.
        get().setProjectExpanded(project.id, true)
        if (result.warning) warnAboutWorktree(result.warning)
        addSession(project.root, 'claude', result.path, issueId, permissionLevel)
      } finally {
        issueStarts.delete(issueId)
        setStarting(issueId, false)
      }
    },

    async launchSession(id, cols, rows) {
      const session = findSession(id)
      if (!session || session.status !== 'starting' || session.closing) return
      const result = await api.startSession({
        id,
        projectRoot: session.projectRoot,
        worktreePath: session.worktreePath,
        toolId: session.toolId,
        issueId: session.issueId,
        ...(session.permissionLevel === null ? {} : { permissionLevel: session.permissionLevel }),
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
      if (!started || started.closing) return
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
        return
      }
      toast.error(`Could not start ${getTool(session.toolId).label}.`, {
        description: result.message,
      })
      removeSessions([id])
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

    showSettings() {
      if (isSettingsPage(get().currentPage)) return
      blurBeforeSettings()
      showPage(settingsPage)
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
        set((state) => ({ issues: state.issues.filter((entry) => entry.id !== issueId) }))
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

    copyIssueIdentifier(issueId) {
      if (findIssue(issueId)) copyText(issueIdentifier(issueId))
    },

    copyIssueTitle(issueId) {
      const issue = findIssue(issueId)
      if (issue) copyText(issue.title)
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

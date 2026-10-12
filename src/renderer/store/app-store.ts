import { createElement, type ReactNode } from 'react'
import { toast } from 'sonner'
import { create } from 'zustand'
import { DEFAULT_APPEARANCE, type Appearance } from '../../shared/appearance'
import type { Project, SessionCommand, ToolsState } from '../../shared/ipc'
import {
  isCompleted,
  isIssueOpen,
  issueIdentifier,
  issueTitle,
  type Issue,
  type IssueChanges,
  type IssuePriority,
  type IssueStatus,
  type IssueView,
} from '../../shared/issues'
import type { PermissionLevelSettings } from '../../shared/permission-levels'
import { isNormalExit, type SessionExit, type SessionInfo } from '../../shared/session'
import { getTool, type ToolId } from '../../shared/tools'
import type { WorktreeInfo, WorktreeInspection } from '../../shared/worktrees'
import { api } from '../lib/api'
import { sendBlockers } from '../lib/issue-sending'
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
  isIssuesPage,
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
  /** The issue sent to Claude Code when the session started, or `null` for any other session. */
  issueId: number | null
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

/** What is entered in a project's new issue dialog, before the issue is created. */
export interface NewIssueDraft {
  title: string
  /** Markdown. */
  description: string
  status: IssueStatus
  priority: IssuePriority
}

/** What a project's new issue dialog starts with: an issue in the backlog, without a priority. */
export const emptyNewIssueDraft: NewIssueDraft = {
  title: '',
  description: '',
  status: 'backlog',
  priority: 0,
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
  /** Each project's worktrees as Git lists them, by project root. */
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
  /** What the window shows; `null` for the empty page. */
  currentPage: Page | null
  /** The pages shown one after another, for going back and forward. */
  history: PageHistory
  /** The issues of the projects in the list. */
  issues: Issue[]
  /** The view each project's list showed last, by project id; all its issues until then. */
  issueViews: Record<number, IssueView>
  /** The status groups each project's list has collapsed, by project id. */
  collapsedIssueGroups: Record<number, IssueStatus[]>
  /**
   * The project whose new issue dialog is open. The dialog closes when the
   * page shown changes.
   */
  newIssueDialog: { projectId: number } | null
  /** What is entered in each project's new issue dialog, by project id, until Hoot quits. */
  newIssueDrafts: Record<number, NewIssueDraft>
  /** Whether the new issue dialog stays open after it creates an issue, for the next one. */
  createMore: boolean
  /** An issue the user asked to delete, while Hoot asks for confirmation. */
  issueDeletion: number | null
  /** The session whose sidebar row shows the field for renaming it. */
  renamingSessionId: string | null
  /** A running session the user asked to close, while Hoot asks for confirmation. */
  closeConfirmation: string | null
  /** While Hoot asks whether to quit: how many sessions are running. */
  quitConfirmation: { runningSessions: number } | null
  /** Whether the sidebar is expanded, also while the settings are shown in its place. */
  sidebarOpen: boolean
  /** The projects collapsed in the sidebar, by id; every other project is expanded. */
  collapsedProjects: ReadonlySet<number>
  /** Whether the window is in full screen. */
  fullScreen: boolean
  /** The user's home directory, which paths show as `~`. */
  homeDirectory: string
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
   * Sends an open issue to Claude Code, in a new session in its project's
   * main worktree, unless it cannot be sent now; the changes to it made so
   * far are saved first. While the session it was sent to before is still in
   * the sidebar, shows that session instead.
   */
  sendIssueToClaudeCode(issueId: number): Promise<void>
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
  /** Shows a project's issue list, with the view it showed last. */
  showIssueList(projectId: number): void
  /** Shows another view of a project's issue list; not recorded in the history. */
  setIssueView(projectId: number, view: IssueView): void
  /** Expands or collapses a status group of a project's issue list. */
  setIssueGroupOpen(projectId: number, status: IssueStatus, open: boolean): void
  showIssue(issueId: number): void
  /**
   * Opens a project's new issue dialog, with what was entered in it before;
   * `preset` sets the status or the priority to start from.
   */
  openNewIssue(
    projectId: number,
    preset?: Partial<Pick<NewIssueDraft, 'status' | 'priority'>>,
  ): void
  /** Closes the new issue dialog, keeping what is entered in it. */
  closeNewIssue(): void
  updateNewIssueDraft(projectId: number, changes: Partial<NewIssueDraft>): void
  setCreateMore(createMore: boolean): void
  /**
   * Creates an issue from what is entered in the project's new issue dialog,
   * and says so. The dialog closes, unless it is to create more, when it
   * keeps the status and the priority for the next issue; with `open`, it
   * shows the new issue instead. Settles with the new issue, or `null` when
   * none was created.
   */
  createIssue(projectId: number, options?: { open?: boolean }): Promise<Issue | null>
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
  /** Deletes an issue for good; its page, if shown, gives way to its project's list. */
  deleteIssue(issueId: number): Promise<void>
  /** Puts an issue's identifier, such as "HOO-12", on the clipboard. */
  copyIssueIdentifier(issueId: number): void
  copyIssueTitle(issueId: number): void
  /**
   * Expands or collapses the sidebar, and saves its state; not while the
   * settings are shown in its place.
   */
  setSidebarOpen(open: boolean): void
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
 * Whether a page shows a session among `ids`, or an Issues page of a project
 * among `projectIds`. The settings are never among them.
 */
function pageIn(page: Page, ids: ReadonlySet<string>, projectIds: ReadonlySet<number>): boolean {
  if (page.kind === 'session') return ids.has(page.sessionId)
  return isIssuesPage(page) && projectIds.has(page.projectId)
}

/** A record by id without the entries whose ids `gone` picks. */
function withoutIds<V>(
  record: Record<number, V>,
  gone: (id: number) => boolean,
): Record<number, V> {
  return Object.fromEntries(Object.entries(record).filter(([id]) => !gone(Number(id))))
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
  return { ...info, title: '', customName: null, closing: false }
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
      newIssueDialog: null,
    }))
  }

  /**
   * Takes the pages of closed sessions and removed projects out of the
   * window, and the closed sessions with their terminals. When the current
   * page is among them, a closed session gives way to the next session in
   * sidebar order (or the previous one when there is none after it), which
   * is recorded in the history; without another session, and for a removed
   * project's page, the page of the history's current entry is shown, or the
   * empty page without one.
   */
  const removePages = (
    ids: ReadonlySet<string>,
    projectIds: ReadonlySet<number> = new Set(),
    projects?: Project[],
  ) => {
    let sessionShown = false
    const gone = (page: Page) => pageIn(page, ids, projectIds)
    const keep = (id: string | null) => (id !== null && ids.has(id) ? null : id)
    set((state) => {
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
      const goneIssues = state.issues.filter((issue) => projectIds.has(issue.projectId))
      for (const issue of goneIssues) unsavedChanges.delete(issue.id)
      const dialog = state.newIssueDialog
      return {
        projects: projects ?? state.projects,
        sessions: state.sessions.filter((session) => !ids.has(session.id)),
        currentPage,
        history,
        renamingSessionId: keep(state.renamingSessionId),
        closeConfirmation: keep(state.closeConfirmation),
        // What was entered for a removed project's issues goes with it.
        issues: state.issues.filter((issue) => !projectIds.has(issue.projectId)),
        newIssueDrafts: withoutIds(state.newIssueDrafts, (id) => projectIds.has(id)),
        newIssueDialog:
          dialog === null || projectIds.has(dialog.projectId) || currentPage !== state.currentPage
            ? null
            : dialog,
        issueDeletion: goneIssues.some((issue) => issue.id === state.issueDeletion)
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
      return { currentPage: page, history: visit(history, page), newIssueDialog: null }
    })
  }

  /** Reads a project's issues, unless it has left the list by then. */
  const loadIssues = (projectId: number) => {
    void api.listIssues(projectId).then(
      (issues) =>
        set((state) =>
          state.projects.some((project) => project.id === projectId)
            ? {
                issues: [
                  ...state.issues.filter((issue) => issue.projectId !== projectId),
                  ...issues,
                ],
              }
            : state,
        ),
      (error: unknown) => console.error('Could not list the issues:', error),
    )
  }

  /**
   * Applies a new project list: the sessions of projects that left it are
   * closed, and their Issues pages go; a project that left it is expanded
   * when it is added again; the issues of projects new to it are read.
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
    for (const project of projects) if (!known.has(project.id)) loadIssues(project.id)
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
    set({ history: stepped, currentPage: page, newIssueDialog: null })
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
    issueId: number | null,
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
          status: 'starting',
          exit: null,
          title: '',
          customName: null,
          closing: false,
        },
      ],
      currentPage: sessionPage(id),
      history: visit(state.history, sessionPage(id)),
      newIssueDialog: null,
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
        const issue = findIssue(issueId)
        if (issue) loadIssues(issue.projectId)
      }
    } finally {
      savings.delete(issueId)
    }
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
    currentPage: null,
    history: emptyHistory,
    issues: [],
    issueViews: {},
    collapsedIssueGroups: {},
    newIssueDialog: null,
    newIssueDrafts: {},
    createMore: false,
    issueDeletion: null,
    renamingSessionId: null,
    closeConfirmation: null,
    quitConfirmation: null,
    sidebarOpen: true,
    collapsedProjects: new Set(),
    fullScreen: false,
    homeDirectory: '',
    appearance: DEFAULT_APPEARANCE,

    async initializeWindow() {
      api.onToggleSidebarRequested(() => get().setSidebarOpen(!get().sidebarOpen))
      api.onFullScreenChanged((fullScreen) => set({ fullScreen }))
      api.onAppearanceChanged((appearance) => set({ appearance }))
      const [{ sidebarOpen, collapsedProjects, fullScreen, homeDirectory }, appearance] =
        await Promise.all([api.getWindowState(), api.getAppearance()])
      set({
        sidebarOpen,
        collapsedProjects: new Set(collapsedProjects),
        fullScreen,
        homeDirectory,
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
      api.onConfirmQuit((runningSessions) => set({ quitConfirmation: { runningSessions } }))
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
        case 'not-git':
          toast.error('The selected folder is not in a Git repository.', {
            description: pathText(result.path),
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

    async sendIssueToClaudeCode(issueId) {
      const sent = get().sessions.find((session) => session.issueId === issueId)
      if (sent) {
        get().selectSession(sent.id)
        return
      }
      // Claude Code is sent the issue as it is saved.
      for (const flush of issueEditorFlushes) flush()
      await get().whenIssueSaved(issueId)
      const state = get()
      const issue = findIssue(issueId)
      const project = state.projects.find((candidate) => candidate.id === issue?.projectId)
      if (!issue || !project || !isIssueOpen(issue)) return
      if (sendBlockers(state.tools, issue).length > 0) return
      // Unless it was sent while its changes were saved.
      if (state.sessions.some((session) => session.issueId === issueId)) return
      addSession(project.root, 'claude', null, issue.id)
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
        cols,
        rows,
      })
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

    showIssueList(projectId) {
      if (get().projects.some((project) => project.id === projectId)) {
        showPage({ kind: 'issue-list', projectId })
      }
    },

    setIssueView(projectId, view) {
      set((state) => ({ issueViews: { ...state.issueViews, [projectId]: view } }))
    },

    setIssueGroupOpen(projectId, status, open) {
      set((state) => {
        const collapsed = (state.collapsedIssueGroups[projectId] ?? []).filter(
          (entry) => entry !== status,
        )
        return {
          collapsedIssueGroups: {
            ...state.collapsedIssueGroups,
            [projectId]: open ? collapsed : [...collapsed, status],
          },
        }
      })
    },

    showIssue(issueId) {
      const issue = findIssue(issueId)
      if (issue) showPage({ kind: 'issue', projectId: issue.projectId, issueId })
    },

    openNewIssue(projectId, preset = {}) {
      if (!get().projects.some((project) => project.id === projectId)) return
      set((state) => ({
        newIssueDialog: { projectId },
        newIssueDrafts: {
          ...state.newIssueDrafts,
          [projectId]: { ...(state.newIssueDrafts[projectId] ?? emptyNewIssueDraft), ...preset },
        },
      }))
    },

    closeNewIssue() {
      set({ newIssueDialog: null })
    },

    updateNewIssueDraft(projectId, changes) {
      set((state) => ({
        newIssueDrafts: {
          ...state.newIssueDrafts,
          [projectId]: { ...(state.newIssueDrafts[projectId] ?? emptyNewIssueDraft), ...changes },
        },
      }))
    },

    setCreateMore(createMore) {
      set({ createMore })
    },

    async createIssue(projectId, { open = false } = {}) {
      let created: Issue | null = null
      await once(`create:${projectId}`, async () => {
        const draft = get().newIssueDrafts[projectId] ?? emptyNewIssueDraft
        const result = await api
          .createIssue({ projectId, ...draft })
          .catch((error: unknown) => ({ ok: false as const, message: errorMessage(error) }))
        if (!result.ok) {
          toast.error('Could not create the issue.', { description: result.message })
          return
        }
        const { issue } = result
        // Unless the project left the list while the issue was being created.
        const project = get().projects.find((candidate) => candidate.id === projectId)
        if (!project) return
        created = issue
        const more = get().createMore && !open
        set((state) => ({
          issues: [...state.issues, issue],
          newIssueDrafts: more
            ? {
                ...state.newIssueDrafts,
                [projectId]: {
                  ...emptyNewIssueDraft,
                  status: draft.status,
                  priority: draft.priority,
                },
              }
            : withoutIds(state.newIssueDrafts, (id) => id === projectId),
          newIssueDialog: more ? state.newIssueDialog : null,
        }))
        if (open) {
          get().showIssue(issue.id)
          return
        }
        toast.success(`${issueIdentifier(project.name, issue.number)} created`, {
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
        // Its project's pages have gone already if the project left the list meanwhile.
        if (!get().projects.some((project) => project.id === issue.projectId)) return
        const gone = (page: Page) => page.kind === 'issue' && page.issueId === issueId
        const { currentPage } = get()
        if (currentPage !== null && gone(currentPage)) {
          replacePages(gone, { kind: 'issue-list', projectId: issue.projectId })
        } else {
          set((state) => ({ history: forget(state.history, gone) }))
        }
      })
    },

    copyIssueIdentifier(issueId) {
      const issue = findIssue(issueId)
      const project = get().projects.find((candidate) => candidate.id === issue?.projectId)
      if (issue && project) copyText(issueIdentifier(project.name, issue.number))
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

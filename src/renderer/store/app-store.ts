import { createElement, type ReactNode } from 'react'
import { toast } from 'sonner'
import { create } from 'zustand'
import type { Project, SessionCommand, ToolsState } from '../../shared/ipc'
import type { PermissionLevelSettings } from '../../shared/permission-levels'
import { isNormalExit, type SessionExit, type SessionInfo } from '../../shared/session'
import { getTool, type ToolId } from '../../shared/tools'
import type { WorktreeInfo, WorktreeInspection } from '../../shared/worktrees'
import { api } from '../lib/api'
import type { SessionShortcut } from '../lib/session-shortcuts'
import {
  createSessionTerminal,
  setTerminalColorScheme,
  setTerminalInputEnabled,
  systemColorScheme,
  type SessionTerminal,
} from '../terminal/session-terminal'
import {
  currentEntry,
  emptyHistory,
  forget,
  step,
  visit,
  type SessionHistory,
} from './session-history'
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
  /** The session shown in the window. Whenever there are sessions, one of them. */
  currentSessionId: string | null
  /** The sessions shown one after another, for going back and forward. */
  history: SessionHistory
  /** The session whose sidebar row shows the field for renaming it. */
  renamingSessionId: string | null
  /** A running session the user asked to close, while Hoot asks for confirmation. */
  closeConfirmation: string | null
  /** While Hoot asks whether to quit: how many sessions are running. */
  quitConfirmation: { runningSessions: number } | null
  /** Whether the sidebar is expanded. */
  sidebarOpen: boolean
  /** Whether the window is in full screen. */
  fullScreen: boolean

  /**
   * Reads the window's state and follows its changes. Called before the
   * first render, so that the sidebar opens as it was left, without sliding.
   */
  initializeWindow(): Promise<void>
  initialize(): Promise<void>
  addProject(): Promise<void>
  removeProject(root: string): Promise<void>
  redetectTools(): Promise<void>
  /** Starts a session in the project's main worktree, or in one of its worktrees. */
  newSession(projectRoot: string, toolId: ToolId, worktreePath?: string | null): void
  launchSession(id: string, cols: number, rows: number): Promise<void>
  /** Shows a session and puts the keyboard focus in its terminal. */
  selectSession(id: string): void
  runShortcut(shortcut: SessionShortcut): void
  runMenuCommand(command: SessionCommand): void
  /** Shows the session shown before the current one, if any. */
  goBack(): void
  /** Shows the session shown after the current one, if any. */
  goForward(): void
  /** Expands or collapses the sidebar, and saves its state. */
  setSidebarOpen(open: boolean): void
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
  getSessionTerminal(useAppStore.getState().currentSessionId)?.terminal.focus()
}

/**
 * Where a menu or dialog moves the keyboard focus when it closes: into the
 * current session's terminal, or where it would go anyway when there is none.
 */
export function focusAfterOverlay(): HTMLElement | boolean {
  const { currentSessionId } = useAppStore.getState()
  if (currentSessionId === null) return true
  // A terminal that is not on screen yet takes the focus once it is.
  return getSessionTerminal(currentSessionId)?.terminal.textarea ?? false
}

export const useAppStore = create<AppState>()((set, get) => {
  const findSession = (id: string) => get().sessions.find((session) => session.id === id)

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
   * Removes sessions from the window, together with their terminals. When the
   * current session is among them, the next session in sidebar order is shown,
   * or the previous one when there is none after it.
   */
  const removeSessions = (ids: readonly string[], projects?: Project[]) => {
    const removed = new Set(ids)
    let currentChanged = false
    set((state) => {
      const order = orderedSessions(state).map((session) => session.id)
      const currentSessionId = currentAfterClosing(order, state.currentSessionId, removed)
      currentChanged = currentSessionId !== state.currentSessionId
      // The history forgets the closed sessions before it records the one shown instead.
      const history = forget(state.history, removed)
      const keep = (id: string | null) => (id !== null && removed.has(id) ? null : id)
      return {
        projects: projects ?? state.projects,
        sessions: state.sessions.filter((session) => !removed.has(session.id)),
        currentSessionId,
        history:
          currentChanged && currentSessionId !== null ? visit(history, currentSessionId) : history,
        renamingSessionId: keep(state.renamingSessionId),
        closeConfirmation: keep(state.closeConfirmation),
      }
    })
    // Once the window no longer shows them.
    setTimeout(() => {
      for (const id of removed) {
        terminals.get(id)?.terminal.dispose()
        terminals.delete(id)
      }
      // A newly shown session's terminal takes the focus by itself. Otherwise
      // give the focus back to the terminal if what had it went away.
      const focused = document.activeElement
      if (!currentChanged && (focused === null || focused === document.body)) {
        focusCurrentTerminal()
      }
    }, 0)
  }

  /** Applies a new project list; sessions of projects that left it are closed. */
  const applyProjects = (projects: Project[]) => {
    const roots = new Set(projects.map((project) => project.root))
    const orphaned = get()
      .sessions.filter((session) => !roots.has(session.projectRoot))
      .map((session) => session.id)
    // Their processes have all ended: a project cannot be removed while one runs.
    if (orphaned.length > 0) removeSessions(orphaned, projects)
    else set({ projects })
    set((state) => ({
      worktrees: Object.fromEntries(
        Object.entries(state.worktrees).filter(([root]) => roots.has(root)),
      ),
    }))
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
    const id = relativeSession(order, get().currentSessionId, offset)
    if (id !== null) get().selectSession(id)
  }

  /** Goes back (-1) or forward (1) among the sessions shown. */
  const stepHistory = (offset: -1 | 1) => {
    const { history, currentSessionId } = get()
    const stepped = step(history, offset)
    const id = stepped && currentEntry(stepped)
    if (!stepped || id === null) return
    getSessionTerminal(currentSessionId)?.terminal.blur()
    // The terminal view of the session takes the focus once it is shown.
    set({ history: stepped, currentSessionId: id })
  }

  const closeCurrent = () => {
    const { currentSessionId, closeConfirmation, quitConfirmation } = get()
    // While Hoot waits for an answer, ⌘W does not ask anything else.
    if (currentSessionId === null || closeConfirmation !== null || quitConfirmation !== null) return
    get().requestCloseSession(currentSessionId)
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
    currentSessionId: null,
    history: emptyHistory,
    renamingSessionId: null,
    closeConfirmation: null,
    quitConfirmation: null,
    sidebarOpen: true,
    fullScreen: false,

    async initializeWindow() {
      api.onToggleSidebarRequested(() => get().setSidebarOpen(!get().sidebarOpen))
      api.onFullScreenChanged((fullScreen) => set({ fullScreen }))
      const { sidebarOpen, fullScreen } = await api.getWindowState()
      set({ sidebarOpen, fullScreen })
    },

    async initialize() {
      if (get().initialized) return
      set({ initialized: true })

      if (api.testHooks) {
        window.hootTestHooks = {
          get terminal() {
            return getSessionTerminal(get().currentSessionId)?.terminal
          },
          terminalOf: (id) => terminals.get(id)?.terminal,
        }
      }

      // Every terminal, shown or not, takes the colors of a new system appearance.
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
      set((state) => ({ projects, permissionLevels: state.permissionLevels ?? permissionLevels }))
      // After a reload of the window, show the sessions that are still there.
      const known = new Set(get().sessions.map((session) => session.id))
      const reloaded = sessions.filter((session) => !known.has(session.id))
      for (const session of reloaded) openTerminal(session.id)
      if (reloaded.length > 0) {
        set((state) => {
          const all = [...state.sessions, ...reloaded.map(fromInfo)]
          const currentSessionId =
            state.currentSessionId ?? orderedSessions({ ...state, sessions: all })[0]?.id ?? null
          return {
            sessions: all,
            currentSessionId,
            history:
              currentSessionId === null ? state.history : visit(state.history, currentSessionId),
          }
        })
      }
      const tools = await api.getTools()
      set({ tools })
    },

    async addProject() {
      const result = await api.addProject()
      switch (result.kind) {
        case 'added':
          set((state) =>
            state.projects.some((project) => project.root === result.project.root)
              ? state
              : { projects: [...state.projects, result.project] },
          )
          toast.success('Project added.', { description: pathText(result.project.root) })
          break
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
      const id = crypto.randomUUID()
      openTerminal(id)
      getSessionTerminal(get().currentSessionId)?.terminal.blur()
      // The new session is shown at once; its terminal view starts the process
      // with the size the terminal has on screen.
      set((state) => ({
        sessions: [
          ...state.sessions,
          {
            id,
            projectRoot,
            worktreePath,
            toolId,
            status: 'starting',
            exit: null,
            title: '',
            customName: null,
            closing: false,
          },
        ],
        currentSessionId: id,
        history: visit(state.history, id),
      }))
    },

    async launchSession(id, cols, rows) {
      const session = findSession(id)
      if (!session || session.status !== 'starting' || session.closing) return
      const result = await api.startSession({
        id,
        projectRoot: session.projectRoot,
        worktreePath: session.worktreePath,
        toolId: session.toolId,
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
      const { currentSessionId } = get()
      if (!findSession(id)) return
      if (id === currentSessionId) {
        focusCurrentTerminal()
        return
      }
      getSessionTerminal(currentSessionId)?.terminal.blur()
      // The terminal view of the session takes the focus once it is shown.
      set((state) => ({ currentSessionId: id, history: visit(state.history, id) }))
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

    setSidebarOpen(open) {
      if (open === get().sidebarOpen) return
      set({ sidebarOpen: open })
      api.setSidebarOpen(open)
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

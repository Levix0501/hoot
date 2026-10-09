import { createElement, type ReactNode } from 'react'
import { toast } from 'sonner'
import { create } from 'zustand'
import type { Project, SessionCommand, ToolsState } from '../../shared/ipc'
import type { PermissionLevelSettings } from '../../shared/permission-levels'
import { isNormalExit, type SessionExit, type SessionInfo } from '../../shared/session'
import { getTool, type ToolId } from '../../shared/tools'
import { api } from '../lib/api'
import type { SessionShortcut } from '../lib/session-shortcuts'
import {
  createSessionTerminal,
  setTerminalColorScheme,
  setTerminalInputEnabled,
  systemColorScheme,
  type SessionTerminal,
} from '../terminal/session-terminal'
import { currentAfterClosing, relativeSession, sidebarOrder } from './session-order'

/** A session as the window shows it. */
export interface UiSession {
  id: string
  projectRoot: string
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

export interface AppState {
  initialized: boolean
  projects: Project[]
  tools: ToolsState
  /** The permission level selected for each coding tool; `null` until it is known. */
  permissionLevels: PermissionLevelSettings | null
  /** Every session, in the order they were started. */
  sessions: UiSession[]
  /** The session shown in the window. Whenever there are sessions, one of them. */
  currentSessionId: string | null
  /** The session whose sidebar row shows the field for renaming it. */
  renamingSessionId: string | null
  /** A running session the user asked to close, while Hoot asks for confirmation. */
  closeConfirmation: string | null
  /** While Hoot asks whether to quit: how many sessions are running. */
  quitConfirmation: { runningSessions: number } | null

  initialize(): Promise<void>
  addProject(): Promise<void>
  removeProject(root: string): Promise<void>
  redetectTools(): Promise<void>
  newSession(projectRoot: string, toolId: ToolId): void
  launchSession(id: string, cols: number, rows: number): Promise<void>
  /** Shows a session and puts the keyboard focus in its terminal. */
  selectSession(id: string): void
  runShortcut(shortcut: SessionShortcut): void
  runMenuCommand(command: SessionCommand): void
  /** Closes a session, asking for confirmation first while it runs. */
  requestCloseSession(id: string): void
  answerCloseConfirmation(confirmed: boolean): void
  /** Closes a session without asking: ends its process if it runs, then removes it. */
  closeSession(id: string): Promise<void>
  startRenaming(id: string): void
  /** Ends renaming; `null` keeps the name as it was. */
  finishRenaming(id: string, name: string | null): void
  answerQuit(confirmed: boolean): void
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

/** True while a session is starting or running. */
export function isSessionRunning(session: UiSession): boolean {
  return session.status !== 'exited'
}

function fromInfo(info: SessionInfo): UiSession {
  return { ...info, title: '', customName: null, closing: false }
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
      const order = sidebarOrder(state.projects, state.sessions).map((session) => session.id)
      const currentSessionId = currentAfterClosing(order, state.currentSessionId, removed)
      currentChanged = currentSessionId !== state.currentSessionId
      const keep = (id: string | null) => (id !== null && removed.has(id) ? null : id)
      return {
        projects: projects ?? state.projects,
        sessions: state.sessions.filter((session) => !removed.has(session.id)),
        currentSessionId,
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
  }

  const selectAt = (index: number) => {
    const { projects, sessions } = get()
    const session = sidebarOrder(projects, sessions)[index]
    if (session) get().selectSession(session.id)
  }

  const selectRelative = (offset: 1 | -1) => {
    const { projects, sessions, currentSessionId } = get()
    const order = sidebarOrder(projects, sessions).map((session) => session.id)
    const id = relativeSession(order, currentSessionId, offset)
    if (id !== null) get().selectSession(id)
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
    tools: { detecting: true, tools: [], error: null },
    permissionLevels: null,
    sessions: [],
    currentSessionId: null,
    renamingSessionId: null,
    closeConfirmation: null,
    quitConfirmation: null,

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
          return {
            sessions: all,
            currentSessionId: state.currentSessionId ?? sidebarOrder(projects, all)[0]?.id ?? null,
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

    newSession(projectRoot, toolId) {
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
            toolId,
            status: 'starting',
            exit: null,
            title: '',
            customName: null,
            closing: false,
          },
        ],
        currentSessionId: id,
      }))
    },

    async launchSession(id, cols, rows) {
      const session = findSession(id)
      if (!session || session.status !== 'starting' || session.closing) return
      const result = await api.startSession({
        id,
        projectRoot: session.projectRoot,
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
      set({ currentSessionId: id })
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
      }
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
  }
})

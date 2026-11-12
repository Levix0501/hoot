import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { issueIdentifier, issuePasteParts } from '../../shared/issues'
import { getTool } from '../../shared/tools'
import { api } from '../lib/api'
import { ISSUE_DRAG_TYPE, useIssueDrag } from '../lib/issue-drag'
import {
  filePanelSlide,
  filePanelSlideEnded,
  sidebarSlide,
  sidebarSlideEnded,
} from '../lib/sidebar-slide'
import { getSessionTerminal, useAppStore } from '../store/app-store'
import { useFilesStore } from '../store/files-store'
import { droppedPathsText } from '../terminal/dropped-paths'
import { drawWithWebgl } from '../terminal/webgl-renderer'

/** Sessions whose process start has been requested, so it is requested only once. */
const launchedSessions = new Set<string>()

/**
 * Whether the terminal's width is changing: while the sidebar's edge is
 * dragged, while the sidebar slides, while an edge of the file panel is
 * dragged, and while the file panel slides.
 */
function sidebarMoving(): boolean {
  return (
    useAppStore.getState().sidebarResizing ||
    sidebarSlide().length > 0 ||
    useFilesStore.getState().resizing ||
    filePanelSlide().length > 0
  )
}

/** Resolves once the file panel's edge is let go of. */
function filePanelResizeEnded(): Promise<void> {
  return new Promise((resolve) => {
    const unsubscribe = useFilesStore.subscribe((state) => {
      if (state.resizing) return
      unsubscribe()
      resolve()
    })
  })
}

/** Resolves once the sidebar's edge is let go of. */
function sidebarResizeEnded(): Promise<void> {
  return new Promise((resolve) => {
    const unsubscribe = useAppStore.subscribe((state) => {
      if (state.sidebarResizing) return
      unsubscribe()
      resolve()
    })
  })
}

/** Resolves once the terminal's width has stopped changing. */
async function sidebarSettled(): Promise<void> {
  while (sidebarMoving()) {
    if (useAppStore.getState().sidebarResizing) await sidebarResizeEnded()
    else if (useFilesStore.getState().resizing) await filePanelResizeEnded()
    else if (sidebarSlide().length > 0) await sidebarSlideEnded()
    else await filePanelSlideEnded()
  }
}

/**
 * Whether what is dragged over a session's terminal can be dropped on it:
 * files or folders, while the session's process runs.
 */
function canDropFiles(sessionId: string, event: React.DragEvent): boolean {
  if (!event.dataTransfer.types.includes('Files')) return false
  const session = useAppStore.getState().sessions.find((entry) => entry.id === sessionId)
  return session?.status === 'running'
}

/**
 * Whether what is dragged over a session's terminal is an issue from the
 * Issues window that can be dropped on it: while an agent runs there, not a
 * Terminal session's shell.
 */
function canDropIssue(sessionId: string, event: React.DragEvent): boolean {
  if (!event.dataTransfer.types.includes(ISSUE_DRAG_TYPE)) return false
  const session = useAppStore.getState().sessions.find((entry) => entry.id === sessionId)
  return session?.status === 'running' && session.toolId !== 'shell'
}

/**
 * Shows a session's terminal, which exists for as long as the session: it is
 * moved here when the session is shown and keeps receiving output while it is not.
 * Files and folders dropped on it, as from Finder, reach its program as
 * their paths, pasted as a terminal application pastes them: an agent that
 * reads pastes, as Claude Code, Codex and OpenCode do, takes a dropped
 * picture as an attachment. An issue dragged from the Issues window onto an
 * agent's terminal is pasted into the agent's input, which says so while it
 * is over it; nothing is sent until the user sends it.
 */
export function TerminalView({ sessionId }: { sessionId: string }) {
  const hostRef = useRef<HTMLDivElement>(null)
  /** Whether an issue that can be dropped is over the terminal, and how many of its parts it is over. */
  const [issueOver, setIssueOver] = useState(false)
  const issueDepth = useRef(0)
  const draggedIssue = useIssueDrag((state) => state.issueId)
  const agent = useAppStore((state) => {
    const session = state.sessions.find((entry) => entry.id === sessionId)
    return session ? getTool(session.toolId).label : ''
  })
  // A drag that ends anywhere else, or is given up, takes the hint away.
  useEffect(
    () =>
      useIssueDrag.subscribe(({ issueId }) => {
        if (issueId !== null) return
        issueDepth.current = 0
        setIssueOver(false)
      }),
    [],
  )

  const allowDrop = (event: React.DragEvent) => {
    if (!canDropIssue(sessionId, event) && !canDropFiles(sessionId, event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const enter = (event: React.DragEvent) => {
    if (canDropIssue(sessionId, event)) {
      issueDepth.current += 1
      setIssueOver(true)
    }
    allowDrop(event)
  }

  const leave = (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes(ISSUE_DRAG_TYPE)) return
    issueDepth.current = Math.max(0, issueDepth.current - 1)
    if (issueDepth.current === 0) setIssueOver(false)
  }

  const drop = (event: React.DragEvent) => {
    if (canDropIssue(sessionId, event)) {
      event.preventDefault()
      issueDepth.current = 0
      setIssueOver(false)
      const id = Number(event.dataTransfer.getData(ISSUE_DRAG_TYPE))
      const issue = useAppStore.getState().issues.find((entry) => entry.id === id)
      const terminal = getSessionTerminal(sessionId)?.terminal
      if (!issue || !terminal) return
      // The focus first, as a click before a paste gives it. The drag took
      // it from the terminal, and Claude Code at times loses a paste that
      // the report of its coming back follows.
      terminal.focus()
      // As pastes, which the agent takes as text, not as keys that send it.
      for (const part of issuePasteParts(issue)) terminal.paste(part)
      return
    }
    if (!canDropFiles(sessionId, event)) return
    event.preventDefault()
    const terminal = getSessionTerminal(sessionId)?.terminal
    const paths = Array.from(event.dataTransfer.files, (file) => api.pathForFile(file))
    const text = droppedPathsText(paths, api.droppedPathQuoting)
    if (!terminal || text === '') return
    // As a paste, in brackets when the program asked for them, so that it
    // can tell the paths from typed text.
    terminal.paste(text)
    terminal.focus()
  }

  // A layout effect: the terminal is in place and fitted before the window
  // paints, and the terminal shown before has given up its WebGL renderer
  // before this one takes one.
  useLayoutEffect(() => {
    const host = hostRef.current
    const sessionTerminal = getSessionTerminal(sessionId)
    if (!host || !sessionTerminal) return
    const { terminal, fit } = sessionTerminal
    if (!terminal.element) terminal.open(host)
    else if (terminal.element.parentElement !== host) host.append(terminal.element)
    const renderer = drawWithWebgl(sessionTerminal)
    // Fill the area, which may have changed size while the session was not shown;
    // a new size reaches the session's process through the terminal's resize event.
    fit.fit()
    // While the sidebar or the file panel slides in or out, or an edge of
    // either is dragged, the area changes width on every frame: the grid
    // keeps its size until they are in place, then takes the area's new size
    // at once, so that its program redraws once.
    let shown = true
    let waiting = false
    const observer = new ResizeObserver(() => {
      if (!sidebarMoving()) {
        fit.fit()
        return
      }
      if (waiting) return
      waiting = true
      void sidebarSettled().then(() => {
        waiting = false
        if (shown) fit.fit()
      })
    })
    observer.observe(host)

    const session = useAppStore.getState().sessions.find((entry) => entry.id === sessionId)
    if (session?.status === 'starting' && !launchedSessions.has(sessionId)) {
      launchedSessions.add(sessionId)
      void useAppStore.getState().launchSession(sessionId, terminal.cols, terminal.rows)
    } else if (session?.status === 'running') {
      api.resizeSession(sessionId, terminal.cols, terminal.rows)
    }
    terminal.focus()

    return () => {
      shown = false
      observer.disconnect()
      renderer.dispose()
    }
  }, [sessionId])

  return (
    // The padding keeps the text clear of the main area's edges; the
    // scrollbar takes the right side, so less is left there.
    <div
      className="relative min-h-0 flex-1 bg-background pt-3 pr-1.5 pb-3 pl-3.5"
      data-testid="terminal-area"
      onDragEnter={enter}
      onDragLeave={leave}
      onDragOver={allowDrop}
      onDrop={drop}
    >
      <div ref={hostRef} className="size-full" data-testid="terminal" />
      {issueOver && (
        <div
          className="pointer-events-none absolute inset-1.5 flex items-center justify-center rounded-lg border-2 border-dashed border-primary/40 bg-primary/5"
          data-testid="terminal-issue-drop"
        >
          <span className="rounded-md bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10">
            Paste {draggedIssue === null ? 'the issue' : issueIdentifier(draggedIssue)} into {agent}
            's input · it won't be sent
          </span>
        </div>
      )}
    </div>
  )
}

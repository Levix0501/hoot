import { useLayoutEffect, useRef } from 'react'
import { api } from '../lib/api'
import { sidebarSlide, sidebarSlideEnded } from '../lib/sidebar-slide'
import { getSessionTerminal, useAppStore } from '../store/app-store'
import { drawWithWebgl } from '../terminal/webgl-renderer'

/** Sessions whose process start has been requested, so it is requested only once. */
const launchedSessions = new Set<string>()

/** Whether the sidebar's width is changing: while its edge is dragged, and while it slides. */
function sidebarMoving(): boolean {
  return useAppStore.getState().sidebarResizing || sidebarSlide().length > 0
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

/** Resolves once the sidebar's width has stopped changing. */
async function sidebarSettled(): Promise<void> {
  while (sidebarMoving()) {
    await (useAppStore.getState().sidebarResizing ? sidebarResizeEnded() : sidebarSlideEnded())
  }
}

/**
 * Shows a session's terminal, which exists for as long as the session: it is
 * moved here when the session is shown and keeps receiving output while it is not.
 */
export function TerminalView({ sessionId }: { sessionId: string }) {
  const hostRef = useRef<HTMLDivElement>(null)

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
    // While the sidebar slides in or out, or its edge is dragged, the area
    // changes width on every frame: the grid keeps its size until the
    // sidebar is in place, then takes the area's new size at once, so that
    // its program redraws once.
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
      className="min-h-0 flex-1 bg-background pt-3 pr-1.5 pb-3 pl-3.5"
      data-testid="terminal-area"
    >
      <div ref={hostRef} className="size-full" data-testid="terminal" />
    </div>
  )
}

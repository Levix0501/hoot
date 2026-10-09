import { useTheme } from 'next-themes'
import { useEffect, useRef } from 'react'
import { api } from '../lib/api'
import { getSessionTerminal, useAppStore } from '../store/app-store'
import { setTerminalColorScheme } from '../terminal/session-terminal'
import { terminalTheme } from '../terminal/themes'

/** Sessions whose process start has been requested, so it is requested only once. */
const launchedSessions = new Set<string>()

/**
 * Shows a session's terminal, which exists for as long as the session: it is
 * moved here when the session is shown and keeps receiving output while it is not.
 */
export function TerminalView({ sessionId }: { sessionId: string }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const { resolvedTheme } = useTheme()
  const scheme = resolvedTheme === 'dark' ? 'dark' : 'light'

  useEffect(() => {
    const host = hostRef.current
    const sessionTerminal = getSessionTerminal(sessionId)
    if (!host || !sessionTerminal) return
    const { terminal, fit } = sessionTerminal
    if (!terminal.element) terminal.open(host)
    else if (terminal.element.parentElement !== host) host.append(terminal.element)
    // Fill the area, which may have changed size while the session was not shown;
    // a new size reaches the session's process through the terminal's resize event.
    fit.fit()
    const observer = new ResizeObserver(() => fit.fit())
    observer.observe(host)

    const session = useAppStore.getState().sessions.find((entry) => entry.id === sessionId)
    if (session?.status === 'starting' && !launchedSessions.has(sessionId)) {
      launchedSessions.add(sessionId)
      void useAppStore.getState().launchSession(sessionId, terminal.cols, terminal.rows)
    } else if (session?.status === 'running') {
      api.resizeSession(sessionId, terminal.cols, terminal.rows)
    }
    terminal.focus()

    return () => observer.disconnect()
  }, [sessionId])

  useEffect(() => {
    const sessionTerminal = getSessionTerminal(sessionId)
    if (sessionTerminal) setTerminalColorScheme(sessionTerminal, scheme)
  }, [scheme, sessionId])

  return (
    <div
      className="min-h-0 flex-1 p-2 pr-0"
      style={{ backgroundColor: terminalTheme(scheme).background }}
      data-testid="terminal-area"
    >
      <div ref={hostRef} className="size-full" data-testid="terminal" />
    </div>
  )
}

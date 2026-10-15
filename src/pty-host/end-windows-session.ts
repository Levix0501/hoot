import { execFile } from 'node:child_process'
import path from 'node:path'
import type { IPty } from 'node-pty'

/** By its full path, so that no program of that name in the working directory runs instead. */
const TASKKILL = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe')

/** Sessions whose console node-pty has closed: closing it again would free it twice. */
const closed = new WeakSet<IPty>()

/**
 * Ends a session on Windows, which has neither signals nor process groups.
 * taskkill ends the session's process together with every process started
 * under it, found by its parent, as Claude Code ends its background commands
 * when it is quit with Ctrl+C. It runs first, while the session's process is
 * running: once a process has exited, those it started are no longer found
 * under it. node-pty then ends whatever else is attached to the session's
 * console, and closes the console.
 */
export function endWindowsSession(session: IPty): Promise<void> {
  return new Promise((resolve) => {
    const closeConsole = (): void => {
      if (!closed.has(session)) {
        closed.add(session)
        session.kill()
      }
      resolve()
    }
    if (session.pid > 0) {
      // When it fails, the process has exited already, or it cannot be ended.
      execFile(TASKKILL, ['/T', '/F', '/PID', String(session.pid)], () => closeConsole())
    } else {
      closeConsole()
    }
  })
}

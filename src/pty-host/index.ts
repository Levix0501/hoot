/**
 * Pty host: runs inside a dedicated Electron utility process and is the only
 * place where node-pty is loaded. The main process calls it over the utility
 * process message port (see `shared/pty-protocol`).
 */
import { createRequire } from 'node:module'
import { createBirpc } from 'birpc'
import type { IPty } from 'node-pty'
import type { PtyHostEvents, PtyHostFunctions } from '../shared/pty-protocol'
import { CONPTY_OPTIONS } from './conpty'
import { endWindowsSession } from './end-windows-session'

const require = createRequire(import.meta.url)
const pty = require('node-pty') as typeof import('node-pty')

const sessions = new Map<string, IPty>()

/** How often the program in a terminal's foreground is looked up, as in VS Code's pty host. */
const PROGRAM_POLL_MS = 200

/**
 * Reports the program in the foreground of a session's terminal, as VS
 * Code's pty host does for its terminal names: once the session has started,
 * then, outside Windows, whenever another takes its place. Windows tells no
 * foreground program, so there it is the file the session started, once.
 * Returns what stops the reports.
 */
function reportProgram(id: string, child: IPty, file: string): () => void {
  // After the answer to the spawn, which the main process waits for.
  if (process.platform === 'win32') {
    const once = setTimeout(() => void main.program(id, file))
    return () => clearTimeout(once)
  }
  let reported: string | undefined
  const report = () => {
    let name: string | undefined
    try {
      name = child.process
    } catch {
      // The terminal is closing.
      return
    }
    // None while the terminal has no foreground process.
    if (!name || name === reported) return
    reported = name
    void main.program(id, name)
  }
  const first = setTimeout(report)
  const poll = setInterval(report, PROGRAM_POLL_MS)
  return () => {
    clearTimeout(first)
    clearInterval(poll)
  }
}

const functions: PtyHostFunctions = {
  spawn(request) {
    const child = pty.spawn(request.file, request.args, {
      name: 'xterm-256color',
      cols: request.cols,
      rows: request.rows,
      cwd: request.cwd,
      env: request.env,
      encoding: 'utf8',
      ...CONPTY_OPTIONS,
    })
    sessions.set(request.id, child)
    child.onData((data) => void main.data(request.id, data))
    const stopReporting = request.reportProgram
      ? reportProgram(request.id, child, request.file)
      : () => {}
    child.onExit(({ exitCode, signal }) => {
      stopReporting()
      sessions.delete(request.id)
      void main.exit(request.id, exitCode, signal ?? 0)
    })
    return child.pid
  },
  write(id, data, binary) {
    sessions.get(id)?.write(binary ? Buffer.from(data, 'binary') : data)
  },
  resize(id, cols, rows) {
    try {
      sessions.get(id)?.resize(cols, rows)
    } catch {
      // The process may have exited between the request and the resize.
    }
  },
  kill(id, signal) {
    const session = sessions.get(id)
    if (!session) return
    if (process.platform === 'win32') {
      void endWindowsSession(session)
      return
    }
    // The session process leads its own process group; signal the whole group
    // so that processes it started in that group end as well.
    try {
      process.kill(-session.pid, signal)
    } catch {
      session.kill(signal)
    }
  },
}

const main = createBirpc<PtyHostEvents, PtyHostFunctions>(functions, {
  post: (message) => process.parentPort.postMessage(message),
  on: (handler) => process.parentPort.on('message', (event) => handler(event.data)),
  eventNames: ['data', 'exit', 'program'],
})

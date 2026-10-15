/**
 * Pty host: runs inside a dedicated Electron utility process and is the only
 * place where node-pty is loaded. The main process calls it over the utility
 * process message port (see `shared/pty-protocol`).
 */
import { createRequire } from 'node:module'
import { createBirpc } from 'birpc'
import type { IPty } from 'node-pty'
import type { PtyHostEvents, PtyHostFunctions } from '../shared/pty-protocol'
import { endWindowsSession } from './end-windows-session'

const require = createRequire(import.meta.url)
const pty = require('node-pty') as typeof import('node-pty')

const sessions = new Map<string, IPty>()

const functions: PtyHostFunctions = {
  spawn(request) {
    const child = pty.spawn(request.file, request.args, {
      name: 'xterm-256color',
      cols: request.cols,
      rows: request.rows,
      cwd: request.cwd,
      env: request.env,
      encoding: 'utf8',
    })
    sessions.set(request.id, child)
    child.onData((data) => void main.data(request.id, data))
    child.onExit(({ exitCode, signal }) => {
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
  eventNames: ['data', 'exit'],
})

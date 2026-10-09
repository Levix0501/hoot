import { EventEmitter, once } from 'node:events'
import { createBirpc, type BirpcReturn } from 'birpc'
import { utilityProcess, type UtilityProcess } from 'electron'
import type { PtyHostEvents, PtyHostFunctions, PtySpawnRequest } from '../../shared/pty-protocol'

export const PTY_HOST_SERVICE_NAME = 'Hoot pty host'

type PtyHostRpc = BirpcReturn<PtyHostFunctions, PtyHostEvents>

interface Connection {
  child: UtilityProcess
  rpc: PtyHostRpc
  ready: Promise<void>
}

export interface PtyHostClientEvents {
  data: [id: string, data: string]
  exit: [id: string, exitCode: number, signal: number]
  /** The utility process ended; `expected` is false when it was not asked to stop. */
  'host-exit': [code: number, expected: boolean]
}

/**
 * Owns the pty host utility process. The process is started on demand and is
 * started again for the next session if it ever stops.
 */
export class PtyHostClient extends EventEmitter<PtyHostClientEvents> {
  private connection: Connection | null = null
  private stopping = false

  constructor(private readonly modulePath: string) {
    super()
  }

  get pid(): number | undefined {
    return this.connection?.child.pid
  }

  async spawn(request: PtySpawnRequest): Promise<number> {
    const { rpc, ready } = this.connect()
    await ready
    return rpc.spawn(request)
  }

  write(id: string, data: string, binary: boolean): void {
    void this.connection?.rpc.write(id, data, binary)
  }

  resize(id: string, cols: number, rows: number): void {
    void this.connection?.rpc.resize(id, cols, rows)
  }

  kill(id: string, signal: string): void {
    void this.connection?.rpc.kill(id, signal)
  }

  /** Stops the utility process and waits until it has exited. */
  async stop(): Promise<void> {
    const connection = this.connection
    if (!connection) return
    this.stopping = true
    const exited = once(connection.child, 'exit')
    connection.child.kill()
    // An 'error' event rejects the wait; the process is ending then as well.
    await exited.catch(() => undefined)
  }

  private connect(): Connection {
    if (this.connection) return this.connection
    this.stopping = false
    const child = utilityProcess.fork(this.modulePath, [], {
      serviceName: PTY_HOST_SERVICE_NAME,
      stdio: 'inherit',
    })
    const rpc = createBirpc<PtyHostFunctions, PtyHostEvents>(
      {
        data: (id, data) => this.emit('data', id, data),
        exit: (id, exitCode, signal) => this.emit('exit', id, exitCode, signal),
      },
      {
        post: (message) => child.postMessage(message),
        on: (handler) => child.on('message', handler),
        eventNames: ['write', 'resize', 'kill'],
      },
    )
    const ready = new Promise<void>((resolve, reject) => {
      child.once('spawn', () => resolve())
      child.once('exit', (code) => reject(new Error(`The terminal host exited with code ${code}.`)))
    })
    // Avoid an unhandled rejection when the process exits after starting.
    ready.catch(() => undefined)

    child.on('exit', (code) => {
      if (this.connection?.child === child) this.connection = null
      rpc.$close(new Error('The terminal host stopped unexpectedly.'))
      const expected = this.stopping
      this.stopping = false
      this.emit('host-exit', code, expected)
    })
    this.connection = { child, rpc, ready }
    return this.connection
  }
}

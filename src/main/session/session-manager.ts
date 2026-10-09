import { EventEmitter } from 'node:events'
import os from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import type { StartSessionRequest } from '../../shared/ipc'
import type { PtySpawnRequest } from '../../shared/pty-protocol'
import type { SessionExit, SessionInfo } from '../../shared/session'
import type { ToolId } from '../../shared/tools'
import type { Env } from '../env/env'

export interface SessionLaunch {
  file: string
  args: string[]
  env: Env
}

/** The subset of the pty host client the session manager depends on. */
export interface PtyHost {
  spawn(request: PtySpawnRequest): Promise<number>
  write(id: string, data: string, binary: boolean): void
  resize(id: string, cols: number, rows: number): void
  kill(id: string, signal: string): void
  on(event: 'data', listener: (id: string, data: string) => void): unknown
  on(event: 'exit', listener: (id: string, exitCode: number, signal: number) => void): unknown
  on(event: 'host-exit', listener: (code: number, expected: boolean) => void): unknown
}

export interface SessionManagerOptions {
  host: PtyHost
  resolveLaunch(toolId: ToolId, projectRoot: string): Promise<SessionLaunch>
  /** Sends a signal to a process group; replaceable for tests. */
  signalProcessGroup?: (pid: number, signal: NodeJS.Signals) => void
  /** How long to wait for a process to exit after SIGHUP before using SIGKILL. */
  killTimeoutMs?: number
}

export class SessionError extends Error {}

interface SessionRecord {
  info: SessionInfo
  /** True until the session's process has been started. */
  starting: boolean
  /** Settles once the start has finished, whether or not the process started. */
  started: Promise<void>
  pid: number | null
  /** Set once the session is being closed; settles when it is gone. */
  closing: Promise<void> | null
  exitWaiters: Array<() => void>
}

export function signalName(signal: number): string {
  const entry = Object.entries(os.constants.signals).find(([, value]) => value === signal)
  return entry ? entry[0] : `signal ${signal}`
}

function defaultSignalProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal)
  } catch {
    // The group no longer exists.
  }
}

/**
 * Tracks every session Hoot runs: starting each one, routing its input and
 * output, ending its process when it is closed or Hoot quits, and marking the
 * running ones ended when the pty host stops.
 */
export class SessionManager extends EventEmitter<{
  data: [id: string, data: string]
  updated: [session: SessionInfo]
}> {
  /** In the order the sessions were started. */
  private readonly records = new Map<string, SessionRecord>()
  private readonly killTimeoutMs: number
  private readonly signalProcessGroup: (pid: number, signal: NodeJS.Signals) => void

  constructor(private readonly options: SessionManagerOptions) {
    super()
    this.killTimeoutMs = options.killTimeoutMs ?? 2_000
    this.signalProcessGroup = options.signalProcessGroup ?? defaultSignalProcessGroup
    options.host.on('data', (id, data) => {
      if (this.records.has(id)) this.emit('data', id, data)
    })
    options.host.on('exit', (id, exitCode, signal) => {
      this.markExited(id, {
        code: signal > 0 ? null : exitCode,
        signal: signal > 0 ? signalName(signal) : null,
        abnormal: false,
      })
    })
    options.host.on('host-exit', () => this.handleHostExit())
  }

  /** The sessions whose process has started, oldest first. */
  list(): SessionInfo[] {
    return [...this.records.values()]
      .filter((record) => !record.starting)
      .map((record) => ({ ...record.info }))
  }

  /** How many sessions are starting or running. */
  runningCount(): number {
    return [...this.records.values()].filter(isRunning).length
  }

  hasRunningSession(): boolean {
    return this.runningCount() > 0
  }

  /** Whether a session of the project is starting or running. */
  isRunningIn(projectRoot: string): boolean {
    return [...this.records.values()].some(
      (record) => record.info.projectRoot === projectRoot && isRunning(record),
    )
  }

  async start(request: StartSessionRequest): Promise<SessionInfo> {
    if (this.records.has(request.id)) throw new SessionError('The session already exists.')
    const { promise: started, resolve: settle } = Promise.withResolvers<void>()
    const record: SessionRecord = {
      info: {
        id: request.id,
        projectRoot: request.projectRoot,
        toolId: request.toolId,
        status: 'running',
        exit: null,
      },
      starting: true,
      started,
      pid: null,
      closing: null,
      exitWaiters: [],
    }
    this.records.set(request.id, record)
    try {
      const launch = await this.options.resolveLaunch(request.toolId, request.projectRoot)
      if (record.closing) throw new SessionError('The session was closed before it started.')
      try {
        record.pid = await this.options.host.spawn({
          id: request.id,
          file: launch.file,
          args: launch.args,
          cwd: request.projectRoot,
          env: launch.env,
          cols: request.cols,
          rows: request.rows,
        })
      } catch (error) {
        throw new SessionError(
          `Could not start the session: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
      record.starting = false
      const info = { ...record.info }
      this.emit('updated', info)
      return info
    } catch (error) {
      if (this.records.get(request.id) === record) this.records.delete(request.id)
      throw error
    } finally {
      settle()
    }
  }

  write(id: string, data: string, binary: boolean): void {
    const record = this.records.get(id)
    if (record && !record.starting && record.info.status === 'running') {
      this.options.host.write(id, data, binary)
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const record = this.records.get(id)
    if (record && !record.starting && record.info.status === 'running') {
      this.options.host.resize(id, cols, rows)
    }
  }

  /**
   * Closes a session: ends its process if it is still starting or running,
   * waits until the process has exited, and forgets the session.
   */
  close(id: string): Promise<void> {
    const record = this.records.get(id)
    if (!record) return Promise.resolve()
    record.closing ??= (async () => {
      // A process that is still starting is ended as soon as it runs.
      await record.started
      if (this.records.get(id) !== record) return
      if (record.info.status === 'running') await this.terminate(record)
      this.records.delete(id)
    })()
    return record.closing
  }

  /** Forgets the ended sessions of a project that is removed from the list. */
  forgetProject(projectRoot: string): void {
    for (const [id, record] of this.records) {
      if (record.info.projectRoot === projectRoot && !isRunning(record)) this.records.delete(id)
    }
  }

  /**
   * Ends the process of every running session, when Hoot quits. Sessions that
   * are still starting are ended as soon as their process runs.
   */
  async endAll(): Promise<void> {
    const ending = [...this.records.values()].map((record) => {
      const closed = this.close(record.info.id)
      return record.starting ? Promise.resolve() : closed
    })
    await Promise.all(ending)
  }

  /** Ends a running session's process group: SIGHUP first, then SIGKILL. */
  private async terminate(record: SessionRecord): Promise<void> {
    const id = record.info.id
    const exited = this.waitForExit(record)
    this.options.host.kill(id, 'SIGHUP')
    if (await this.within(exited, this.killTimeoutMs)) return
    this.options.host.kill(id, 'SIGKILL')
    if (record.pid) this.signalProcessGroup(record.pid, 'SIGKILL')
    await this.within(exited, this.killTimeoutMs)
  }

  private waitForExit(record: SessionRecord): Promise<void> {
    if (record.info.status !== 'running') return Promise.resolve()
    return new Promise((resolve) => record.exitWaiters.push(resolve))
  }

  private async within(promise: Promise<void>, ms: number): Promise<boolean> {
    let done = false
    await Promise.race([promise.then(() => (done = true)), delay(ms)])
    return done
  }

  private markExited(id: string, exit: SessionExit): void {
    const record = this.records.get(id)
    if (!record || record.info.status !== 'running') return
    record.info = { ...record.info, status: 'exited', exit }
    for (const resolve of record.exitWaiters.splice(0)) resolve()
    // A session that is still starting reports its state once the start completes.
    if (!record.starting) this.emit('updated', { ...record.info })
  }

  private handleHostExit(): void {
    for (const record of this.records.values()) {
      if (record.starting || record.info.status !== 'running') continue
      // The pty host owned the session's terminal. Make sure nothing it started
      // keeps running without it.
      if (record.pid) {
        const pid = record.pid
        this.signalProcessGroup(pid, 'SIGHUP')
        setTimeout(() => this.signalProcessGroup(pid, 'SIGKILL'), this.killTimeoutMs).unref()
      }
      this.markExited(record.info.id, { code: null, signal: null, abnormal: true })
    }
  }
}

function isRunning(record: SessionRecord): boolean {
  return record.starting || record.info.status === 'running'
}

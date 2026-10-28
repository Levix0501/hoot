import { EventEmitter } from 'node:events'
import os from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import type { HookEventReport } from '../../shared/hoot-cli'
import type { StartSessionRequest } from '../../shared/ipc'
import type { PtySpawnRequest } from '../../shared/pty-protocol'
import type { SessionExit, SessionInfo } from '../../shared/session'
import { isWithin } from '../../shared/worktrees'
import type { ToolId } from '../../shared/tools'
import type { Env } from '../env/env'
import type { ChatLaunch, SentIssue } from './launch'

export interface SessionLaunch {
  file: string
  args: string[]
  env: Env
  /**
   * Removes what the launch made for the session, such as the file of the
   * issue it sends, once the session's process has ended or did not start.
   */
  cleanup?: () => void
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
  /**
   * Decides what a session runs in its working directory, given the issue it
   * sends Claude Code, if any, and the session's id.
   */
  resolveLaunch(
    toolId: ToolId,
    cwd: string,
    issue: SentIssue | null,
    chat: ChatLaunch | null,
    sessionId: string,
  ): Promise<SessionLaunch>
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
  /** The launch's cleanup, until it has run. */
  cleanup: (() => void) | null
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
 * output and the events of its Claude Code's hooks, ending its process when it
 * is closed or Hoot quits, and marking the running ones ended when the pty
 * host stops. `closed` reports a session that started once it is gone: closed,
 * or forgotten with its worktree or project.
 */
export class SessionManager extends EventEmitter<{
  data: [id: string, data: string]
  input: [id: string, data: string]
  updated: [session: SessionInfo]
  'hook-event': [id: string, report: HookEventReport]
  closed: [session: SessionInfo]
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

  /** The ids of a tool's sessions that are starting or running. */
  runningIdsOf(toolId: ToolId): string[] {
    return [...this.records.values()]
      .filter((record) => record.info.toolId === toolId && isRunning(record))
      .map((record) => record.info.id)
  }

  hasRunningSession(): boolean {
    return this.runningCount() > 0
  }

  /**
   * The root of the project of a session that is starting, running, or has
   * ended without being closed; `null` for any other id.
   */
  projectRootOf(id: string): string | null {
    return this.records.get(id)?.info.projectRoot ?? null
  }

  /** The chat whose agent the session runs, if any. */
  chatIdOf(id: string): string | null {
    return this.records.get(id)?.info.chatId ?? null
  }

  /** The saved session whose agent the session runs, if any. */
  savedSessionIdOf(id: string): string | null {
    return this.records.get(id)?.info.savedSessionId ?? null
  }

  /** Whether a session of the project, in its main worktree or any other, is starting or running. */
  isRunningIn(projectRoot: string): boolean {
    return [...this.records.values()].some(
      (record) => record.info.projectRoot === projectRoot && isRunning(record),
    )
  }

  /**
   * Whether a session of a project's worktree, other than a chat, is open:
   * starting, running, or ended without being closed, as its tab stays.
   */
  hasOpenIn(projectRoot: string, worktreePath: string): boolean {
    return [...this.records.values()].some(
      (record) =>
        record.info.chatId === null &&
        record.info.projectRoot === projectRoot &&
        record.info.worktreePath === worktreePath,
    )
  }

  /**
   * The sessions starting or running in a directory or below it, other than
   * chats: in a worktree with this root, say, or in a project's worktree
   * inside it.
   */
  runningIdsWithin(directory: string): string[] {
    return [...this.records.values()]
      .filter(
        (record) =>
          isRunning(record) &&
          record.info.chatId === null &&
          isWithin(record.info.worktreePath ?? record.info.projectRoot, directory),
      )
      .map((record) => record.info.id)
  }

  /**
   * Closes the sessions starting or running in a directory or below it (see
   * `runningIdsWithin`), as before a worktree with this root is deleted:
   * settles once their processes have ended.
   */
  async closeRunningWithin(directory: string): Promise<void> {
    await Promise.all(this.runningIdsWithin(directory).map((id) => this.close(id)))
  }

  /**
   * Closes the open sessions of a project's worktree, other than chats (see
   * `hasOpenIn`), as before a worktree that is gone is removed: settles once
   * their processes have ended.
   */
  async closeIn(projectRoot: string, worktreePath: string): Promise<void> {
    const ids = [...this.records.values()]
      .filter(
        (record) =>
          record.info.chatId === null &&
          record.info.projectRoot === projectRoot &&
          record.info.worktreePath === worktreePath,
      )
      .map((record) => record.info.id)
    await Promise.all(ids.map((id) => this.close(id)))
  }

  /**
   * Closes the sessions of a chat or saved session, by its id, whether they
   * are starting, running or ended, as before it is deleted: settles once
   * their processes have ended.
   */
  async closeOf(chatId: string): Promise<void> {
    const ids = [...this.records.values()]
      .filter((record) => record.info.chatId === chatId || record.info.savedSessionId === chatId)
      .map((record) => record.info.id)
    await Promise.all(ids.map((id) => this.close(id)))
  }

  /**
   * Starts a session; `issue` is what it sends Claude Code when it starts
   * from the start button of the issue the request names.
   */
  async start(
    request: StartSessionRequest,
    issue: SentIssue | null = null,
    chat: ChatLaunch | null = null,
  ): Promise<SessionInfo> {
    if (this.records.has(request.id)) throw new SessionError('The session already exists.')
    const { promise: started, resolve: settle } = Promise.withResolvers<void>()
    const record: SessionRecord = {
      info: {
        id: request.id,
        projectRoot: request.projectRoot,
        worktreePath: request.worktreePath,
        chatId: request.chatId ?? null,
        savedSessionId: request.savedSessionId ?? null,
        toolId: request.toolId,
        issueId: request.issueId,
        status: 'running',
        exit: null,
      },
      starting: true,
      started,
      pid: null,
      closing: null,
      exitWaiters: [],
      cleanup: null,
    }
    this.records.set(request.id, record)
    // A session in a worktree runs in the worktree's root.
    const cwd = request.worktreePath ?? request.projectRoot
    try {
      const launch = await this.options.resolveLaunch(request.toolId, cwd, issue, chat, request.id)
      record.cleanup = launch.cleanup ?? null
      if (record.closing) throw new SessionError('The session was closed before it started.')
      try {
        record.pid = await this.options.host.spawn({
          id: request.id,
          file: launch.file,
          args: launch.args,
          cwd,
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
      cleanUp(record)
      if (this.records.get(request.id) === record) this.records.delete(request.id)
      throw error
    } finally {
      settle()
    }
  }

  /**
   * Passes on an event of a hook of a running Claude Code session, in order
   * with its output: from what the session wrote before the event was
   * reported, and before what it writes after.
   */
  reportHookEvent(id: string, report: HookEventReport): void {
    const record = this.records.get(id)
    if (
      record &&
      !record.starting &&
      record.info.status === 'running' &&
      record.info.toolId === 'claude'
    ) {
      this.emit('hook-event', id, report)
    }
  }

  write(id: string, data: string, binary: boolean): void {
    const record = this.records.get(id)
    if (record && !record.starting && record.info.status === 'running') {
      this.options.host.write(id, data, binary)
      // What the user types, for a chat or saved session: the messages it
      // sends, and the commands that leave its conversation for another.
      if (!binary && (record.info.chatId !== null || record.info.savedSessionId !== null)) {
        this.emit('input', id, data)
      }
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
      // Also when the process did not report its exit in time.
      cleanUp(record)
      this.drop(id, record)
    })()
    return record.closing
  }

  /** Forgets the ended sessions of a project that is removed from the list. */
  forgetProject(projectRoot: string): void {
    for (const [id, record] of this.records) {
      if (record.info.projectRoot === projectRoot && !isRunning(record)) this.drop(id, record)
    }
  }

  /** Forgets the ended sessions of a worktree that is removed. */
  forgetWorktree(worktreePath: string): void {
    for (const [id, record] of this.records) {
      if (record.info.worktreePath === worktreePath && !isRunning(record)) this.drop(id, record)
    }
  }

  /**
   * Forgets the ended sessions in a directory or below it, other than chats,
   * as when the worktree with this root is deleted, and with it a project's
   * worktree inside it.
   */
  forgetWithin(directory: string): void {
    for (const [id, record] of this.records) {
      if (
        !isRunning(record) &&
        record.info.chatId === null &&
        isWithin(record.info.worktreePath ?? record.info.projectRoot, directory)
      ) {
        this.drop(id, record)
      }
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

  /** Forgets a session, which is gone now. */
  private drop(id: string, record: SessionRecord): void {
    if (this.records.get(id) !== record) return
    this.records.delete(id)
    this.emit('closed', { ...record.info })
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
    cleanUp(record)
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

/** Runs the launch's cleanup once. A cleanup that fails leaves the session as it is. */
function cleanUp(record: SessionRecord): void {
  const cleanup = record.cleanup
  record.cleanup = null
  try {
    cleanup?.()
  } catch {
    // What it could not remove stays behind.
  }
}

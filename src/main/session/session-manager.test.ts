import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { SessionInfo } from '../../shared/session'
import type { SentIssue } from './launch'
import {
  SessionError,
  SessionManager,
  signalName,
  type PtyHost,
  type SessionLaunch,
} from './session-manager'

class FakeHost extends EventEmitter implements PtyHost {
  spawned: Array<Parameters<PtyHost['spawn']>[0]> = []
  written: Array<[string, string, boolean]> = []
  resized: Array<[string, number, number]> = []
  killed: Array<[string, string]> = []
  nextPid = 100
  failSpawn: Error | null = null
  /** Exit the process as soon as it receives this signal. */
  exitOn: string | null = 'SIGHUP'

  async spawn(request: Parameters<PtyHost['spawn']>[0]): Promise<number> {
    if (this.failSpawn) throw this.failSpawn
    this.spawned.push(request)
    return this.nextPid++
  }
  write(id: string, data: string, binary: boolean): void {
    this.written.push([id, data, binary])
  }
  resize(id: string, cols: number, rows: number): void {
    this.resized.push([id, cols, rows])
  }
  kill(id: string, signal: string): void {
    this.killed.push([id, signal])
    if (signal === this.exitOn || signal === 'SIGKILL') {
      setTimeout(() => this.emit('exit', id, 0, signal === 'SIGKILL' ? 9 : 1), 1)
    }
  }
}

function setup(
  options: {
    killTimeoutMs?: number
    resolveLaunch?: (
      toolId: string,
      cwd: string,
      issue: SentIssue | null,
      sessionId: string,
    ) => Promise<SessionLaunch>
  } = {},
) {
  const host = new FakeHost()
  const signals: Array<[number, string]> = []
  const manager = new SessionManager({
    host,
    resolveLaunch:
      options.resolveLaunch ??
      (async (toolId) => ({
        file: toolId === 'shell' ? '/bin/zsh' : toolId,
        args: toolId === 'shell' ? ['-l'] : [],
        env: { PATH: '/bin' },
      })),
    signalProcessGroup: (pid, signal) => signals.push([pid, signal]),
    killTimeoutMs: options.killTimeoutMs ?? 50,
  })
  const updates: SessionInfo[] = []
  manager.on('updated', (session) => updates.push(session))
  return { host, manager, updates, signals }
}

const request = (
  id: string,
  toolId: 'shell' | 'claude' = 'shell',
  projectRoot = '/work/project',
  worktreePath: string | null = null,
  issueId: number | null = null,
) => ({
  id,
  projectRoot,
  worktreePath,
  toolId,
  issueId,
  cols: 80,
  rows: 24,
})

/** A launch that resolves only when `release` is called. */
function pendingLaunch() {
  const { promise: launched, resolve: release } = Promise.withResolvers<void>()
  return {
    release,
    resolveLaunch: async (toolId: string): Promise<SessionLaunch> => {
      await launched
      return { file: toolId, args: [], env: {} }
    },
  }
}

/**
 * Launches for the sessions s1, s2 and s3, started in that order, whose
 * cleanup counts its runs per session. They can be held back, and their
 * cleanup can fail.
 */
function cleanedLaunches(options: { held?: Promise<void>; failing?: boolean } = {}) {
  const runs = new Map<string, number>()
  let next = 0
  const ids = ['s1', 's2', 's3']
  return {
    runs,
    resolveLaunch: async (toolId: string): Promise<SessionLaunch> => {
      const id = ids[next++]
      await options.held
      return {
        file: toolId,
        args: [],
        env: {},
        cleanup: () => {
          runs.set(id, (runs.get(id) ?? 0) + 1)
          if (options.failing) throw new Error('EACCES')
        },
      }
    },
  }
}

describe('SessionManager', () => {
  it('starts a session in the project root with the launch command', async () => {
    const { host, manager } = setup()
    const session = await manager.start(request('s1', 'claude'))
    expect(session).toEqual({
      id: 's1',
      projectRoot: '/work/project',
      worktreePath: null,
      toolId: 'claude',
      issueId: null,
      status: 'running',
      exit: null,
    })
    expect(host.spawned[0]).toMatchObject({
      file: 'claude',
      args: [],
      cwd: '/work/project',
      cols: 80,
      rows: 24,
    })
    expect(manager.hasRunningSession()).toBe(true)
    expect(manager.isRunningIn('/work/project')).toBe(true)
    expect(manager.isRunningIn('/work/other')).toBe(false)
  })

  it('runs any number of sessions at once, in the same project and in others', async () => {
    const { host, manager } = setup()
    for (let index = 1; index <= 12; index++) await manager.start(request(`g${index}`))
    await manager.start(request('h1', 'claude', '/work/other'))
    expect(host.spawned).toHaveLength(13)
    expect(manager.runningCount()).toBe(13)
    expect(manager.list().map((session) => session.id)).toEqual([
      ...Array.from({ length: 12 }, (_, index) => `g${index + 1}`),
      'h1',
    ])
    expect(manager.isRunningIn('/work/other')).toBe(true)
    await expect(manager.start(request('h1'))).rejects.toBeInstanceOf(SessionError)
  })

  it('records the exit code or the terminating signal of each session', async () => {
    const { manager, host, updates } = setup()
    await manager.start(request('s1'))
    await manager.start(request('s2'))
    host.emit('exit', 's1', 3, 0)
    host.emit('exit', 's2', 0, 15)
    expect(manager.list()).toMatchObject([
      { id: 's1', status: 'exited', exit: { code: 3, signal: null, abnormal: false } },
      { id: 's2', status: 'exited', exit: { code: null, signal: 'SIGTERM', abnormal: false } },
    ])
    expect(updates.map((update) => [update.id, update.status])).toEqual([
      ['s1', 'running'],
      ['s2', 'running'],
      ['s1', 'exited'],
      ['s2', 'exited'],
    ])
    expect(manager.hasRunningSession()).toBe(false)
  })

  it('routes input, resizes and output to each running session', async () => {
    const { manager, host } = setup()
    const output: Array<[string, string]> = []
    manager.on('data', (id, data) => output.push([id, data]))
    await manager.start(request('s1'))
    await manager.start(request('s2'))
    manager.write('s1', 'ls\r', false)
    manager.write('s2', 'pwd\r', false)
    manager.write('other', 'x', false)
    manager.resize('s2', 100, 30)
    host.emit('data', 's1', 'one')
    host.emit('data', 's2', 'two')
    host.emit('data', 'other', 'ignored')
    host.emit('exit', 's1', 0, 0)
    manager.write('s1', 'after exit', false)
    expect(host.written).toEqual([
      ['s1', 'ls\r', false],
      ['s2', 'pwd\r', false],
    ])
    expect(host.resized).toEqual([['s2', 100, 30]])
    expect(output).toEqual([
      ['s1', 'one'],
      ['s2', 'two'],
    ])
  })

  it('closes a running session by ending its process, then forgets it', async () => {
    const { manager, host } = setup()
    await manager.start(request('s1'))
    await manager.start(request('s2'))
    await manager.close('s1')
    expect(host.killed).toEqual([['s1', 'SIGHUP']])
    expect(manager.list().map((session) => session.id)).toEqual(['s2'])
    expect(manager.runningCount()).toBe(1)
  })

  it('uses SIGKILL when the process ignores SIGHUP', async () => {
    const { manager, host, signals } = setup()
    host.exitOn = null
    await manager.start(request('s1'))
    await manager.close('s1')
    expect(host.killed).toEqual([
      ['s1', 'SIGHUP'],
      ['s1', 'SIGKILL'],
    ])
    expect(signals).toEqual([[100, 'SIGKILL']])
    expect(manager.list()).toEqual([])
  })

  it('closes an ended session without signalling anything', async () => {
    const { manager, host } = setup()
    await manager.start(request('s1'))
    host.emit('exit', 's1', 3, 0)
    await manager.close('s1')
    await manager.close('s1')
    expect(host.killed).toEqual([])
    expect(manager.list()).toEqual([])
  })

  it('does not start a session that is closed while it is starting', async () => {
    const launch = pendingLaunch()
    const { manager, host } = setup({ resolveLaunch: launch.resolveLaunch })
    const started = manager.start(request('s1', 'claude'))
    expect(manager.runningCount()).toBe(1)
    expect(manager.isRunningIn('/work/project')).toBe(true)
    const closed = manager.close('s1')
    launch.release()
    await expect(started).rejects.toBeInstanceOf(SessionError)
    await closed
    expect(host.spawned).toEqual([])
    expect(manager.runningCount()).toBe(0)
  })

  it('ends a process that starts after its session was closed', async () => {
    const { manager, host } = setup()
    const { promise: spawning, resolve: spawned } = Promise.withResolvers<void>()
    const spawn = host.spawn.bind(host)
    host.spawn = async (spawnRequest) => {
      await spawning
      return spawn(spawnRequest)
    }
    const started = manager.start(request('s1'))
    // Let the launch resolve so that the spawn is in progress.
    await new Promise((resolve) => setTimeout(resolve, 5))
    const closed = manager.close('s1')
    spawned()
    await started
    await closed
    expect(host.killed).toEqual([['s1', 'SIGHUP']])
    expect(manager.list()).toEqual([])
  })

  it('launches a session started from an issue with the issue, and records which issue it was', async () => {
    const launched: Array<[string, SentIssue | null]> = []
    const { manager, updates } = setup({
      resolveLaunch: async (toolId, _cwd, issue) => {
        launched.push([toolId, issue])
        return { file: toolId, args: [], env: {} }
      },
    })
    const issue = { title: 'Fix the login bug', description: 'Steps' }
    const sent = await manager.start(request('c1', 'claude', '/work/project', null, 7), issue)
    const other = await manager.start(request('c2', 'claude'))
    expect(launched).toEqual([
      ['claude', issue],
      ['claude', null],
    ])
    expect([sent.issueId, other.issueId]).toEqual([7, null])
    expect(manager.list().map((session) => session.issueId)).toEqual([7, null])
    expect(updates.map((update) => update.issueId)).toEqual([7, null])
  })

  it("launches each session with its id, and knows its project's root until it is closed", async () => {
    const launched: string[] = []
    const launch = pendingLaunch()
    const { manager, host } = setup({
      resolveLaunch: async (toolId, _cwd, _issue, sessionId) => {
        launched.push(sessionId)
        return launch.resolveLaunch(toolId)
      },
    })
    const starting = manager.start(request('s1', 'shell', '/work/project', '/wt/feat'))
    // Also while it starts: its process may run hoot before Hoot learns that it runs.
    await expect.poll(() => launched).toEqual(['s1'])
    expect(manager.projectRootOf('s1')).toBe('/work/project')
    launch.release()
    await starting
    await manager.start(request('s2', 'claude', '/work/other'))
    expect(launched).toEqual(['s1', 's2'])
    expect(manager.projectRootOf('s2')).toBe('/work/other')
    // Until the session is closed, also once its process has ended.
    host.emit('exit', 's1', 3, 0)
    expect(manager.projectRootOf('s1')).toBe('/work/project')
    await manager.close('s1')
    expect(manager.projectRootOf('s1')).toBeNull()
    expect(manager.projectRootOf('unknown')).toBeNull()
  })

  it('runs a session in a worktree in its root, and tells its running sessions apart', async () => {
    const launched: string[] = []
    const { host, manager } = setup({
      resolveLaunch: async (toolId, cwd) => {
        launched.push(cwd)
        return { file: toolId, args: [], env: {} }
      },
    })
    const session = await manager.start(request('w1', 'shell', '/work/project', '/wt/feat'))
    expect(session).toMatchObject({ projectRoot: '/work/project', worktreePath: '/wt/feat' })
    expect(launched).toEqual(['/wt/feat'])
    expect(host.spawned[0]).toMatchObject({ id: 'w1', cwd: '/wt/feat' })
    expect(manager.isRunningWithin('/wt/feat')).toBe(true)
    expect(manager.isRunningWithin('/wt')).toBe(true)
    expect(manager.isRunningWithin('/wt/fea')).toBe(false)
    expect(manager.isRunningWithin('/wt/feat/sub')).toBe(false)
    expect(manager.isRunningWithin('/wt/other')).toBe(false)
    // A session in a worktree belongs to its project.
    expect(manager.isRunningIn('/work/project')).toBe(true)
    host.emit('exit', 'w1', 3, 0)
    expect(manager.isRunningWithin('/wt/feat')).toBe(false)
  })

  it('forgets the ended sessions of a deleted worktree only', async () => {
    const { manager, host } = setup()
    await manager.start(request('m1'))
    await manager.start(request('w1', 'shell', '/work/project', '/wt/feat'))
    await manager.start(request('w2', 'shell', '/work/project', '/wt/feat'))
    await manager.start(request('o1', 'shell', '/work/project', '/wt/other'))
    for (const id of ['m1', 'w1', 'o1']) host.emit('exit', id, 3, 0)
    // Running sessions stay, and so do ended ones elsewhere.
    manager.forgetWorktree('/wt/feat')
    expect(manager.list().map((session) => session.id)).toEqual(['m1', 'w2', 'o1'])
  })

  it('forgets the ended sessions of a removed project', async () => {
    const { manager, host } = setup()
    await manager.start(request('s1'))
    await manager.start(request('s2'))
    await manager.start(request('h1', 'shell', '/work/other'))
    host.emit('exit', 's1', 3, 0)
    host.emit('exit', 's2', 1, 0)
    host.emit('exit', 'h1', 2, 0)
    manager.forgetProject('/work/project')
    expect(manager.list().map((session) => session.id)).toEqual(['h1'])
  })

  it('ends every running session, for quitting', async () => {
    const { manager, host } = setup()
    await manager.start(request('s1'))
    await manager.start(request('s2'))
    await manager.start(request('s3'))
    host.emit('exit', 's3', 3, 0)
    await manager.endAll()
    expect(host.killed).toEqual([
      ['s1', 'SIGHUP'],
      ['s2', 'SIGHUP'],
    ])
    expect(manager.hasRunningSession()).toBe(false)
  })

  it('marks every running session as ended abnormally when the pty host stops', async () => {
    vi.useFakeTimers()
    try {
      const { manager, host, signals } = setup()
      await manager.start(request('s1'))
      await manager.start(request('s2'))
      await manager.start(request('s3'))
      host.emit('exit', 's3', 3, 0)
      host.emit('host-exit', 9, false)
      expect(manager.list()).toMatchObject([
        { id: 's1', status: 'exited', exit: { abnormal: true, code: null, signal: null } },
        { id: 's2', status: 'exited', exit: { abnormal: true, code: null, signal: null } },
        { id: 's3', status: 'exited', exit: { abnormal: false, code: 3 } },
      ])
      expect(signals).toEqual([
        [100, 'SIGHUP'],
        [101, 'SIGHUP'],
      ])
      vi.advanceTimersByTime(100)
      expect(signals).toEqual([
        [100, 'SIGHUP'],
        [101, 'SIGHUP'],
        [100, 'SIGKILL'],
        [101, 'SIGKILL'],
      ])
      expect(manager.hasRunningSession()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not keep a session whose process could not start', async () => {
    const { manager, host } = setup()
    host.failSpawn = new Error('posix_spawnp failed')
    await expect(manager.start(request('s1'))).rejects.toThrow(/posix_spawnp failed/)
    expect(manager.list()).toEqual([])
    expect(manager.hasRunningSession()).toBe(false)
  })
})

describe("the cleanup of a session's launch", () => {
  it('runs once, when the process ends, and not again when the session is closed', async () => {
    const launches = cleanedLaunches()
    const { manager, host } = setup({ resolveLaunch: launches.resolveLaunch })
    await manager.start(request('s1', 'claude'))
    expect(launches.runs.get('s1')).toBeUndefined()
    host.emit('exit', 's1', 0, 0)
    expect(launches.runs.get('s1')).toBe(1)
    await manager.close('s1')
    expect(launches.runs.get('s1')).toBe(1)
  })

  it('runs when a running session is closed, and when Hoot quits', async () => {
    const launches = cleanedLaunches()
    const { manager } = setup({ resolveLaunch: launches.resolveLaunch })
    await manager.start(request('s1', 'claude'))
    await manager.start(request('s2', 'claude'))
    await manager.close('s1')
    expect([...launches.runs]).toEqual([['s1', 1]])
    await manager.endAll()
    expect([...launches.runs]).toEqual([
      ['s1', 1],
      ['s2', 1],
    ])
  })

  it('runs when the process does not report its exit, once its session is closed', async () => {
    const launches = cleanedLaunches()
    const { manager, host } = setup({ resolveLaunch: launches.resolveLaunch })
    host.kill = (id, signal) => host.killed.push([id, signal])
    await manager.start(request('s1', 'claude'))
    await manager.close('s1')
    expect(launches.runs.get('s1')).toBe(1)
    expect(manager.list()).toEqual([])
  })

  it('runs when the process cannot start, or its session is closed before it starts', async () => {
    const failed = cleanedLaunches()
    const first = setup({ resolveLaunch: failed.resolveLaunch })
    first.host.failSpawn = new Error('posix_spawnp failed')
    await expect(first.manager.start(request('s1', 'claude'))).rejects.toThrow(
      /posix_spawnp failed/,
    )
    expect(failed.runs.get('s1')).toBe(1)

    const { promise: held, resolve: release } = Promise.withResolvers<void>()
    const closedEarly = cleanedLaunches({ held })
    const second = setup({ resolveLaunch: closedEarly.resolveLaunch })
    const started = second.manager.start(request('s1', 'claude'))
    const closed = second.manager.close('s1')
    release()
    await expect(started).rejects.toBeInstanceOf(SessionError)
    await closed
    expect(closedEarly.runs.get('s1')).toBe(1)
    expect(second.host.spawned).toEqual([])
  })

  it('leaves the session as it is when the cleanup fails', async () => {
    const launches = cleanedLaunches({ failing: true })
    const { manager, host, updates } = setup({ resolveLaunch: launches.resolveLaunch })
    await manager.start(request('s1', 'claude'))
    host.emit('exit', 's1', 3, 0)
    expect(launches.runs.get('s1')).toBe(1)
    expect(manager.list()).toMatchObject([{ id: 's1', status: 'exited', exit: { code: 3 } }])
    expect(updates.at(-1)).toMatchObject({ id: 's1', status: 'exited' })
    await manager.close('s1')
    expect(manager.list()).toEqual([])
  })
})

describe('signalName', () => {
  it('names signals', () => {
    expect(signalName(1)).toBe('SIGHUP')
    expect(signalName(9)).toBe('SIGKILL')
    expect(signalName(999)).toBe('signal 999')
  })
})

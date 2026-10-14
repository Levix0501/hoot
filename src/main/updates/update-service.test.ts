import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UpdateStatus } from '../../shared/updates'
import { CHECK_INTERVAL_MS, UpdateService, type Updater } from './update-service'

/** Stands in for electron-updater's `autoUpdater`. */
class FakeUpdater extends EventEmitter {
  autoDownload = true
  checkForUpdates = vi.fn<() => Promise<null>>(async () => null)
  downloadUpdate = vi.fn<() => Promise<string[]>>(async () => [])
  quitAndInstall = vi.fn<() => void>()
}

function setup() {
  const updater = new FakeUpdater()
  const restart = vi.fn<(install: () => void) => void>()
  const service = new UpdateService({ updater: updater as unknown as Updater, restart })
  const statuses: UpdateStatus[] = []
  const failures: string[] = []
  service.on('changed', (status) => statuses.push(status))
  service.on('failed', (message) => failures.push(message))
  return { updater, restart, service, statuses, failures }
}

/** Reports that `version` is out. */
function announce(updater: FakeUpdater, version = '0.1.0-alpha.2') {
  updater.emit('update-available', { version })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('UpdateService', () => {
  it('does nothing without an updater, and says it does not look', async () => {
    const restart = vi.fn<(install: () => void) => void>()
    const service = new UpdateService({ updater: null, restart })
    const changes = vi.fn<() => void>()
    service.on('changed', changes)
    service.start()
    await service.check()
    await service.install()
    expect(service.status).toEqual({ state: { kind: 'none' }, check: { kind: 'unsupported' } })
    expect(changes).not.toHaveBeenCalled()
    expect(restart).not.toHaveBeenCalled()
  })

  it('downloads only when asked', () => {
    const { updater } = setup()
    expect(updater.autoDownload).toBe(false)
  })

  it('looks for a newer version at once and then every hour', async () => {
    vi.useFakeTimers()
    const { updater, service } = setup()
    service.start()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(3)
  })

  it('waits for the next look when a look fails', async () => {
    const { updater, service, failures } = setup()
    updater.checkForUpdates.mockRejectedValueOnce(new Error('net::ERR_INTERNET_DISCONNECTED'))
    await expect(service.check()).resolves.toBeUndefined()
    expect(service.state).toEqual({ kind: 'none' })
    expect(service.status.check).toEqual({
      kind: 'failed',
      message: 'net::ERR_INTERNET_DISCONNECTED',
    })
    expect(failures).toEqual([])
  })

  it('offers a newer version, and stops offering it once it is gone', () => {
    const { updater, service, statuses } = setup()
    announce(updater)
    expect(service.state).toEqual({ kind: 'available', version: '0.1.0-alpha.2' })
    updater.emit('update-not-available', { version: '0.1.0-alpha.1' })
    expect(service.state).toEqual({ kind: 'none' })
    expect(statuses.map((status) => status.state)).toEqual([
      { kind: 'available', version: '0.1.0-alpha.2' },
      { kind: 'none' },
    ])
  })

  it('downloads the version, showing how much has arrived, then restarts into it', async () => {
    const { updater, restart, service, statuses } = setup()
    announce(updater)
    let finish!: () => void
    updater.downloadUpdate.mockImplementation(
      () => new Promise<string[]>((resolve) => (finish = () => resolve([]))),
    )

    const installing = service.install()
    expect(service.state).toEqual({ kind: 'downloading', version: '0.1.0-alpha.2', percent: 0 })
    updater.emit('download-progress', { percent: 41.7 })
    updater.emit('download-progress', { percent: 41.9 })
    updater.emit('download-progress', { percent: 100 })
    finish()
    await installing

    expect(
      statuses.map(({ state }) => (state.kind === 'downloading' ? state.percent : state.kind)),
    ).toEqual(['available', 0, 41, 100, 'downloaded'])
    expect(restart).toHaveBeenCalledTimes(1)
    expect(updater.quitAndInstall).not.toHaveBeenCalled()

    restart.mock.calls[0]![0]()
    expect(service.state).toEqual({ kind: 'restarting', version: '0.1.0-alpha.2' })
    expect(updater.quitAndInstall).toHaveBeenCalled()
  })

  it('offers the version again when downloading it fails', async () => {
    const { updater, restart, service, failures } = setup()
    announce(updater)
    updater.downloadUpdate.mockRejectedValueOnce(new Error('sha512 checksum mismatch'))
    await service.install()
    expect(service.state).toEqual({ kind: 'available', version: '0.1.0-alpha.2' })
    expect(failures).toEqual(['sha512 checksum mismatch'])
    expect(restart).not.toHaveBeenCalled()
  })

  it('asks to restart again, without downloading again, after the restart was cancelled', async () => {
    const { updater, restart, service } = setup()
    announce(updater)
    await service.install()
    expect(service.state).toEqual({ kind: 'downloaded', version: '0.1.0-alpha.2' })

    await service.install()
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(restart).toHaveBeenCalledTimes(2)
  })

  it('does not look again while a version is downloading or downloaded', async () => {
    const { updater, service } = setup()
    announce(updater)
    updater.downloadUpdate.mockImplementation(() => new Promise<string[]>(() => {}))
    void service.install()
    await service.check()
    announce(updater, '0.1.0-alpha.3')
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    expect(service.state).toEqual({ kind: 'downloading', version: '0.1.0-alpha.2', percent: 0 })
  })

  it('says why installing failed, and offers the version again', async () => {
    const { updater, restart, service, failures } = setup()
    announce(updater)
    await service.install()
    restart.mock.calls[0]![0]()
    updater.emit('error', new Error('Code signature did not pass validation'))
    expect(service.state).toEqual({ kind: 'available', version: '0.1.0-alpha.2' })
    expect(failures).toEqual(['Code signature did not pass validation'])
  })

  it('leaves the errors of looking and downloading to their promises', () => {
    const { updater, service, failures } = setup()
    updater.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'))
    announce(updater)
    updater.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'))
    expect(service.state).toEqual({ kind: 'available', version: '0.1.0-alpha.2' })
    expect(failures).toEqual([])
  })
})

/** What a look reports at each step: the check, and the newer version known. */
function steps(statuses: UpdateStatus[]) {
  return statuses.map(({ check, state }) => [
    check.kind,
    state.kind === 'available' ? state.version : state.kind,
  ])
}

describe('UpdateService looking', () => {
  it('has not looked before it is asked to', () => {
    const { service } = setup()
    expect(service.status).toEqual({ state: { kind: 'none' }, check: { kind: 'idle' } })
  })

  it('is looking while the look runs, and has found nothing newer when it ends', async () => {
    const { updater, service, statuses } = setup()
    let finish!: () => void
    updater.checkForUpdates.mockImplementation(
      () => new Promise<null>((resolve) => (finish = () => resolve(null))),
    )

    const looking = service.check()
    expect(service.status).toEqual({ state: { kind: 'none' }, check: { kind: 'checking' } })
    updater.emit('update-not-available', { version: '0.1.0-alpha.1' })
    finish()
    await looking

    expect(service.status).toEqual({ state: { kind: 'none' }, check: { kind: 'finished' } })
    expect(steps(statuses)).toEqual([
      ['checking', 'none'],
      ['finished', 'none'],
    ])
  })

  it('knows the newer version it found only once the look has ended', async () => {
    const { updater, service, statuses } = setup()
    updater.checkForUpdates.mockImplementation(async () => {
      announce(updater, '0.1.0-alpha.3')
      return null
    })
    await service.check()
    expect(steps(statuses)).toEqual([
      ['checking', 'none'],
      ['checking', '0.1.0-alpha.3'],
      ['finished', '0.1.0-alpha.3'],
    ])
  })

  it('tells why a look failed, in full, and knows no newer version it had not known', async () => {
    const { updater, service, failures } = setup()
    const message = '404 Not Found\nHeaders: {"server":"GitHub.com"}'
    updater.checkForUpdates.mockRejectedValueOnce(new Error(message))
    await service.check()
    expect(service.status).toEqual({ state: { kind: 'none' }, check: { kind: 'failed', message } })
    expect(failures).toEqual([])
  })

  it('keeps the newer version it knows when a look finds nothing newer or fails', async () => {
    const { updater, service } = setup()
    announce(updater, '0.1.0-alpha.3')

    updater.checkForUpdates.mockRejectedValueOnce(new Error('500 Internal Server Error'))
    await service.check()
    expect(service.status).toEqual({
      state: { kind: 'available', version: '0.1.0-alpha.3' },
      check: { kind: 'failed', message: '500 Internal Server Error' },
    })

    // A newer version known earlier is replaced by the one a look finds.
    updater.checkForUpdates.mockImplementationOnce(async () => {
      announce(updater, '0.1.0-alpha.4')
      return null
    })
    await service.check()
    expect(service.status).toEqual({
      state: { kind: 'available', version: '0.1.0-alpha.4' },
      check: { kind: 'finished' },
    })
  })

  it('knows no newer version once a look finds nothing newer', async () => {
    const { updater, service } = setup()
    announce(updater, '0.1.0-alpha.3')
    updater.checkForUpdates.mockImplementationOnce(async () => {
      updater.emit('update-not-available', { version: '0.1.0-alpha.2' })
      return null
    })
    await service.check()
    expect(service.status).toEqual({ state: { kind: 'none' }, check: { kind: 'finished' } })
  })

  it('looks again after a failed look, from the beginning', async () => {
    const { updater, service, statuses } = setup()
    updater.checkForUpdates.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:80'))
    await service.check()
    statuses.length = 0
    await service.check()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
    expect(steps(statuses)).toEqual([
      ['checking', 'none'],
      ['finished', 'none'],
    ])
  })

  it('lets a look in progress serve every request for one meanwhile', async () => {
    const { updater, service } = setup()
    let finish!: () => void
    updater.checkForUpdates.mockImplementation(
      () => new Promise<null>((resolve) => (finish = () => resolve(null))),
    )
    const first = service.check()
    const second = service.check()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    finish()
    await Promise.all([first, second])
    expect(service.status.check).toEqual({ kind: 'finished' })

    void service.check()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('looks when asked while the newer version known is offered', async () => {
    const { updater, service } = setup()
    announce(updater)
    await service.check()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it.each(['downloading', 'downloaded', 'restarting'] as const)(
    'does not look, nor changes how its latest look went, while a version is %s',
    async (kind) => {
      const { updater, restart, service } = setup()
      announce(updater)
      if (kind === 'downloading') {
        updater.downloadUpdate.mockImplementation(() => new Promise<string[]>(() => {}))
      }
      const installing = service.install()
      if (kind !== 'downloading') await installing
      if (kind === 'restarting') restart.mock.calls[0]![0]()
      expect(service.state.kind).toBe(kind)

      await service.check()
      expect(updater.checkForUpdates).not.toHaveBeenCalled()
      expect(service.status.check).toEqual({ kind: 'idle' })
    },
  )
})

import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UpdateState } from '../../shared/updates'
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
  const states: UpdateState[] = []
  const failures: string[] = []
  service.on('changed', (state) => states.push(state))
  service.on('failed', (message) => failures.push(message))
  return { updater, restart, service, states, failures }
}

/** Reports that `version` is out. */
function announce(updater: FakeUpdater, version = '0.1.0-alpha.2') {
  updater.emit('update-available', { version })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('UpdateService', () => {
  it('does nothing without an updater', async () => {
    const restart = vi.fn<(install: () => void) => void>()
    const service = new UpdateService({ updater: null, restart })
    service.start()
    await service.check()
    await service.install()
    expect(service.state).toEqual({ kind: 'none' })
    expect(restart).not.toHaveBeenCalled()
  })

  it('downloads only when asked', () => {
    const { updater } = setup()
    expect(updater.autoDownload).toBe(false)
  })

  it('looks for a newer version at once and then every hour', () => {
    vi.useFakeTimers()
    const { updater, service } = setup()
    service.start()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(CHECK_INTERVAL_MS)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('waits for the next look when a look fails', async () => {
    const { updater, service, failures } = setup()
    updater.checkForUpdates.mockRejectedValueOnce(new Error('net::ERR_INTERNET_DISCONNECTED'))
    await expect(service.check()).resolves.toBeUndefined()
    expect(service.state).toEqual({ kind: 'none' })
    expect(failures).toEqual([])
  })

  it('offers a newer version, and stops offering it once it is gone', () => {
    const { updater, service, states } = setup()
    announce(updater)
    expect(service.state).toEqual({ kind: 'available', version: '0.1.0-alpha.2' })
    updater.emit('update-not-available', { version: '0.1.0-alpha.1' })
    expect(service.state).toEqual({ kind: 'none' })
    expect(states).toEqual([{ kind: 'available', version: '0.1.0-alpha.2' }, { kind: 'none' }])
  })

  it('downloads the version, showing how much has arrived, then restarts into it', async () => {
    const { updater, restart, service, states } = setup()
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
      states.map((state) => (state.kind === 'downloading' ? state.percent : state.kind)),
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

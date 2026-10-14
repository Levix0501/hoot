import { EventEmitter } from 'node:events'
import type { AppUpdater } from 'electron-updater'
import type { UpdateCheck, UpdateState, UpdateStatus } from '../../shared/updates'

/** What the service uses of electron-updater's `autoUpdater`. */
export type Updater = Pick<
  AppUpdater,
  'autoDownload' | 'checkForUpdates' | 'downloadUpdate' | 'quitAndInstall' | 'on'
>

export interface UpdateServiceOptions {
  /**
   * electron-updater's `autoUpdater`, or `null` for a Hoot that does not
   * update itself, such as one built from source.
   */
  updater: Updater | null
  /**
   * Restarts Hoot into the downloaded update by calling `install`, which quits
   * Hoot, once that loses no running session the user wants to keep.
   */
  restart(install: () => void): void
}

/** How long Hoot waits between looks for a newer version, after the one when it starts. */
export const CHECK_INTERVAL_MS = 60 * 60 * 1000

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Looks for a newer version of Hoot among the releases published on GitHub,
 * when Hoot starts, every hour after, and when asked to. Once the user asks
 * for it, downloads it and restarts Hoot into it. `changed` says where it is
 * with both; `failed` says why downloading or installing the version went
 * wrong. A failed look is told by `changed` only: it leaves the newer version
 * known so far as it was, and waits for the next look.
 */
export class UpdateService extends EventEmitter<{
  changed: [status: UpdateStatus]
  failed: [message: string]
}> {
  private current: UpdateState = { kind: 'none' }
  private latestCheck: UpdateCheck
  /** The look in progress, which every request for one meanwhile shares. */
  private looking: Promise<void> | null = null
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly options: UpdateServiceOptions) {
    super()
    const updater = options.updater
    this.latestCheck = updater ? { kind: 'idle' } : { kind: 'unsupported' }
    if (!updater) return
    // Downloaded only when the user asks for it.
    updater.autoDownload = false
    updater.on('update-available', (info) => {
      if (this.current.kind === 'none' || this.current.kind === 'available') {
        this.setState({ kind: 'available', version: info.version })
      }
    })
    // Its release was taken down, say.
    updater.on('update-not-available', () => {
      if (this.current.kind === 'available') this.setState({ kind: 'none' })
    })
    updater.on('download-progress', (progress) => {
      if (this.current.kind !== 'downloading') return
      const percent = Math.min(100, Math.floor(progress.percent))
      if (percent !== this.current.percent) this.setState({ ...this.current, percent })
    })
    // A failed look or download rejects its promise as well; a failure to
    // install, once Hoot is restarting, is told only here.
    updater.on('error', (error) => {
      if (this.current.kind !== 'restarting') return
      this.setState({ kind: 'available', version: this.current.version })
      this.emit('failed', errorMessage(error))
    })
  }

  get state(): UpdateState {
    return this.current
  }

  get status(): UpdateStatus {
    return { state: this.current, check: this.latestCheck }
  }

  /** Looks for a newer version now, and then every hour. */
  start(): void {
    if (!this.options.updater || this.timer) return
    void this.check()
    this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS)
    this.timer.unref()
  }

  /**
   * Looks for a newer version, unless one is being downloaded or installed;
   * while a look is in progress, waits for that one instead.
   */
  check(): Promise<void> {
    const updater = this.options.updater
    if (!updater) return Promise.resolve()
    if (this.current.kind !== 'none' && this.current.kind !== 'available') return Promise.resolve()
    this.looking ??= this.look(updater).finally(() => {
      this.looking = null
    })
    return this.looking
  }

  private async look(updater: Updater): Promise<void> {
    this.setCheck({ kind: 'checking' })
    try {
      await updater.checkForUpdates()
      this.setCheck({ kind: 'finished' })
    } catch (error) {
      // Offline, say: electron-updater logs why, and Hoot looks again later.
      this.setCheck({ kind: 'failed', message: errorMessage(error) })
    }
  }

  /**
   * Downloads the newer version, unless it is downloaded already, and then
   * restarts Hoot into it.
   */
  async install(): Promise<void> {
    const updater = this.options.updater
    const state = this.current
    if (!updater) return
    if (state.kind === 'available') {
      this.setState({ kind: 'downloading', version: state.version, percent: 0 })
      try {
        await updater.downloadUpdate()
      } catch (error) {
        this.setState({ kind: 'available', version: state.version })
        this.emit('failed', errorMessage(error))
        return
      }
      this.setState({ kind: 'downloaded', version: state.version })
    } else if (state.kind !== 'downloaded') {
      return
    }
    const { version } = state
    this.options.restart(() => {
      this.setState({ kind: 'restarting', version })
      updater.quitAndInstall()
    })
  }

  private setState(state: UpdateState): void {
    this.current = state
    this.emit('changed', this.status)
  }

  private setCheck(check: UpdateCheck): void {
    this.latestCheck = check
    this.emit('changed', this.status)
  }
}

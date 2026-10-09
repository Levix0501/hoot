import { app, dialog, type BrowserWindow } from 'electron'
import { IpcChannel } from '../shared/ipc'
import { describeRunningSessions, quitConfirmationLabel } from '../shared/session'

export interface QuitGuardOptions {
  getWindow(): BrowserWindow | null
  /** Makes the window visible to the user so they can answer. */
  presentWindow(window: BrowserWindow): void
  /** How many sessions are starting or running. */
  runningSessionCount(): number
  endSessions(): Promise<void>
  /** Called when the user chose to keep Hoot running. */
  onCancel(): void
}

const QUIT_MESSAGE = 'Quit Hoot?'

/**
 * Asks for confirmation before the window closes or the app quits while
 * sessions are running, saying how many. Confirming ends them and quits;
 * cancelling keeps Hoot and every session running.
 */
export class QuitGuard {
  private allowQuit = false
  private awaitingAnswer = false

  constructor(private readonly options: QuitGuardOptions) {}

  /** Lets the app quit without asking, for example on SIGTERM. */
  allow(): void {
    this.allowQuit = true
  }

  /** Call from the window `close` and app `before-quit` events. */
  intercept(event: Electron.Event): void {
    if (this.allowQuit) return
    const running = this.options.runningSessionCount()
    if (running === 0) return
    event.preventDefault()
    this.ask(running)
  }

  async answer(confirmed: boolean): Promise<void> {
    this.awaitingAnswer = false
    if (this.allowQuit) return
    if (!confirmed) {
      this.options.onCancel()
      return
    }
    this.allowQuit = true
    await this.options.endSessions()
    app.quit()
  }

  private ask(running: number): void {
    if (this.awaitingAnswer) {
      const window = this.options.getWindow()
      if (window) this.options.presentWindow(window)
      return
    }
    this.awaitingAnswer = true
    const window = this.options.getWindow()
    if (!window || window.isDestroyed() || window.webContents.isCrashed()) {
      // Without a working window, ask with a native dialog.
      void dialog
        .showMessageBox({
          type: 'warning',
          message: QUIT_MESSAGE,
          detail: describeRunningSessions(running),
          buttons: [quitConfirmationLabel(running), 'Cancel'],
          defaultId: 0,
          cancelId: 1,
        })
        .then(({ response }) => this.answer(response === 0))
      return
    }
    this.options.presentWindow(window)
    window.webContents.send(IpcChannel.confirmQuit, running)
  }
}

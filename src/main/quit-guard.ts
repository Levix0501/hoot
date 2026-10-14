import { app, dialog, type BrowserWindow } from 'electron'
import { IpcChannel } from '../shared/ipc'
import {
  describeRunningSessions,
  quitConfirmationLabel,
  quitQuestion,
  type QuitReason,
} from '../shared/session'

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

/**
 * Asks for confirmation before the window closes or the app quits while
 * sessions are running, saying how many. Confirming ends them and quits;
 * cancelling keeps Hoot and every session running. Restarting into an update
 * asks the same way.
 */
export class QuitGuard {
  private allowQuit = false
  private awaitingAnswer = false
  /** Installs the update that the open question asks to restart into. */
  private install: (() => void) | null = null

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
    this.ask(running, 'quit')
  }

  /**
   * Restarts Hoot into a downloaded update by calling `install`, which quits
   * Hoot: at once while no session runs, otherwise once the user confirms,
   * after ending the sessions. While Hoot already asks whether to quit, the
   * answer to that question stands.
   */
  restartToUpdate(install: () => void): void {
    const running = this.options.runningSessionCount()
    if (running === 0) {
      install()
      return
    }
    if (!this.awaitingAnswer) this.install = install
    this.ask(running, 'update')
  }

  async answer(confirmed: boolean): Promise<void> {
    this.awaitingAnswer = false
    const install = this.install
    this.install = null
    if (this.allowQuit) return
    if (!confirmed) {
      this.options.onCancel()
      return
    }
    if (install) {
      // With no session left, the window closes for the update without
      // asking again; should the update fail, quitting still asks.
      await this.options.endSessions()
      install()
      return
    }
    this.allowQuit = true
    await this.options.endSessions()
    app.quit()
  }

  private ask(running: number, reason: QuitReason): void {
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
          message: quitQuestion(reason),
          detail: describeRunningSessions(running, reason),
          buttons: [quitConfirmationLabel(running, reason), 'Cancel'],
          defaultId: 0,
          cancelId: 1,
        })
        .then(({ response }) => this.answer(response === 0))
      return
    }
    this.options.presentWindow(window)
    window.webContents.send(IpcChannel.confirmQuit, running, reason)
  }
}

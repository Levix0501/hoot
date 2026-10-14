import { app, dialog, type BrowserWindow } from 'electron'
import type { AgentOperationSummary } from '../shared/agents'
import { IpcChannel } from '../shared/ipc'
import {
  describeQuit,
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
  /** The agents being installed or updated, and those waiting to be. */
  agentOperations(): AgentOperationSummary[]
  /**
   * Stops them: those waiting never run, and the command of the one running
   * is sent SIGTERM; settles once its process has ended.
   */
  stopAgentOperations(): Promise<void>
  /** Called when the user chose to keep Hoot running. */
  onCancel(): void
}

/**
 * Asks for confirmation before the window closes or the app quits while
 * sessions are running, saying how many, or agents are being installed or
 * updated, saying which. Confirming stops those operations, waiting for the
 * running one's process to end, then ends the sessions and quits; cancelling
 * keeps Hoot, every session and every operation running. Restarting into an
 * update asks the same way.
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
    if (!this.needsAnswer()) return
    event.preventDefault()
    this.ask('quit')
  }

  /**
   * Restarts Hoot into a downloaded update by calling `install`, which quits
   * Hoot: at once while no session runs and no agent is being installed or
   * updated, otherwise once the user confirms, after stopping those
   * operations and ending the sessions. While Hoot already asks whether to
   * quit, the answer to that question stands.
   */
  restartToUpdate(install: () => void): void {
    if (!this.needsAnswer()) {
      install()
      return
    }
    if (!this.awaitingAnswer) this.install = install
    this.ask('update')
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
      await this.options.stopAgentOperations()
      await this.options.endSessions()
      install()
      return
    }
    this.allowQuit = true
    await this.options.stopAgentOperations()
    await this.options.endSessions()
    app.quit()
  }

  private needsAnswer(): boolean {
    return this.options.runningSessionCount() > 0 || this.options.agentOperations().length > 0
  }

  private ask(reason: QuitReason): void {
    if (this.awaitingAnswer) {
      const window = this.options.getWindow()
      if (window) this.options.presentWindow(window)
      return
    }
    this.awaitingAnswer = true
    const running = this.options.runningSessionCount()
    const operations = this.options.agentOperations()
    const window = this.options.getWindow()
    if (!window || window.isDestroyed() || window.webContents.isCrashed()) {
      // Without a working window, ask with a native dialog.
      void dialog
        .showMessageBox({
          type: 'warning',
          message: quitQuestion(reason),
          detail: describeQuit(running, reason, operations),
          buttons: [quitConfirmationLabel(running, reason), 'Cancel'],
          defaultId: 0,
          cancelId: 1,
        })
        .then(({ response }) => this.answer(response === 0))
      return
    }
    this.options.presentWindow(window)
    window.webContents.send(IpcChannel.confirmQuit, running, reason, operations)
  }
}

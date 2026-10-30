import type { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentOperationSummary } from '../shared/agents'
import { IpcChannel } from '../shared/ipc'

const electron = vi.hoisted(() => ({
  app: { quit: vi.fn<() => void>() },
  dialog: {
    showMessageBox:
      vi.fn<(options: Electron.MessageBoxOptions) => Promise<Electron.MessageBoxReturnValue>>(),
  },
}))
vi.mock('electron', () => electron)

const { QuitGuard } = await import('./quit-guard')

function fakeWindow() {
  const send = vi.fn<(channel: string, ...args: unknown[]) => void>()
  const window = {
    isDestroyed: () => false,
    webContents: { isCrashed: () => false, send },
  } as unknown as BrowserWindow
  return { window, send }
}

function setup(options: {
  running: number
  window: BrowserWindow | null
  operations?: AgentOperationSummary[]
  /** The names of the worktrees being deleted. */
  deletions?: string[]
  /** Settles when stopping the operations is done; at once without it. */
  stopped?: Promise<void>
}) {
  let running = options.running
  let operations = options.operations ?? []
  const calls: string[] = []
  const presentWindow = vi.fn<(window: BrowserWindow) => void>()
  const onCancel = vi.fn<() => void>()
  const endSessions = vi.fn<() => Promise<void>>(async () => {
    calls.push('end sessions')
    running = 0
  })
  const stopAgentOperations = vi.fn<() => Promise<void>>(async () => {
    calls.push('stop operations')
    await options.stopped
    operations = []
  })
  const resumeAgentOperations = vi.fn<() => void>(() => calls.push('resume operations'))
  const guard = new QuitGuard({
    getWindow: () => options.window,
    presentWindow,
    runningSessionCount: () => running,
    endSessions,
    agentOperations: () => operations,
    worktreeDeletions: () => options.deletions ?? [],
    stopAgentOperations,
    resumeAgentOperations,
    onCancel,
  })
  const setRunning = (count: number) => {
    running = count
  }
  return {
    guard,
    presentWindow,
    onCancel,
    endSessions,
    stopAgentOperations,
    resumeAgentOperations,
    setRunning,
    calls,
  }
}

const updating: AgentOperationSummary = { label: 'Claude Code', kind: 'update', waiting: false }
const waiting: AgentOperationSummary = { label: 'Codex', kind: 'update', waiting: true }

const quitEvent = () => {
  const preventDefault = vi.fn<() => void>()
  return { event: { preventDefault } as unknown as Electron.Event, preventDefault }
}

beforeEach(() => {
  electron.app.quit.mockReset()
  electron.dialog.showMessageBox.mockReset()
})

describe('QuitGuard', () => {
  it('lets the window close and the app quit when no session runs', () => {
    const { window, send } = fakeWindow()
    const { guard } = setup({ running: 0, window })
    const { event, preventDefault } = quitEvent()
    guard.intercept(event)
    expect(preventDefault).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('stops quitting and asks in the window, with the number of running sessions', () => {
    const { window, send } = fakeWindow()
    const { guard, presentWindow } = setup({ running: 2, window })
    const { event, preventDefault } = quitEvent()
    guard.intercept(event)
    expect(preventDefault).toHaveBeenCalled()
    expect(presentWindow).toHaveBeenCalledWith(window)
    expect(send).toHaveBeenCalledWith(IpcChannel.confirmQuit, 2, 'quit', [], [])

    // Asking again while the question is open only brings the window back.
    guard.intercept(quitEvent().event)
    expect(send).toHaveBeenCalledTimes(1)
    expect(presentWindow).toHaveBeenCalledTimes(2)
  })

  it('keeps running when the user cancels, and asks again next time', async () => {
    const { window, send } = fakeWindow()
    const { guard, onCancel, endSessions } = setup({ running: 1, window })
    guard.intercept(quitEvent().event)
    await guard.answer(false)
    expect(onCancel).toHaveBeenCalled()
    expect(endSessions).not.toHaveBeenCalled()
    expect(electron.app.quit).not.toHaveBeenCalled()

    const { event, preventDefault } = quitEvent()
    guard.intercept(event)
    expect(preventDefault).toHaveBeenCalled()
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('ends the session and quits when the user confirms', async () => {
    const { window } = fakeWindow()
    const { guard, endSessions } = setup({ running: 1, window })
    guard.intercept(quitEvent().event)
    await guard.answer(true)
    expect(endSessions).toHaveBeenCalled()
    expect(electron.app.quit).toHaveBeenCalled()

    const { event, preventDefault } = quitEvent()
    guard.intercept(event)
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('asks before quitting while a worktree is being deleted, naming it', async () => {
    const { window, send } = fakeWindow()
    const { guard, endSessions } = setup({ running: 0, window, deletions: ['brave-cats-run'] })
    const { event, preventDefault } = quitEvent()
    guard.intercept(event)
    expect(preventDefault).toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(IpcChannel.confirmQuit, 0, 'quit', [], ['brave-cats-run'])
    await guard.answer(true)
    expect(endSessions).toHaveBeenCalled()
    expect(electron.app.quit).toHaveBeenCalled()
  })

  it('asks with a native dialog when there is no window', async () => {
    electron.dialog.showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false })
    const { guard, endSessions } = setup({ running: 3, window: null })
    guard.intercept(quitEvent().event)
    expect(electron.dialog.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Quit Hoot?',
        detail: '3 sessions are still running. Quitting will end them.',
        buttons: ['End Sessions and Quit', 'Cancel'],
      }),
    )
    await vi.waitFor(() => expect(electron.app.quit).toHaveBeenCalled())
    expect(endSessions).toHaveBeenCalled()
  })

  it('opens a window again when the user cancels from the native dialog', async () => {
    electron.dialog.showMessageBox.mockResolvedValue({ response: 1, checkboxChecked: false })
    const { guard, onCancel } = setup({ running: 1, window: null })
    guard.intercept(quitEvent().event)
    await vi.waitFor(() => expect(onCancel).toHaveBeenCalled())
    expect(electron.app.quit).not.toHaveBeenCalled()
  })

  it('quits without asking once allowed', () => {
    const { window, send } = fakeWindow()
    const { guard } = setup({ running: 1, window })
    guard.allow()
    const { event, preventDefault } = quitEvent()
    guard.intercept(event)
    expect(preventDefault).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })
})

describe('QuitGuard with agents being installed or updated', () => {
  it('asks also without a running session, naming the agents', () => {
    const { window, send } = fakeWindow()
    const { guard } = setup({ running: 0, window, operations: [updating, waiting] })
    const { event, preventDefault } = quitEvent()
    guard.intercept(event)
    expect(preventDefault).toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(IpcChannel.confirmQuit, 0, 'quit', [updating, waiting], [])
  })

  it('keeps the operations when the user cancels', async () => {
    const { window } = fakeWindow()
    const { guard, stopAgentOperations, onCancel } = setup({
      running: 0,
      window,
      operations: [updating],
    })
    guard.intercept(quitEvent().event)
    await guard.answer(false)
    expect(onCancel).toHaveBeenCalled()
    expect(stopAgentOperations).not.toHaveBeenCalled()
    expect(electron.app.quit).not.toHaveBeenCalled()
  })

  it('stops the operations, then ends the sessions and quits, when the user confirms', async () => {
    const { window } = fakeWindow()
    const { guard, calls } = setup({ running: 1, window, operations: [updating] })
    guard.intercept(quitEvent().event)
    await guard.answer(true)
    expect(calls).toEqual(['stop operations', 'end sessions'])
    expect(electron.app.quit).toHaveBeenCalled()
  })

  it('asks before restarting into an update, and stops the operations first', async () => {
    const { window, send } = fakeWindow()
    const { guard, calls } = setup({ running: 0, window, operations: [updating] })
    const install = vi.fn<() => void>(() => calls.push('install'))
    guard.restartToUpdate(install)
    expect(install).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(IpcChannel.confirmQuit, 0, 'update', [updating], [])
    await guard.answer(true)
    expect(calls).toEqual(['stop operations', 'end sessions', 'install'])
  })

  it('holds every other quit and close while it waits for them to stop, then quits once', async () => {
    const { window, send } = fakeWindow()
    const stopped = Promise.withResolvers<void>()
    const { guard, calls } = setup({
      running: 0,
      window,
      operations: [updating],
      stopped: stopped.promise,
    })
    guard.intercept(quitEvent().event)
    const answered = guard.answer(true)
    expect(calls).toEqual(['stop operations'])
    // Quitting again, or closing the window, while npm finishes its step.
    for (let attempt = 0; attempt < 2; attempt++) {
      const { event, preventDefault } = quitEvent()
      guard.intercept(event)
      expect(preventDefault).toHaveBeenCalled()
    }
    expect(send).toHaveBeenCalledTimes(1)
    expect(electron.app.quit).not.toHaveBeenCalled()

    stopped.resolve()
    await answered
    expect(calls).toEqual(['stop operations', 'end sessions'])
    expect(electron.app.quit).toHaveBeenCalledTimes(1)
    const { event, preventDefault } = quitEvent()
    guard.intercept(event)
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('holds quitting and restarting again while a confirmed restart waits for them to stop', async () => {
    const { window, send } = fakeWindow()
    const stopped = Promise.withResolvers<void>()
    const { guard, calls } = setup({
      running: 0,
      window,
      operations: [updating],
      stopped: stopped.promise,
    })
    const install = vi.fn<() => void>(() => calls.push('install'))
    guard.restartToUpdate(install)
    const answered = guard.answer(true)
    const { event, preventDefault } = quitEvent()
    guard.intercept(event)
    expect(preventDefault).toHaveBeenCalled()
    const again = vi.fn<() => void>()
    guard.restartToUpdate(again)
    expect(send).toHaveBeenCalledTimes(1)

    stopped.resolve()
    await answered
    expect(calls).toEqual(['stop operations', 'end sessions', 'install'])
    expect(again).not.toHaveBeenCalled()
    expect(electron.app.quit).not.toHaveBeenCalled()
  })

  it('still quits without asking on SIGTERM while it waits for them to stop', () => {
    const { window } = fakeWindow()
    const { guard } = setup({
      running: 0,
      window,
      operations: [updating],
      stopped: new Promise<void>(() => {}),
    })
    guard.intercept(quitEvent().event)
    void guard.answer(true)
    guard.allow()
    const { event, preventDefault } = quitEvent()
    guard.intercept(event)
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('lets them run again when restarting into the update fails, after stopping them', async () => {
    const { window } = fakeWindow()
    const { guard, calls } = setup({ running: 0, window, operations: [updating] })
    const install = vi.fn<() => void>(() => calls.push('install'))
    guard.restartToUpdate(install)
    await guard.answer(true)
    guard.updateFailed()
    expect(calls).toEqual(['stop operations', 'end sessions', 'install', 'resume operations'])
  })

  it('keeps them stopped while quitting, or waiting to, when an update fails then', async () => {
    const { window } = fakeWindow()
    const stopped = Promise.withResolvers<void>()
    const { guard, resumeAgentOperations } = setup({
      running: 0,
      window,
      operations: [updating],
      stopped: stopped.promise,
    })
    guard.intercept(quitEvent().event)
    const answered = guard.answer(true)
    guard.updateFailed()
    stopped.resolve()
    await answered
    guard.updateFailed()
    expect(resumeAgentOperations).not.toHaveBeenCalled()
    expect(electron.app.quit).toHaveBeenCalledTimes(1)
  })

  it('names them in the native dialog when there is no window', async () => {
    electron.dialog.showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false })
    const { guard, stopAgentOperations } = setup({
      running: 0,
      window: null,
      operations: [updating],
    })
    guard.intercept(quitEvent().event)
    expect(electron.dialog.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Quit Hoot?',
        detail: 'Claude Code is being updated. Quitting will stop it.',
        buttons: ['Stop and Quit', 'Cancel'],
      }),
    )
    await vi.waitFor(() => expect(electron.app.quit).toHaveBeenCalled())
    expect(stopAgentOperations).toHaveBeenCalled()
  })
})

describe('QuitGuard.restartToUpdate', () => {
  it('installs at once when no session runs', () => {
    const { window, send } = fakeWindow()
    const { guard, endSessions } = setup({ running: 0, window })
    const install = vi.fn<() => void>()
    guard.restartToUpdate(install)
    expect(install).toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(endSessions).not.toHaveBeenCalled()
  })

  it('asks in the window about restarting, then ends the sessions and installs', async () => {
    const { window, send } = fakeWindow()
    const { guard, presentWindow, endSessions } = setup({ running: 2, window })
    const install = vi.fn<() => void>()
    guard.restartToUpdate(install)
    expect(presentWindow).toHaveBeenCalledWith(window)
    expect(send).toHaveBeenCalledWith(IpcChannel.confirmQuit, 2, 'update', [], [])
    expect(install).not.toHaveBeenCalled()

    await guard.answer(true)
    expect(endSessions).toHaveBeenCalled()
    expect(install).toHaveBeenCalled()
    expect(electron.app.quit).not.toHaveBeenCalled()
  })

  it('keeps every session when the user cancels, and quitting still asks after', async () => {
    const { window, send } = fakeWindow()
    const { guard, endSessions } = setup({ running: 1, window })
    const install = vi.fn<() => void>()
    guard.restartToUpdate(install)
    await guard.answer(false)
    expect(install).not.toHaveBeenCalled()
    expect(endSessions).not.toHaveBeenCalled()

    const { event, preventDefault } = quitEvent()
    guard.intercept(event)
    expect(preventDefault).toHaveBeenCalled()
    expect(send).toHaveBeenLastCalledWith(IpcChannel.confirmQuit, 1, 'quit', [], [])
  })

  it('still asks before quitting after it ended the sessions to install', async () => {
    const { window } = fakeWindow()
    const { guard, setRunning } = setup({ running: 1, window })
    guard.restartToUpdate(vi.fn<() => void>())
    await guard.answer(true)

    // The update failed to install, and a session started since.
    setRunning(1)
    const { event, preventDefault } = quitEvent()
    guard.intercept(event)
    expect(preventDefault).toHaveBeenCalled()
  })

  it('lets an open question about quitting stand', async () => {
    const { window, send } = fakeWindow()
    const { guard, presentWindow } = setup({ running: 1, window })
    guard.intercept(quitEvent().event)
    const install = vi.fn<() => void>()
    guard.restartToUpdate(install)
    expect(send).toHaveBeenCalledTimes(1)
    expect(presentWindow).toHaveBeenCalledTimes(2)

    await guard.answer(true)
    expect(install).not.toHaveBeenCalled()
    expect(electron.app.quit).toHaveBeenCalled()
  })

  it('asks with a native dialog when there is no window', async () => {
    electron.dialog.showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false })
    const { guard } = setup({ running: 1, window: null })
    const install = vi.fn<() => void>()
    guard.restartToUpdate(install)
    expect(electron.dialog.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Restart to Update?',
        detail: '1 session is still running. Restarting will end it.',
        buttons: ['End Session and Restart', 'Cancel'],
      }),
    )
    await vi.waitFor(() => expect(install).toHaveBeenCalled())
  })
})

import type { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

function setup(options: { running: number; window: BrowserWindow | null }) {
  let running = options.running
  const presentWindow = vi.fn<(window: BrowserWindow) => void>()
  const onCancel = vi.fn<() => void>()
  const endSessions = vi.fn<() => Promise<void>>(async () => {
    running = 0
  })
  const guard = new QuitGuard({
    getWindow: () => options.window,
    presentWindow,
    runningSessionCount: () => running,
    endSessions,
    onCancel,
  })
  return { guard, presentWindow, onCancel, endSessions }
}

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
    expect(send).toHaveBeenCalledWith(IpcChannel.confirmQuit, 2)

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

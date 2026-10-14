import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENTS_PATH_COMMAND, type AgentsState } from '../shared/agents'
import type { AppInfo } from '../shared/app-info'
import { IpcChannel } from '../shared/ipc'
import type { UpdateStatus } from '../shared/updates'

type Listener = (event: { sender: unknown }, ...args: unknown[]) => unknown

const electron = vi.hoisted(() => {
  const handlers = new Map<string, Listener>()
  const listeners = new Map<string, Listener>()
  return {
    handlers,
    listeners,
    ipcMain: {
      handle: (channel: string, handler: Listener) => handlers.set(channel, handler),
      on: (channel: string, listener: Listener) => listeners.set(channel, listener),
    },
    clipboard: { writeText: vi.fn<(text: string) => void>() },
    app: {},
    dialog: {},
    shell: {},
  }
})
vi.mock('electron', () => electron)

const { registerIpc } = await import('./ipc')

const webContents = { send: vi.fn<(channel: string, ...args: unknown[]) => void>() }
const window = { isDestroyed: () => false, webContents } as unknown as BrowserWindow
const trusted = { sender: webContents }

const emitter = () => new EventEmitter()
const agentsState: AgentsState = { agents: [], installTarget: null }
const agents = Object.assign(new EventEmitter(), {
  getState: vi.fn<() => AgentsState>(() => agentsState),
  detect: vi.fn<() => Promise<void>>(async () => {}),
  install: vi.fn<(id: string) => void>(),
  update: vi.fn<(id: string) => void>(),
  cancel: vi.fn<(id: string) => void>(),
})

const appInfo: AppInfo = {
  version: '0.1.0-alpha.2',
  system: 'macOS',
  systemVersion: '26.3.1',
  arch: 'arm64',
  electron: '44.7.0',
  chromium: '152.0.7977.130',
  node: '24.21.0',
}
const updateStatus: UpdateStatus = { state: { kind: 'none' }, check: { kind: 'finished' } }
const updates = Object.assign(new EventEmitter(), {
  status: updateStatus,
  check: vi.fn<() => Promise<void>>(async () => {}),
  install: vi.fn<() => Promise<void>>(async () => {}),
})

beforeEach(() => {
  electron.handlers.clear()
  electron.listeners.clear()
  vi.clearAllMocks()
  agents.removeAllListeners()
  updates.removeAllListeners()
  registerIpc({
    getWindow: () => window,
    appInfo,
    tools: emitter(),
    agents,
    permissionLevels: emitter(),
    appearance: emitter(),
    sessions: emitter(),
    updates,
    worktrees: emitter(),
  } as unknown as Parameters<typeof registerIpc>[0])
})

const send = (channel: string, ...args: unknown[]) =>
  electron.listeners.get(channel)?.(trusted, ...args)

describe('the messages of the Agents page', () => {
  it('give the agents, and look for them again', async () => {
    expect(await electron.handlers.get(IpcChannel.getAgents)?.(trusted)).toBe(agentsState)
    send(IpcChannel.detectAgents)
    expect(agents.detect).toHaveBeenCalledOnce()
  })

  it('install, update and cancel the agent named, and only an agent', () => {
    send(IpcChannel.installAgent, 'opencode')
    send(IpcChannel.updateAgent, 'claude')
    send(IpcChannel.cancelAgentOperation, 'codex')
    expect(agents.install.mock.calls).toEqual([['opencode']])
    expect(agents.update.mock.calls).toEqual([['claude']])
    expect(agents.cancel.mock.calls).toEqual([['codex']])
    for (const id of ['shell', 'npm', '', 3, null]) {
      send(IpcChannel.installAgent, id)
      send(IpcChannel.updateAgent, id)
      send(IpcChannel.cancelAgentOperation, id)
    }
    expect(agents.install).toHaveBeenCalledOnce()
    expect(agents.update).toHaveBeenCalledOnce()
    expect(agents.cancel).toHaveBeenCalledOnce()
  })

  it('come only from the window', () => {
    electron.listeners.get(IpcChannel.installAgent)?.({ sender: {} }, 'claude')
    expect(agents.install).not.toHaveBeenCalled()
  })

  it('pass on every change of the agents to the window', () => {
    agents.emit('changed', agentsState)
    expect(webContents.send).toHaveBeenCalledWith(IpcChannel.agentsChanged, agentsState)
  })

  it('put the line that adds the folder of agents to PATH on the clipboard', () => {
    send(IpcChannel.writeClipboardText, AGENTS_PATH_COMMAND)
    expect(electron.clipboard.writeText).toHaveBeenCalledWith(AGENTS_PATH_COMMAND)
  })
})

describe('the messages of the About page', () => {
  it('give what it tells of Hoot and of what it runs on', async () => {
    expect(await electron.handlers.get(IpcChannel.getAppInfo)?.(trusted)).toBe(appInfo)
  })

  it('give where Hoot is with updates, and pass on every change', async () => {
    expect(await electron.handlers.get(IpcChannel.getUpdateStatus)?.(trusted)).toBe(updateStatus)
    const changed: UpdateStatus = {
      state: { kind: 'available', version: '0.1.0-alpha.3' },
      check: { kind: 'checking' },
    }
    updates.emit('changed', changed)
    expect(webContents.send).toHaveBeenCalledWith(IpcChannel.updateStatusChanged, changed)
  })

  it('look for a newer version when asked, and download one only when asked to', () => {
    send(IpcChannel.checkForUpdates)
    expect(updates.check).toHaveBeenCalledOnce()
    expect(updates.install).not.toHaveBeenCalled()
    send(IpcChannel.installUpdate)
    expect(updates.install).toHaveBeenCalledOnce()
    expect(updates.check).toHaveBeenCalledOnce()
  })

  it('answer a request for a look with where updates stand, whether or not it began one', () => {
    send(IpcChannel.checkForUpdates)
    expect(webContents.send).toHaveBeenCalledWith(IpcChannel.updateStatusChanged, updateStatus)
  })

  it('come only from the window', () => {
    electron.listeners.get(IpcChannel.checkForUpdates)?.({ sender: {} })
    expect(updates.check).not.toHaveBeenCalled()
    expect(webContents.send).not.toHaveBeenCalled()
  })

  it('pass on why downloading or installing failed', () => {
    updates.emit('failed', 'sha512 checksum mismatch')
    expect(webContents.send).toHaveBeenCalledWith(
      IpcChannel.updateFailed,
      'sha512 checksum mismatch',
    )
  })
})

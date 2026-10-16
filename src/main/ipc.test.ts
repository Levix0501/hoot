import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENTS_PATH_COMMAND, type AgentsState } from '../shared/agents'
import type { AppInfo } from '../shared/app-info'
import type { Dependencies } from '../shared/dependencies'
import { IpcChannel } from '../shared/ipc'
import type { Issue, NewIssue } from '../shared/issues'
import type { ParentChange, SubIssues } from '../shared/sub-issues'
import type { UpdateStatus } from '../shared/updates'
import type { WorkflowRecord } from '../shared/workflows'

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

const subIssues: SubIssues = { version: 3, links: [{ issueId: 2, parentId: 1 }] }
const dependencies: Dependencies = { version: 2, links: [{ issueId: 2, blockedById: 1 }] }
const created: Issue = {
  id: 4,
  projectId: null,
  title: 'Child',
  description: '',
  status: 'backlog',
  priority: 2,
  createdAt: 0,
  completedAt: null,
}
const issues = Object.assign(new EventEmitter(), {
  subIssues: vi.fn<() => SubIssues>(() => subIssues),
  setParents: vi.fn<(changes: ParentChange[]) => void>(),
  create: vi.fn<
    (
      issue: NewIssue,
      parentId?: number | null,
      dependencies?: { blockedBy?: number[]; blocking?: number[] },
    ) => Issue | null
  >(() => created),
  dependencies: vi.fn<() => Dependencies>(() => dependencies),
  changeRelations: vi.fn<(change: unknown) => void>(),
})

type WorkflowChange = { ok: true } | { ok: false; message: string }
const workflows = Object.assign(new EventEmitter(), {
  listShown: vi.fn<() => Record<number, WorkflowRecord[]>>(() => ({
    3: [{ kind: 'started-over', id: 1, at: 0 }],
  })),
  reportByUser: vi.fn<(issueId: number, run: number, outcome: string) => WorkflowChange>(() => ({
    ok: true,
  })),
  startOver: vi.fn<(issueId: number) => WorkflowChange>(() => ({ ok: true })),
})

beforeEach(() => {
  electron.handlers.clear()
  electron.listeners.clear()
  vi.clearAllMocks()
  agents.removeAllListeners()
  updates.removeAllListeners()
  workflows.removeAllListeners()
  issues.removeAllListeners()
  registerIpc({
    issues,
    getWindow: () => window,
    appInfo,
    tools: emitter(),
    agents,
    permissionLevels: emitter(),
    appearance: emitter(),
    sessions: emitter(),
    updates,
    worktrees: emitter(),
    workflows,
  } as unknown as Parameters<typeof registerIpc>[0])
})

const invoke = (channel: string, ...args: unknown[]) =>
  electron.handlers.get(channel)?.(trusted, ...args)

describe("the messages of the issues' workflows", () => {
  it('give the records, and pass on every change of them to the window', async () => {
    expect(await invoke(IpcChannel.listWorkflowRecords)).toEqual({
      3: [{ kind: 'started-over', id: 1, at: 0 }],
    })
    const records = [{ kind: 'step-started', id: 2, step: 'scope', at: 1 }]
    workflows.emit('changed', 3, records)
    expect(webContents.send).toHaveBeenCalledWith(IpcChannel.workflowChanged, 3, records)
  })

  it('report an outcome the user picked, and start a workflow over, for the issue named', async () => {
    expect(await invoke(IpcChannel.reportStep, 3, 2, 'no-split')).toEqual({ ok: true })
    expect(await invoke(IpcChannel.startOverWorkflow, 3)).toEqual({ ok: true })
    expect(workflows.reportByUser.mock.calls).toEqual([[3, 2, 'no-split']])
    expect(workflows.startOver.mock.calls).toEqual([[3]])
  })

  it('take only an issue, a run and an outcome', async () => {
    for (const args of [
      [3, 2],
      ['3', 2, 'no-split'],
      [3, 2, ''],
      [3, -1, 'no-split'],
    ]) {
      expect(await invoke(IpcChannel.reportStep, ...args)).toEqual({
        ok: false,
        message: 'Invalid report.',
      })
    }
    expect(await invoke(IpcChannel.startOverWorkflow, 'ISS-3')).toEqual({
      ok: false,
      message: 'Invalid issue.',
    })
    expect(workflows.reportByUser).not.toHaveBeenCalled()
    expect(workflows.startOver).not.toHaveBeenCalled()
  })
})

describe('the messages of sub-issues', () => {
  it('give the parents of issues, and pass on every change of them to the window', async () => {
    expect(await invoke(IpcChannel.listSubIssues)).toBe(subIssues)
    const changed: SubIssues = { version: 4, links: [] }
    issues.emit('sub-issues-changed', changed)
    expect(webContents.send).toHaveBeenCalledWith(IpcChannel.subIssuesChanged, changed)
  })

  it('give issues other parents, and say why they cannot', async () => {
    const changes = [
      { issueId: 2, parentId: 3 },
      { issueId: 5, parentId: null },
    ]
    expect(await invoke(IpcChannel.setIssueParents, changes)).toEqual({ ok: true })
    expect(issues.setParents.mock.calls).toEqual([[changes]])
    issues.setParents.mockImplementationOnce(() => {
      throw new Error('ISS-2 cannot be a sub-issue of itself.')
    })
    expect(await invoke(IpcChannel.setIssueParents, [{ issueId: 2, parentId: 2 }])).toEqual({
      ok: false,
      message: 'ISS-2 cannot be a sub-issue of itself.',
    })
    for (const value of [[], [{ issueId: 2 }], [{ issueId: '2', parentId: 1 }], 'ISS-2']) {
      expect(await invoke(IpcChannel.setIssueParents, value)).toEqual({
        ok: false,
        message: 'Invalid change.',
      })
    }
    expect(issues.setParents).toHaveBeenCalledTimes(2)
  })

  it('create an issue as the sub-issue of a parent', async () => {
    const issue = {
      projectId: null,
      title: 'Child',
      description: '',
      status: 'backlog',
      priority: 2,
    }
    expect(await invoke(IpcChannel.createSubIssue, 1, issue)).toEqual({ ok: true, issue: created })
    expect(issues.create.mock.calls).toEqual([[issue, 1]])
    issues.create.mockImplementationOnce(() => {
      throw new Error('ISS-1 has 100 sub-issues, the most an issue can have.')
    })
    expect(await invoke(IpcChannel.createSubIssue, 1, issue)).toEqual({
      ok: false,
      message: 'ISS-1 has 100 sub-issues, the most an issue can have.',
    })
    expect(await invoke(IpcChannel.createSubIssue, '1', issue)).toEqual({
      ok: false,
      message: 'Invalid issue.',
    })
  })
})

describe('the messages of dependencies', () => {
  const issue = { projectId: null, title: 'New', description: '', status: 'backlog', priority: 0 }

  it('give the dependencies, and pass on every change of them to the window', async () => {
    expect(await invoke(IpcChannel.listDependencies)).toBe(dependencies)
    const changed: Dependencies = { version: 3, links: [] }
    issues.emit('dependencies-changed', changed)
    expect(webContents.send).toHaveBeenCalledWith(IpcChannel.dependenciesChanged, changed)
  })

  it('make and remove dependencies, and say why they cannot', async () => {
    const change = {
      add: [{ issueId: 3, blockedById: 1 }],
      remove: [{ issueId: 2, blockedById: 1 }],
    }
    expect(await invoke(IpcChannel.changeDependencies, change)).toEqual({ ok: true })
    expect(issues.changeRelations.mock.calls).toEqual([
      [{ addDependencies: change.add, removeDependencies: change.remove }],
    ])
    issues.changeRelations.mockImplementationOnce(() => {
      throw new Error(
        'ISS-3 would be blocked by 51 issues, and an issue can be blocked by at most 50.',
      )
    })
    expect(await invoke(IpcChannel.changeDependencies, change)).toEqual({
      ok: false,
      message: 'ISS-3 would be blocked by 51 issues, and an issue can be blocked by at most 50.',
    })
    for (const value of [{ add: [] }, { add: [{ issueId: 1 }], remove: [] }, 'ISS-1']) {
      expect(await invoke(IpcChannel.changeDependencies, value)).toEqual({
        ok: false,
        message: 'Invalid change.',
      })
    }
    expect(issues.changeRelations).toHaveBeenCalledTimes(2)
  })

  it('create an issue that blocks another, or is blocked by it', async () => {
    expect(await invoke(IpcChannel.createDependentIssue, issue, { blocking: 3 })).toEqual({
      ok: true,
      issue: created,
    })
    expect(await invoke(IpcChannel.createDependentIssue, issue, { blockedBy: 3 })).toEqual({
      ok: true,
      issue: created,
    })
    expect(issues.create.mock.calls).toEqual([
      [issue, null, { blocking: [3] }],
      [issue, null, { blockedBy: [3] }],
    ])
    for (const dependency of [{}, { blocking: 3, blockedBy: 2 }, { blocking: '3' }]) {
      expect(await invoke(IpcChannel.createDependentIssue, issue, dependency)).toEqual({
        ok: false,
        message: 'Invalid issue.',
      })
    }
  })
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

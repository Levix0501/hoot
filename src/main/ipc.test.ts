import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentsState } from '../shared/agents'
import type { AppInfo } from '../shared/app-info'
import type { Dependencies } from '../shared/dependencies'
import { IpcChannel, type StartSessionRequest } from '../shared/ipc'
import type { Issue, NewIssue } from '../shared/issues'
import type { ParentChange, SubIssues } from '../shared/sub-issues'
import type { Labels } from '../shared/labels'
import type { ChatInfo, SavedSessionInfo } from '../shared/chats'
import type { SessionInfo } from '../shared/session'
import type { UpdateStatus } from '../shared/updates'
import { LabelError } from './labels/label-store'

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
    clipboard: { writeText: vi.fn<(text: string) => Promise<void>>(async () => {}) },
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
const agentsState: AgentsState = {
  agents: [],
  installTarget: null,
  detecting: false,
  detectedAt: null,
}
const agents = Object.assign(new EventEmitter(), {
  getState: vi.fn<() => AgentsState>(() => agentsState),
  detect: vi.fn<() => Promise<void>>(async () => {}),
  openPage: vi.fn<() => void>(),
  install: vi.fn<(id: string) => void>(),
  update: vi.fn<(id: string) => void>(),
  updateAll: vi.fn<() => void>(),
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
  get: vi.fn<(id: number) => Issue | null>((id) => (id === 3 ? created : null)),
})

const workflows = new EventEmitter()
const launchSettingsState = { defaultAgent: 'claude', yoloMode: true, agents: {} }
const launchSettings = Object.assign(new EventEmitter(), {
  all: vi.fn<() => unknown>(() => launchSettingsState),
  setDefaultAgent: vi.fn<(id: string) => void>(),
  setYoloMode: vi.fn<(on: boolean) => void>(),
  change: vi.fn<(id: string, change: unknown) => void>(),
})

const snapshot: Labels = { version: 1, groups: [], labels: [], issueLabels: [] }
const labels = Object.assign(new EventEmitter(), {
  snapshot: vi.fn<() => Labels>(() => snapshot),
  eventsOfShown: vi.fn<() => unknown[]>(() => []),
  createLabel: vi.fn<(label: { name: string }) => unknown>((label) => ({
    id: 9,
    name: label.name,
    color: 'ff8800',
    description: '',
    groupId: null,
    group: null,
  })),
  editLabel: vi.fn<(id: number, changes: unknown) => void>(),
  deleteLabel: vi.fn<(id: number) => void>(() => {
    throw new LabelError('Scope belongs to the workflow Spec-driven.')
  }),
  createGroup: vi.fn<(name: string) => unknown>((name) => ({ id: 2, name, workflow: null })),
  deleteGroup: vi.fn<(id: number) => void>(),
  changeIssueLabels: vi.fn<(issueId: number, change: unknown, actor: string) => void>(),
})

const sessionStarts = { answer: vi.fn<(requestId: string, answer: unknown) => void>() }
const chat: ChatInfo = {
  id: 'chat-1',
  toolId: 'claude',
  folder: '/chats/claude-code',
  projectRoot: null,
  worktreePath: null,
  conversationId: 'conversation-1',
  title: '',
  customName: null,
  hasMessages: false,
  createdAt: 1_000,
  lastOpenedAt: 1_000,
}
const saved: SavedSessionInfo = {
  id: 'saved-1',
  toolId: 'claude',
  folder: '/work/project/fix-login-bug',
  projectRoot: '/work/project',
  worktreePath: '/work/project/fix-login-bug',
  conversationId: 'conversation-2',
  title: '',
  customName: null,
  hasMessages: true,
  createdAt: 2_000,
  lastOpenedAt: 2_000,
}
const chats = Object.assign(emitter(), {
  list: vi.fn<() => ChatInfo[]>(() => [chat]),
  listSavedSessions: vi.fn<() => SavedSessionInfo[]>(() => [saved]),
  createSavedSession: vi.fn<() => SavedSessionInfo>(() => saved),
  removeForWorktree: vi.fn<(path: string) => void>(),
  get: vi.fn<(id: string) => ChatInfo | undefined>((id) =>
    id === chat.id ? chat : id === saved.id ? saved : undefined,
  ),
  create: vi.fn<(toolId: ChatInfo['toolId']) => Promise<ChatInfo>>(async () => chat),
  prepareSession: vi.fn<
    (id: string) => Promise<{
      folder: string
      launch: { conversationId: string | null; resume: boolean }
    }>
  >(async (id: string) => {
    const record = id === saved.id ? saved : chat
    return {
      folder: record.folder,
      launch: { conversationId: record.conversationId, resume: record.hasMessages },
    }
  }),
  opened: vi.fn<(id: string) => void>(),
  rename: vi.fn<(id: string, name: string) => boolean>(() => true),
  setTitle: vi.fn<(id: string, title: string) => void>(),
})
const project = { id: 1, root: '/work/project', name: 'project' }
const projects = {
  list: vi.fn<() => (typeof project)[]>(() => [project]),
  find: vi.fn<(root: string) => typeof project | undefined>((root) =>
    root === project.root ? project : undefined,
  ),
}
const worktreeAt = {
  path: saved.worktreePath,
  branch: 'fix-login-bug',
  displayName: 'fix-login-bug',
  name: 'Fix login bug',
  createdAt: 2_000,
  missing: false,
  locked: false,
  lockReason: null,
  innerMembers: [],
}
const worktrees = Object.assign(emitter(), {
  currentWorktree: vi.fn<() => Promise<typeof worktreeAt | null>>(async () => worktreeAt),
  createNamed: vi.fn<(request: unknown) => Promise<unknown>>(),
  delete: vi.fn<
    (
      root: string,
      worktreePath: string,
      discard: boolean,
      endSessions: () => Promise<void>,
    ) => Promise<{ ok: boolean }>
  >(async () => ({ ok: true })),
  removeMissing: vi.fn<
    (root: string, worktreePath: string, closeSessions: () => Promise<void>) => Promise<unknown>
  >(async () => ({ ok: true })),
})
const sidebar = { setWorktreeCollapsed: vi.fn<(root: string, collapsed: boolean) => void>() }
const sessionManager = Object.assign(emitter(), {
  closeIn: vi.fn<(root: string, worktreePath: string) => Promise<void>>(async () => {}),
  closeRunningWithin: vi.fn<(directory: string) => Promise<void>>(async () => {}),
  forgetWorktree: vi.fn<(worktreePath: string) => void>(),
  forgetWithin: vi.fn<(directory: string) => void>(),
  start: vi.fn<(request: StartSessionRequest) => Promise<SessionInfo>>(async (request) => ({
    id: request.id,
    projectRoot: request.projectRoot,
    worktreePath: request.worktreePath,
    chatId: request.chatId ?? null,
    savedSessionId: request.savedSessionId ?? null,
    toolId: request.toolId,
    issueId: request.issueId,
    status: 'running' as const,
    exit: null,
  })),
})

beforeEach(() => {
  electron.handlers.clear()
  electron.listeners.clear()
  vi.clearAllMocks()
  agents.removeAllListeners()
  launchSettings.removeAllListeners()
  updates.removeAllListeners()
  workflows.removeAllListeners()
  labels.removeAllListeners()
  issues.removeAllListeners()
  chats.removeAllListeners()
  worktrees.removeAllListeners()
  sessionManager.removeAllListeners()
  worktrees.currentWorktree.mockReset()
  worktrees.currentWorktree.mockImplementation(async () => worktreeAt)
  registerIpc({
    issues,
    projects,
    getWindow: () => window,
    appInfo,
    tools: emitter(),
    agents,
    launchSettings,
    appearance: emitter(),
    sessions: sessionManager,
    chats,
    updates,
    worktrees,
    workflows,
    labels,
    sessionStarts,
    sidebar,
  } as unknown as Parameters<typeof registerIpc>[0])
})

const invoke = (channel: string, ...args: unknown[]) =>
  electron.handlers.get(channel)?.(trusted, ...args)

describe('the messages of labels', () => {
  it('give the labels and their activity, and pass on every change of them to the window', async () => {
    expect(await invoke(IpcChannel.listLabels)).toBe(snapshot)
    expect(await invoke(IpcChannel.listLabelEvents)).toEqual([])
    const changed = { ...snapshot, version: 2 }
    labels.emit('changed', changed)
    expect(webContents.send).toHaveBeenCalledWith(IpcChannel.labelsChanged, changed)
    labels.emit('events-added', [{ id: 1 }])
    expect(webContents.send).toHaveBeenCalledWith(IpcChannel.labelEventsAdded, [{ id: 1 }])
    workflows.emit('issues-completed', [created])
    expect(webContents.send).toHaveBeenCalledWith(IpcChannel.issuesChanged, [created])
  })

  it('create, change and delete labels and groups, saying why they cannot', async () => {
    expect(
      await invoke(IpcChannel.createLabel, {
        name: 'bug',
        color: 'ff8800',
        description: '',
        groupId: null,
        issueId: 3,
      }),
    ).toEqual({
      ok: true,
      label: { id: 9, name: 'bug', color: 'ff8800', description: '', groupId: null },
    })
    expect(labels.createLabel.mock.calls).toEqual([
      [
        { name: 'bug', color: 'ff8800', description: '', groupId: null },
        { issueId: 3, actor: 'user' },
      ],
    ])
    expect(await invoke(IpcChannel.editLabel, 9, { name: 'flaw', groupId: null })).toEqual({
      ok: true,
    })
    expect(await invoke(IpcChannel.deleteLabel, 1)).toEqual({
      ok: false,
      message: 'Scope belongs to the workflow Spec-driven.',
    })
    expect(await invoke(IpcChannel.createLabelGroup, 'Kind')).toEqual({
      ok: true,
      group: { id: 2, name: 'Kind', workflow: null },
    })
    expect(await invoke(IpcChannel.deleteLabelGroup, 2)).toEqual({ ok: true })
    expect(await invoke(IpcChannel.editLabel, 9, { extra: 1 })).toEqual({
      ok: false,
      message: 'Invalid change.',
    })
    expect(await invoke(IpcChannel.createLabel, { name: 'x' })).toEqual({
      ok: false,
      message: 'Invalid label.',
    })
  })

  it("change an issue's labels as the user does, only for an issue there is", async () => {
    expect(await invoke(IpcChannel.changeIssueLabels, 3, { add: [1], remove: [2] })).toEqual({
      ok: true,
    })
    expect(labels.changeIssueLabels.mock.calls).toEqual([[3, { add: [1], remove: [2] }, 'user']])
    expect(await invoke(IpcChannel.changeIssueLabels, 4, { add: [1], remove: [] })).toEqual({
      ok: false,
      message: 'The issue no longer exists.',
    })
    expect(await invoke(IpcChannel.changeIssueLabels, 3, { add: ['x'], remove: [] })).toEqual({
      ok: false,
      message: 'Invalid change.',
    })
  })
})

describe('the answers to the sessions hoot asks for', () => {
  it('pass on what the window says, and only that', () => {
    const answer = electron.listeners.get(IpcChannel.answerSessionStart)!
    answer(trusted, 'r1', { ok: true, worktreePath: '/w' })
    answer(trusted, 'r2', { ok: false, message: 'No.' })
    answer(trusted, 'r3', { ok: true })
    answer({ sender: {} }, 'r4', { ok: true, worktreePath: '/w' })
    expect(sessionStarts.answer.mock.calls).toEqual([
      ['r1', { ok: true, worktreePath: '/w' }],
      ['r2', { ok: false, message: 'No.' }],
    ])
  })
})

describe('the messages of chats', () => {
  it('give the chats, make a chat, and pass on every change of them to the window', async () => {
    expect(await invoke(IpcChannel.listChats)).toEqual([chat])
    expect(await invoke(IpcChannel.createChat, 'claude')).toEqual({ ok: true, chat })
    expect(chats.create).toHaveBeenCalledWith('claude')
    const changed = [{ ...chat, title: 'Fix the login' }]
    chats.emit('changed', changed)
    expect(webContents.send).toHaveBeenCalledWith(IpcChannel.chatsChanged, changed)
  })

  it('gives a chat another name, and notes the title its agent sets', () => {
    electron.listeners.get(IpcChannel.renameChat)!(trusted, chat.id, 'Login')
    electron.listeners.get(IpcChannel.setChatTitle)!(trusted, chat.id, '✳ Fix the login')
    electron.listeners.get(IpcChannel.renameChat)!(trusted, 7, 'Login')
    expect(chats.rename.mock.calls).toEqual([[chat.id, 'Login']])
    expect(chats.setTitle.mock.calls).toEqual([[chat.id, '✳ Fix the login']])
  })

  it('starts a chat in its folder, continuing its conversation, and moves it to the top', async () => {
    const result = await invoke(IpcChannel.startSession, {
      id: 's1',
      projectRoot: chat.folder,
      worktreePath: null,
      chatId: chat.id,
      toolId: 'claude',
      issueId: null,
      cols: 80,
      rows: 24,
    })
    expect(result).toMatchObject({ ok: true, session: { chatId: chat.id } })
    expect(chats.prepareSession).toHaveBeenCalledWith(chat.id)
    expect(sessionManager.start).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's1', projectRoot: chat.folder, chatId: chat.id }),
      null,
      { conversationId: chat.conversationId, resume: false },
    )
    expect(chats.opened).toHaveBeenCalledWith(chat.id)
  })

  it('gives the saved sessions, makes one in a worktree, and passes on every change of them', async () => {
    expect(await invoke(IpcChannel.listSavedSessions)).toEqual([saved])
    expect(
      await invoke(IpcChannel.createSavedSession, project.root, saved.worktreePath, 'claude'),
    ).toEqual({
      ok: true,
      session: saved,
    })
    expect(chats.createSavedSession).toHaveBeenCalledWith(
      project.root,
      saved.worktreePath,
      'claude',
    )
    electron.listeners.get(IpcChannel.renameSavedSession)!(trusted, saved.id, 'Login')
    electron.listeners.get(IpcChannel.setSavedSessionTitle)!(trusted, saved.id, '✳ Fix the login')
    expect(chats.rename.mock.calls).toEqual([[saved.id, 'Login']])
    expect(chats.setTitle.mock.calls).toEqual([[saved.id, '✳ Fix the login']])
    const changed = [{ ...saved, title: 'Fix the login' }]
    chats.emit('saved-changed', changed)
    expect(webContents.send).toHaveBeenCalledWith(IpcChannel.savedSessionsChanged, changed)
  })

  it('creates a named worktree and the session it opens', async () => {
    worktrees.createNamed.mockResolvedValue({
      ok: true,
      path: saved.worktreePath,
      branch: 'fix-login-bug',
      name: 'Fix login bug',
      warning: null,
    })
    const request = {
      projectRoot: project.root,
      name: 'Fix login bug',
      toolId: 'claude',
      base: 'main',
      nested: [],
    }
    expect(await invoke(IpcChannel.createWorktree, request)).toEqual({
      ok: true,
      path: saved.worktreePath,
      branch: 'fix-login-bug',
      name: 'Fix login bug',
      session: saved,
      warning: null,
    })
    expect(worktrees.createNamed).toHaveBeenCalledWith(request)
    expect(chats.createSavedSession).toHaveBeenCalledWith(
      project.root,
      saved.worktreePath,
      'claude',
    )
  })

  it('starts a saved session in its worktree, continuing its conversation', async () => {
    const result = await invoke(IpcChannel.startSession, {
      id: 's1',
      projectRoot: saved.projectRoot,
      worktreePath: saved.worktreePath,
      savedSessionId: saved.id,
      toolId: 'claude',
      issueId: null,
      cols: 80,
      rows: 24,
    })
    expect(result).toMatchObject({ ok: true, session: { savedSessionId: saved.id } })
    expect(chats.prepareSession).toHaveBeenCalledWith(saved.id)
    expect(sessionManager.start).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 's1',
        projectRoot: saved.projectRoot,
        worktreePath: saved.worktreePath,
        savedSessionId: saved.id,
      }),
      null,
      { conversationId: saved.conversationId, resume: true },
    )
    expect(chats.opened).toHaveBeenCalledWith(saved.id)
  })

  it('starts nothing for a saved session whose worktree is gone', async () => {
    worktrees.currentWorktree.mockResolvedValue(null)
    expect(
      await invoke(IpcChannel.startSession, {
        id: 's1',
        projectRoot: saved.projectRoot,
        worktreePath: saved.worktreePath,
        savedSessionId: saved.id,
        toolId: 'claude',
        issueId: null,
        cols: 80,
        rows: 24,
      }),
    ).toEqual({ ok: false, message: `The worktree no longer exists: ${saved.worktreePath}` })
    worktrees.currentWorktree.mockResolvedValue({ ...worktreeAt, missing: true })
    expect(
      await invoke(IpcChannel.startSession, {
        id: 's1',
        projectRoot: saved.projectRoot,
        worktreePath: saved.worktreePath,
        savedSessionId: saved.id,
        toolId: 'claude',
        issueId: null,
        cols: 80,
        rows: 24,
      }),
    ).toEqual({
      ok: false,
      message: `The folder of the worktree is missing: ${saved.worktreePath}`,
    })
    expect(sessionManager.start).not.toHaveBeenCalled()
  })

  it('refuses a saved session request for another agent', async () => {
    expect(
      await invoke(IpcChannel.startSession, {
        id: 's1',
        projectRoot: saved.projectRoot,
        worktreePath: saved.worktreePath,
        savedSessionId: saved.id,
        toolId: 'codex',
        issueId: null,
        cols: 80,
        rows: 24,
      }),
    ).toEqual({ ok: false, message: 'Invalid session request.' })
    expect(sessionManager.start).not.toHaveBeenCalled()
  })

  it('refuses a chat request that names a chat of another agent', async () => {
    const result = await invoke(IpcChannel.startSession, {
      id: 's1',
      projectRoot: chat.folder,
      worktreePath: null,
      chatId: chat.id,
      toolId: 'codex',
      issueId: null,
      cols: 80,
      rows: 24,
    })
    expect(result).toEqual({ ok: false, message: 'Invalid session request.' })
    expect(sessionManager.start).not.toHaveBeenCalled()
  })
})

describe('the messages of worktrees', () => {
  it('forget what Hoot kept of the worktrees cleaned up, and tell the window which', () => {
    const gone = ['/w/project/a', '/w/project/b']
    worktrees.emit('removed', project.root, gone)
    expect(chats.removeForWorktree.mock.calls).toEqual([[gone[0]], [gone[1]]])
    expect(sidebar.setWorktreeCollapsed.mock.calls).toEqual([
      [gone[0], false],
      [gone[1], false],
    ])
    expect(webContents.send).toHaveBeenCalledWith(IpcChannel.worktreesRemoved, project.root, gone)
  })

  it('end the sessions running in a worktree before deleting it, and forget it once deleted', async () => {
    const at = saved.worktreePath
    expect(await invoke(IpcChannel.deleteWorktree, project.root, at, true)).toEqual({ ok: true })
    const endSessions = worktrees.delete.mock.calls[0]![3]
    expect(sessionManager.closeRunningWithin).not.toHaveBeenCalled()
    await endSessions()
    expect(sessionManager.closeRunningWithin).toHaveBeenCalledWith(at)
    expect(sessionManager.forgetWithin).toHaveBeenCalledWith(at)
    expect(chats.removeForWorktree).toHaveBeenCalledWith(at)
    expect(sidebar.setWorktreeCollapsed).toHaveBeenCalledWith(at, false)
  })

  it('close the open sessions of a missing worktree before removing it, and forget it once removed', async () => {
    const at = saved.worktreePath
    expect(await invoke(IpcChannel.removeWorktree, project.root, at)).toEqual({ ok: true })
    const closeSessions = worktrees.removeMissing.mock.calls[0]![2]
    expect(sessionManager.closeIn).not.toHaveBeenCalled()
    await closeSessions()
    expect(sessionManager.closeIn).toHaveBeenCalledWith(project.root, at)
    expect(sessionManager.forgetWorktree).toHaveBeenCalledWith(at)
    expect(chats.removeForWorktree).toHaveBeenCalledWith(at)
    expect(sidebar.setWorktreeCollapsed).toHaveBeenCalledWith(at, false)

    vi.clearAllMocks()
    worktrees.removeMissing.mockResolvedValueOnce({ ok: false, message: 'No.' })
    expect(await invoke(IpcChannel.removeWorktree, project.root, at)).toEqual({
      ok: false,
      message: 'No.',
    })
    expect(chats.removeForWorktree).not.toHaveBeenCalled()
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
  it('give the agents, look for them when the page opens, and again when asked', async () => {
    expect(await electron.handlers.get(IpcChannel.getAgents)?.(trusted)).toBe(agentsState)
    send(IpcChannel.enterAgentsPage)
    expect(agents.openPage).toHaveBeenCalledOnce()
    send(IpcChannel.detectAgents)
    expect(agents.detect).toHaveBeenCalledOnce()
  })

  it('install, update and cancel the agent named, update all, and only an agent', () => {
    send(IpcChannel.installAgent, 'opencode')
    send(IpcChannel.updateAgent, 'claude')
    send(IpcChannel.updateAllAgents)
    send(IpcChannel.cancelAgentOperation, 'codex')
    expect(agents.install.mock.calls).toEqual([['opencode']])
    expect(agents.update.mock.calls).toEqual([['claude']])
    expect(agents.updateAll).toHaveBeenCalledOnce()
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
    send(IpcChannel.enterAgentsPage)
    electron.listeners.get(IpcChannel.enterAgentsPage)?.({ sender: {} })
    expect(agents.install).not.toHaveBeenCalled()
    expect(agents.openPage).toHaveBeenCalledOnce()
  })

  it('give and change the launch settings, and pass on their changes', async () => {
    expect(await electron.handlers.get(IpcChannel.getLaunchSettings)?.(trusted)).toBe(
      launchSettingsState,
    )
    send(IpcChannel.setDefaultAgent, 'codex')
    send(IpcChannel.setDefaultAgent, 'shell')
    send(IpcChannel.setDefaultAgent, null)
    expect(launchSettings.setDefaultAgent.mock.calls).toEqual([['codex']])
    send(IpcChannel.setYoloMode, false)
    send(IpcChannel.setYoloMode, 'yes')
    expect(launchSettings.setYoloMode.mock.calls).toEqual([[false]])

    send(IpcChannel.setAgentLaunchSettings, 'claude', {
      model: 'opus',
      effort: 'max',
      extraArgs: ['--verbose'],
    })
    expect(launchSettings.change.mock.calls).toEqual([
      ['claude', { model: 'opus', effort: 'max', extraArgs: ['--verbose'] }],
    ])
    for (const args of [
      ['shell', { model: 'opus' }],
      ['claude', { model: 4 }],
      ['claude', { extraArgs: [3] }],
      ['claude', { unknown: true }],
    ]) {
      send(IpcChannel.setAgentLaunchSettings, ...args)
    }
    expect(launchSettings.change).toHaveBeenCalledOnce()

    launchSettings.emit('changed', launchSettingsState)
    expect(webContents.send).toHaveBeenCalledWith(
      IpcChannel.launchSettingsChanged,
      launchSettingsState,
    )
  })

  it('pass on every change of the agents to the window', () => {
    agents.emit('changed', agentsState)
    expect(webContents.send).toHaveBeenCalledWith(IpcChannel.agentsChanged, agentsState)
  })

  it('put the text the window copies on the clipboard', () => {
    send(IpcChannel.writeClipboardText, 'ISS-1')
    expect(electron.clipboard.writeText).toHaveBeenCalledWith('ISS-1')
  })
})

describe("the messages of a session's terminal", () => {
  it('put what is selected in it on the clipboard, longer than any issue title', () => {
    const selection = 'a line of output\r\n'.repeat(100_000)
    send(IpcChannel.writeClipboardText, selection)
    expect(electron.clipboard.writeText).toHaveBeenCalledWith(selection)
  })

  it('put only text there, at most 10 million characters long', () => {
    send(IpcChannel.writeClipboardText, 42)
    send(IpcChannel.writeClipboardText, 'x'.repeat(10_000_001))
    expect(electron.clipboard.writeText).not.toHaveBeenCalled()
  })

  it('log a write the clipboard refuses', async () => {
    const refused = new Error('The clipboard is in use.')
    electron.clipboard.writeText.mockRejectedValueOnce(refused)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    send(IpcChannel.writeClipboardText, 'a line of output')
    await vi.waitFor(() =>
      expect(logged).toHaveBeenCalledWith('Could not put text on the clipboard:', refused),
    )
    logged.mockRestore()
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

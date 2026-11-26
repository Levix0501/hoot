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
import type { ProjectFolderInfo } from '../shared/project-folders'
import {
  findProvider,
  OWN_PROVIDER_IDS,
  ownProvider,
  type Agent,
  type Provider,
  type ProvidersState,
} from '../shared/providers'
import type { SessionInfo } from '../shared/session'
import type { UpdateStatus } from '../shared/updates'
import { LabelError } from './labels/label-store'
import { deletionInstruction } from './worktrees/deletion'
import { mergeInstruction } from './worktrees/merge'

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
    shell: { showItemInFolder: vi.fn<(path: string) => void>() },
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
  providerId: OWN_PROVIDER_IDS.claude,
  model: null,
  agentId: 'claude',
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
  providerId: OWN_PROVIDER_IDS.claude,
  model: null,
  agentId: 'claude',
}
/** A saved session in the project's own folder, which its Local row lists. */
const local: SavedSessionInfo = {
  id: 'local-1',
  toolId: 'claude',
  folder: '/work/project',
  projectRoot: '/work/project',
  worktreePath: null,
  conversationId: 'conversation-3',
  title: '',
  customName: null,
  hasMessages: true,
  createdAt: 3_000,
  lastOpenedAt: 3_000,
  providerId: OWN_PROVIDER_IDS.claude,
  model: null,
  agentId: 'claude',
}
const chats = Object.assign(emitter(), {
  list: vi.fn<() => ChatInfo[]>(() => [chat]),
  listSavedSessions: vi.fn<() => SavedSessionInfo[]>(() => [saved, local]),
  createSavedSession: vi.fn<
    (root: string, worktreePath: string | null, agent: unknown) => SavedSessionInfo
  >((_root, worktreePath) => (worktreePath === null ? local : saved)),
  removeForWorktree: vi.fn<(path: string) => void>(),
  get: vi.fn<(id: string) => ChatInfo | undefined>((id) =>
    id === chat.id ? chat : id === saved.id ? saved : id === local.id ? local : undefined,
  ),
  create: vi.fn<(agent: unknown) => Promise<ChatInfo>>(async () => chat),
  prepareSession: vi.fn<
    (id: string) => Promise<{
      folder: string
      launch: { conversationId: string | null; resume: boolean }
      providerId: string | null
      model: string | null
      agentId: string | null
    }>
  >(async (id: string) => {
    const record = id === saved.id ? saved : id === local.id ? local : chat
    return {
      folder: record.folder,
      launch: { conversationId: record.conversationId, resume: record.hasMessages },
      providerId: record.providerId,
      model: record.model,
      agentId: record.agentId,
    }
  }),
  opened: vi.fn<(id: string) => void>(),
  rename: vi.fn<(id: string, name: string) => boolean>(() => true),
  setTitle: vi.fn<(id: string, title: string) => void>(),
  delete: vi.fn<(id: string) => Promise<void>>(async () => {}),
  archive: vi.fn<(id: string) => Promise<boolean>>(async () => true),
  unarchive: vi.fn<(id: string) => Promise<void>>(async () => {}),
  listArchived: vi.fn<() => unknown[]>(() => []),
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
  newWorktreeOptions: vi.fn<(root: string, from?: string) => Promise<unknown>>(async () => ({
    ok: false,
    message: 'No.',
  })),
  createNamed: vi.fn<(request: unknown) => Promise<unknown>>(),
  removeMissing: vi.fn<
    (root: string, worktreePath: string, closeSessions: () => Promise<void>) => Promise<unknown>
  >(async () => ({ ok: true })),
  planMerge: vi.fn<(root: string, worktreePath: string) => Promise<unknown>>(async () => ({
    ok: false,
    message: 'The worktree no longer exists.',
  })),
  planDeletion: vi.fn<(root: string, worktreePath: string) => Promise<unknown>>(async () => ({
    ok: false,
    message: 'The worktree no longer exists.',
  })),
})
const sidebar = {
  setGroupCollapsed: vi.fn<(group: string, collapsed: boolean) => void>(),
  setWorktreeCollapsed: vi.fn<(root: string, collapsed: boolean) => void>(),
  setLocalCollapsed: vi.fn<(root: string, collapsed: boolean) => void>(),
}
const filePanel = {
  setOpen: vi.fn<(open: boolean) => void>(),
  setTreeWidth: vi.fn<(width: number) => void>(),
  setEditorWidth: vi.fn<(width: number) => void>(),
}
const issueWindow = {
  setOpen: vi.fn<(open: boolean) => void>(),
  setPosition: vi.fn<(position: unknown) => void>(),
}
/** The file panel may show the project's own folder only. */
const folderAccess = {
  folder: vi.fn<(root: string, worktreePath: string | null) => Promise<string | null>>(
    async (root, worktreePath) => (root === project.root && worktreePath === null ? root : null),
  ),
}
const fileWatcher = Object.assign(emitter(), {
  watch: vi.fn<(folder: string | null, entries: readonly string[]) => void>(),
})
const folderThere: ProjectFolderInfo = { missing: false, branch: 'main', displayName: 'main' }
const projectFolders = Object.assign(emitter(), {
  list: vi.fn<() => Promise<Record<string, ProjectFolderInfo>>>(async () => ({
    [project.root]: folderThere,
  })),
  current: vi.fn<(root: string) => Promise<ProjectFolderInfo | null>>(async (root) =>
    root === project.root ? folderThere : null,
  ),
  addProject: vi.fn<(root: string) => void>(),
  removeProject: vi.fn<(root: string) => void>(),
})
const sessionManager = Object.assign(emitter(), {
  closeOf: vi.fn<(chatId: string) => Promise<void>>(async () => {}),
  closeIn: vi.fn<(root: string, worktreePath: string) => Promise<void>>(async () => {}),
  forgetWorktree: vi.fn<(worktreePath: string) => void>(),
  start: vi.fn<(request: StartSessionRequest) => Promise<SessionInfo>>(async (request) => ({
    id: request.id,
    projectRoot: request.projectRoot,
    worktreePath: request.worktreePath,
    chatId: request.chatId ?? null,
    savedSessionId: request.savedSessionId ?? null,
    toolId: request.toolId,
    providerId: null,
    issueId: request.issueId,
    status: 'running' as const,
    exit: null,
    program: null,
  })),
})

/** An agent of a harness on its own models, by the harness's id. */
function ownAgent(harness: Agent['harness']): Agent {
  return {
    id: harness,
    harness,
    providerId: OWN_PROVIDER_IDS[harness],
    name: null,
    enabled: true,
    model: null,
    effort: 'high',
    extraArgs: ['--verbose'],
    modelMap: {},
    createdAt: 1,
  }
}
const madeAgents = [ownAgent('claude'), ownAgent('codex')]
const providersState: ProvidersState = {
  providers: [],
  agents: madeAgents,
  globals: {},
  ready: true,
}
const catalogs = {
  deepseek: [{ id: 'deepseek-flash', context: 1_000_000, output: null, efforts: [] }],
}
const models = Object.assign(emitter(), {
  catalogs: vi.fn<() => typeof catalogs>(() => catalogs),
})
const providers = Object.assign(emitter(), {
  getState: vi.fn<() => ProvidersState>(() => providersState),
  agent: vi.fn<(id: string) => Agent | undefined>((id) => madeAgents.find((a) => a.id === id)),
  provider: vi.fn<(id: string) => Provider | undefined>((id) => findProvider([], id)),
  addProvider: vi.fn<(input: unknown) => unknown>(() => ({ ok: true })),
  updateProvider: vi.fn<(id: string, change: unknown) => Promise<unknown>>(async () => ({
    ok: true,
  })),
  removeProvider: vi.fn<(id: string) => unknown>(() => ({ ok: true })),
  setGlobal: vi.fn<(harness: string, id: string) => Promise<unknown>>(async () => ({ ok: true })),
  setGlobalModel: vi.fn<(harness: string, model: string | null) => Promise<unknown>>(async () => ({
    ok: true,
  })),
  addAgent: vi.fn<(input: unknown) => unknown>(() => ({ ok: true })),
  updateAgent: vi.fn<(id: string, change: unknown) => void>(),
  removeAgent: vi.fn<(id: string) => void>(),
})
/** What a chat or saved session of Claude Code's own agent is made with. */
const claudeChatAgent = {
  toolId: 'claude',
  providerId: OWN_PROVIDER_IDS.claude,
  model: null,
  agentId: 'claude',
}
/** What a session of Claude Code's own agent starts with. */
const claudeLaunch = {
  settings: { enabled: true, model: null, effort: 'high', extraArgs: ['--verbose'] },
  provider: ownProvider('claude'),
  modelMap: {},
}

beforeEach(() => {
  electron.handlers.clear()
  electron.listeners.clear()
  vi.clearAllMocks()
  agents.removeAllListeners()
  launchSettings.removeAllListeners()
  models.removeAllListeners()
  updates.removeAllListeners()
  workflows.removeAllListeners()
  labels.removeAllListeners()
  issues.removeAllListeners()
  chats.removeAllListeners()
  worktrees.removeAllListeners()
  sessionManager.removeAllListeners()
  worktrees.currentWorktree.mockReset()
  worktrees.currentWorktree.mockImplementation(async () => worktreeAt)
  projectFolders.removeAllListeners()
  fileWatcher.removeAllListeners()
  projectFolders.current.mockReset()
  projectFolders.current.mockImplementation(async (root) =>
    root === project.root ? folderThere : null,
  )
  registerIpc({
    issues,
    projects,
    getWindow: () => window,
    appInfo,
    tools: emitter(),
    agents,
    launchSettings,
    providers,
    models,
    appearance: emitter(),
    sessions: sessionManager,
    chats,
    updates,
    worktrees,
    projectFolders,
    workflows,
    labels,
    sessionStarts,
    sidebar,
    filePanel,
    issueWindow,
    folderAccess,
    fileWatcher,
  } as unknown as Parameters<typeof registerIpc>[0])
})

const invoke = (channel: string, ...args: unknown[]) =>
  electron.handlers.get(channel)?.(trusted, ...args)

describe("the file panel's messages", () => {
  it('read and write only in a folder the panel may show', async () => {
    const refused = { kind: 'error', message: 'This folder is no longer in Hoot.' }
    expect(await invoke(IpcChannel.listFolder, '/elsewhere', null, '')).toEqual(refused)
    expect(await invoke(IpcChannel.readFile, project.root, '/work/other', 'a.ts')).toEqual(refused)
    expect(
      await invoke(
        IpcChannel.writeFile,
        '/elsewhere',
        null,
        'a.ts',
        'x',
        { mtimeMs: 1, size: 1 },
        false,
      ),
    ).toEqual(refused)
    expect(await invoke(IpcChannel.listFolder, project.root, null, 7)).toEqual({
      kind: 'error',
      message: 'Not a folder of the panel.',
    })
    const picture = new Uint8Array([1])
    expect(
      await invoke(IpcChannel.addFile, '/elsewhere', null, 'a.md', 'a.png', picture, ''),
    ).toEqual(refused)
    expect(
      await invoke(IpcChannel.addFile, project.root, null, 'a.md', 'a.png', 'not bytes', ''),
    ).toEqual({ kind: 'error', message: 'Not a file of the panel.' })
  })

  it('follow the entries asked for, and pass on their changes to the window', async () => {
    electron.listeners.get(IpcChannel.watchFiles)!(trusted, project.root, null, ['src/', 'a.ts'])
    await vi.waitFor(() =>
      expect(fileWatcher.watch).toHaveBeenLastCalledWith(project.root, ['src/', 'a.ts']),
    )
    electron.listeners.get(IpcChannel.watchFiles)!(trusted, '/elsewhere', null, ['a.ts'])
    await vi.waitFor(() => expect(fileWatcher.watch).toHaveBeenLastCalledWith(null, []))
    electron.listeners.get(IpcChannel.watchFiles)!(trusted, null, null, [])
    expect(fileWatcher.watch).toHaveBeenLastCalledWith(null, [])
    fileWatcher.emit('changed', project.root, 'a.ts')
    expect(webContents.send).toHaveBeenCalledWith(IpcChannel.filesChanged, project.root, 'a.ts')
  })

  it('save whether the panel shows and how wide its parts are', () => {
    electron.listeners.get(IpcChannel.setFilePanelOpen)!(trusted, true)
    electron.listeners.get(IpcChannel.setFileTreeWidth)!(trusted, 300)
    electron.listeners.get(IpcChannel.setFileEditorWidth)!(trusted, 'wide')
    expect(filePanel.setOpen).toHaveBeenCalledWith(true)
    expect(filePanel.setTreeWidth).toHaveBeenCalledWith(300)
    expect(filePanel.setEditorWidth).not.toHaveBeenCalled()
  })
})

describe('the messages of the Issues window', () => {
  it('save whether it is open and where it sits, refusing what is not a position', () => {
    electron.listeners.get(IpcChannel.setIssueWindowOpen)!(trusted, true)
    electron.listeners.get(IpcChannel.setIssueWindowOpen)!(trusted, 'yes')
    expect(issueWindow.setOpen).toHaveBeenCalledTimes(1)
    expect(issueWindow.setOpen).toHaveBeenCalledWith(true)
    const position = { side: 'left', x: 40, edge: 'top', y: 60 }
    electron.listeners.get(IpcChannel.setIssueWindowPosition)!(trusted, position)
    electron.listeners.get(IpcChannel.setIssueWindowPosition)!(trusted, { ...position, x: -5 })
    electron.listeners.get(IpcChannel.setIssueWindowPosition)!(trusted, { ...position, side: 'up' })
    expect(issueWindow.setPosition).toHaveBeenCalledTimes(1)
    expect(issueWindow.setPosition).toHaveBeenCalledWith(position)
  })
})

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
    expect(chats.create).toHaveBeenCalledWith(claudeChatAgent)
    // An agent that is gone makes none.
    expect(await invoke(IpcChannel.createChat, 'gone')).toEqual({
      ok: false,
      message: 'The agent no longer exists.',
    })
    expect(chats.create).toHaveBeenCalledOnce()
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
      claudeLaunch,
    )
    expect(chats.opened).toHaveBeenCalledWith(chat.id)
  })

  it('gives the saved sessions, makes one in a worktree, and passes on every change of them', async () => {
    expect(await invoke(IpcChannel.listSavedSessions)).toEqual([saved, local])
    expect(
      await invoke(IpcChannel.createSavedSession, project.root, saved.worktreePath, 'claude'),
    ).toEqual({
      ok: true,
      session: saved,
    })
    expect(chats.createSavedSession).toHaveBeenCalledWith(
      project.root,
      saved.worktreePath,
      claudeChatAgent,
    )
    electron.listeners.get(IpcChannel.renameSavedSession)!(trusted, saved.id, 'Login')
    electron.listeners.get(IpcChannel.setSavedSessionTitle)!(trusted, saved.id, '✳ Fix the login')
    expect(chats.rename.mock.calls).toEqual([[saved.id, 'Login']])
    expect(chats.setTitle.mock.calls).toEqual([[saved.id, '✳ Fix the login']])
    const changed = [{ ...saved, title: 'Fix the login' }]
    chats.emit('saved-changed', changed)
    expect(webContents.send).toHaveBeenCalledWith(IpcChannel.savedSessionsChanged, changed)
  })

  it('delete a chat or a saved session once its sessions have closed', async () => {
    const order: string[] = []
    sessionManager.closeOf.mockImplementation(async (id) => {
      order.push(`close ${id}`)
    })
    chats.delete.mockImplementation(async (id) => {
      order.push(`delete ${id}`)
    })
    expect(await invoke(IpcChannel.deleteChat, chat.id)).toEqual({ ok: true })
    expect(await invoke(IpcChannel.deleteSavedSession, saved.id)).toEqual({ ok: true })
    expect(order).toEqual([
      `close ${chat.id}`,
      `delete ${chat.id}`,
      `close ${saved.id}`,
      `delete ${saved.id}`,
    ])

    // One that is gone needs nothing more; one of the other kind is refused.
    vi.clearAllMocks()
    expect(await invoke(IpcChannel.deleteChat, 'gone')).toEqual({ ok: true })
    expect(await invoke(IpcChannel.deleteChat, saved.id)).toEqual({
      ok: false,
      message: 'Invalid request.',
    })
    expect(await invoke(IpcChannel.deleteSavedSession, chat.id)).toEqual({
      ok: false,
      message: 'Invalid request.',
    })
    expect(await invoke(IpcChannel.deleteChat, 7)).toEqual({
      ok: false,
      message: 'Invalid request.',
    })
    expect(sessionManager.closeOf).not.toHaveBeenCalled()
    expect(chats.delete).not.toHaveBeenCalled()

    chats.delete.mockRejectedValueOnce(new Error('database is locked'))
    expect(await invoke(IpcChannel.deleteChat, chat.id)).toEqual({
      ok: false,
      message: 'database is locked',
    })
    sessionManager.closeOf.mockImplementation(async () => {})
    chats.delete.mockImplementation(async () => {})
  })

  it('archive a chat or a saved session once its sessions have closed, and bring it back', async () => {
    const order: string[] = []
    sessionManager.closeOf.mockImplementation(async (id) => {
      order.push(`close ${id}`)
    })
    chats.archive.mockImplementation(async (id) => {
      order.push(`archive ${id}`)
      return true
    })
    expect(await invoke(IpcChannel.archiveSession, chat.id)).toEqual({ ok: true, archived: true })
    expect(await invoke(IpcChannel.archiveSession, saved.id)).toEqual({
      ok: true,
      archived: true,
    })
    expect(order).toEqual([
      `close ${chat.id}`,
      `archive ${chat.id}`,
      `close ${saved.id}`,
      `archive ${saved.id}`,
    ])

    expect(await invoke(IpcChannel.unarchiveSession, chat.id)).toEqual({ ok: true })
    expect(chats.unarchive.mock.calls).toEqual([[chat.id]])
    expect(await invoke(IpcChannel.archiveSession, 7)).toEqual({
      ok: false,
      message: 'Invalid request.',
    })

    // A chat that went as its sessions closed, never having got a message, is not archived.
    chats.archive.mockResolvedValueOnce(false)
    expect(await invoke(IpcChannel.archiveSession, chat.id)).toEqual({ ok: true, archived: false })

    chats.archive.mockRejectedValueOnce(new Error('database is locked'))
    expect(await invoke(IpcChannel.archiveSession, chat.id)).toEqual({
      ok: false,
      message: 'database is locked',
    })
    sessionManager.closeOf.mockImplementation(async () => {})
    chats.archive.mockImplementation(async () => true)
  })

  it('gives the archived sessions, and passes on every change of them', async () => {
    expect(await invoke(IpcChannel.listArchivedSessions)).toEqual([])
    const changed = [{ ...chat, archivedAt: 4_000 }]
    chats.emit('archived-changed', changed)
    expect(webContents.send).toHaveBeenCalledWith(IpcChannel.archivedSessionsChanged, changed)
    expect(chats.listArchived).toHaveBeenCalled()
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
      agentId: 'claude',
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
      claudeChatAgent,
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
      claudeLaunch,
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

/** Starts the saved session in the project's own folder, as its row would. */
const startLocal = (overrides: Partial<StartSessionRequest> = {}) =>
  invoke(IpcChannel.startSession, {
    id: 's1',
    projectRoot: project.root,
    worktreePath: null,
    savedSessionId: local.id,
    toolId: 'claude',
    issueId: null,
    cols: 80,
    rows: 24,
    ...overrides,
  })

describe("the messages of a project's own folder", () => {
  it('make a saved session in the folder, without asking for a worktree', async () => {
    expect(await invoke(IpcChannel.createSavedSession, project.root, null, 'codex')).toEqual({
      ok: true,
      session: local,
    })
    expect(chats.createSavedSession).toHaveBeenCalledWith(project.root, null, {
      toolId: 'codex',
      providerId: OWN_PROVIDER_IDS.codex,
      model: null,
      agentId: 'codex',
    })
    expect(projectFolders.current).toHaveBeenCalledWith(project.root)
    expect(worktrees.currentWorktree).not.toHaveBeenCalled()
  })

  it('make none while the folder is missing, or for a project not in the list, and say why', async () => {
    projectFolders.current.mockResolvedValue({ ...folderThere, missing: true })
    expect(await invoke(IpcChannel.createSavedSession, project.root, null, 'claude')).toEqual({
      ok: false,
      message: `The project folder is missing: ${project.root}`,
    })
    expect(await invoke(IpcChannel.createSavedSession, '/work/other', null, 'claude')).toEqual({
      ok: false,
      message: 'The project is not in the list.',
    })
    expect(chats.createSavedSession).not.toHaveBeenCalled()
  })

  it('start a saved session of the folder there, continuing its conversation', async () => {
    expect(await startLocal()).toMatchObject({ ok: true, session: { savedSessionId: local.id } })
    expect(chats.prepareSession).toHaveBeenCalledWith(local.id)
    expect(sessionManager.start).toHaveBeenCalledWith(
      expect.objectContaining({ projectRoot: project.root, worktreePath: null }),
      null,
      { conversationId: local.conversationId, resume: true },
      claudeLaunch,
    )
    expect(chats.opened).toHaveBeenCalledWith(local.id)
    expect(worktrees.currentWorktree).not.toHaveBeenCalled()
  })

  it('start nothing while the folder is missing, keeping the session, and say why', async () => {
    projectFolders.current.mockResolvedValue({ ...folderThere, missing: true })
    expect(await startLocal()).toEqual({
      ok: false,
      message: `The project folder is missing: ${project.root}`,
    })
    expect(chats.prepareSession).not.toHaveBeenCalled()
    expect(sessionManager.start).not.toHaveBeenCalled()
    expect(chats.delete).not.toHaveBeenCalled()

    // Back at its path, it starts again.
    projectFolders.current.mockResolvedValue(folderThere)
    expect(await startLocal()).toMatchObject({ ok: true })
  })

  it('refuse a request that puts a saved session of the folder in a worktree, or a chat', async () => {
    expect(await startLocal({ worktreePath: saved.worktreePath })).toEqual({
      ok: false,
      message: 'Invalid session request.',
    })
    expect(
      await startLocal({ savedSessionId: null, chatId: local.id, projectRoot: local.folder }),
    ).toEqual({ ok: false, message: 'Invalid session request.' })
    expect(sessionManager.start).not.toHaveBeenCalled()
  })

  it('delete a saved session of the folder as a saved session, not as a chat', async () => {
    expect(await invoke(IpcChannel.deleteChat, local.id)).toEqual({
      ok: false,
      message: 'Invalid request.',
    })
    expect(await invoke(IpcChannel.deleteSavedSession, local.id)).toEqual({ ok: true })
    expect(chats.delete).toHaveBeenCalledWith(local.id)
  })

  it('give what Hoot found of the folders, and pass on every change of them', async () => {
    expect(await invoke(IpcChannel.listProjectFolders)).toEqual({ [project.root]: folderThere })
    const changed: ProjectFolderInfo = { missing: false, branch: 'dev', displayName: 'dev' }
    projectFolders.emit('changed', project.root, changed)
    expect(webContents.send).toHaveBeenCalledWith(
      IpcChannel.projectFolderChanged,
      project.root,
      changed,
    )
  })

  it('show the folder in the file manager while it is there, and copy its path', async () => {
    electron.listeners.get(IpcChannel.revealProjectFolder)!(trusted, project.root)
    await vi.waitFor(() =>
      expect(electron.shell.showItemInFolder).toHaveBeenCalledWith(project.root),
    )
    electron.listeners.get(IpcChannel.copyProjectFolderPath)!(trusted, project.root)
    expect(electron.clipboard.writeText).toHaveBeenCalledWith(project.root)

    vi.clearAllMocks()
    projectFolders.current.mockResolvedValue({ ...folderThere, missing: true })
    electron.listeners.get(IpcChannel.revealProjectFolder)!(trusted, project.root)
    // Not for a project not in the list.
    electron.listeners.get(IpcChannel.revealProjectFolder)!(trusted, '/work/other')
    electron.listeners.get(IpcChannel.copyProjectFolderPath)!(trusted, '/work/other')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(electron.shell.showItemInFolder).not.toHaveBeenCalled()
    expect(electron.clipboard.writeText).not.toHaveBeenCalled()
  })

  it("keep whether a project's Local row is collapsed, only for a project in the list", () => {
    const setLocalExpanded = electron.listeners.get(IpcChannel.setLocalExpanded)!
    setLocalExpanded(trusted, project.root, false)
    setLocalExpanded(trusted, project.root, true)
    setLocalExpanded(trusted, '/work/other', false)
    setLocalExpanded(trusted, '/work/other', true)
    setLocalExpanded(trusted, project.root, 'no')
    expect(sidebar.setLocalCollapsed.mock.calls).toEqual([
      [project.root, true],
      [project.root, false],
      ['/work/other', false],
    ])
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

  it('give what the New Worktree dialog offers, also for a new worktree made from another', async () => {
    const at = saved.worktreePath!
    await invoke(IpcChannel.newWorktreeOptions, project.root, undefined)
    await invoke(IpcChannel.newWorktreeOptions, project.root, at)
    expect(worktrees.newWorktreeOptions.mock.calls).toEqual([
      [project.root, undefined],
      [project.root, at],
    ])
    expect(await invoke(IpcChannel.newWorktreeOptions, project.root, '')).toEqual({
      ok: false,
      message: 'Invalid project.',
    })
    expect(await invoke(IpcChannel.newWorktreeOptions, '')).toEqual({
      ok: false,
      message: 'Invalid project.',
    })
    expect(worktrees.newWorktreeOptions).toHaveBeenCalledTimes(2)
  })

  it('start a merge in the project folder, named after the worktree, unless it or the folder is gone', async () => {
    const at = saved.worktreePath!
    // A worktree that is gone is said, and nothing is made.
    expect(await invoke(IpcChannel.startMerge, project.root, at, 'codex')).toEqual({
      ok: false,
      message: 'The worktree no longer exists.',
    })
    expect(worktrees.planMerge).toHaveBeenCalledWith(project.root, at)
    expect(chats.createSavedSession).not.toHaveBeenCalled()

    const plan = {
      worktreeName: 'Fix login bug',
      worktreePath: at,
      repositories: [{ path: project.root, branch: 'fix-login-bug', into: 'main' }],
    }
    worktrees.planMerge.mockResolvedValueOnce({ ok: true, plan })
    expect(await invoke(IpcChannel.startMerge, project.root, at, 'codex')).toEqual({
      ok: true,
      session: local,
    })
    expect(chats.createSavedSession).toHaveBeenCalledWith(
      project.root,
      null,
      {
        toolId: 'codex',
        providerId: OWN_PROVIDER_IDS.codex,
        model: null,
        agentId: 'codex',
      },
      {
        name: 'Merge Fix login bug',
        firstMessage: mergeInstruction(plan),
      },
    )

    vi.clearAllMocks()
    expect(await invoke(IpcChannel.startMerge, '/work/other', at, 'codex')).toMatchObject({
      ok: false,
      message: 'The project is not in the list.',
    })
    expect(await invoke(IpcChannel.startMerge, project.root, at, 'shell')).toMatchObject({
      ok: false,
    })
    expect(worktrees.planMerge).not.toHaveBeenCalled()
  })

  it('start a deletion in the project folder, named after the worktree, unless it or the folder is gone', async () => {
    const at = saved.worktreePath!
    // A worktree that is gone is said, and nothing is made.
    expect(await invoke(IpcChannel.startDeletion, project.root, at, 'codex')).toEqual({
      ok: false,
      message: 'The worktree no longer exists.',
    })
    expect(worktrees.planDeletion).toHaveBeenCalledWith(project.root, at)
    expect(chats.createSavedSession).not.toHaveBeenCalled()

    const plan = {
      worktreeName: 'Fix login bug',
      worktreePath: at,
      repositories: [{ path: project.root, branch: 'fix-login-bug' }],
    }
    worktrees.planDeletion.mockResolvedValueOnce({ ok: true, plan })
    expect(await invoke(IpcChannel.startDeletion, project.root, at, 'codex')).toEqual({
      ok: true,
      session: local,
    })
    expect(chats.createSavedSession).toHaveBeenCalledWith(
      project.root,
      null,
      {
        toolId: 'codex',
        providerId: OWN_PROVIDER_IDS.codex,
        model: null,
        agentId: 'codex',
      },
      {
        name: 'Delete Fix login bug',
        firstMessage: deletionInstruction(plan),
      },
    )
    // Hoot deletes nothing itself, and closes none of the worktree's sessions.
    expect(sessionManager.closeIn).not.toHaveBeenCalled()
    expect(chats.removeForWorktree).not.toHaveBeenCalled()

    vi.clearAllMocks()
    expect(await invoke(IpcChannel.startDeletion, '/work/other', at, 'codex')).toMatchObject({
      ok: false,
      message: 'The project is not in the list.',
    })
    expect(await invoke(IpcChannel.startDeletion, project.root, at, 'shell')).toMatchObject({
      ok: false,
    })
    expect(worktrees.planDeletion).not.toHaveBeenCalled()
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
    send(IpcChannel.setDefaultAgent, 'agent-1')
    send(IpcChannel.setDefaultAgent, 4)
    send(IpcChannel.setDefaultAgent, null)
    expect(launchSettings.setDefaultAgent.mock.calls).toEqual([['agent-1'], [null]])
    send(IpcChannel.setYoloMode, false)
    send(IpcChannel.setYoloMode, 'yes')
    expect(launchSettings.setYoloMode.mock.calls).toEqual([[false]])

    launchSettings.emit('changed', launchSettingsState)
    expect(webContents.send).toHaveBeenCalledWith(
      IpcChannel.launchSettingsChanged,
      launchSettingsState,
    )
  })

  it('pass providers and agents on to the provider service, as far as they are valid', async () => {
    expect(await invoke(IpcChannel.getProviders)).toBe(providersState)
    expect(await invoke(IpcChannel.getModelCatalogs)).toBe(catalogs)
    models.emit('changed', catalogs)
    expect(webContents.send).toHaveBeenCalledWith(IpcChannel.modelCatalogsChanged, catalogs)
    const kimi = {
      name: 'Kimi',
      presetId: 'kimi',
      planId: null,
      apiKey: 'sk-kimi',
      keyHeader: 'bearer',
      urls: { anthropic: 'https://api.moonshot.cn/anthropic' },
      models: ['kimi-k3.1-pro'],
      cloud: null,
    }
    expect(await invoke(IpcChannel.addProvider, kimi)).toEqual({ ok: true })
    expect(await invoke(IpcChannel.addProvider, { ...kimi, keyHeader: 'cookie' })).toEqual({
      ok: false,
      message: 'Invalid provider.',
    })
    const vertex = {
      ...kimi,
      name: 'Vertex AI',
      presetId: 'vertex',
      planId: null,
      urls: {},
      cloud: { kind: 'vertex', region: 'global', project: 'my-project' },
    }
    expect(await invoke(IpcChannel.addProvider, vertex)).toEqual({ ok: true })
    for (const cloud of [
      { kind: 'vertex', region: 'global' },
      { kind: 'bedrock', region: ' ' },
      { kind: 'azure', region: 'eastus' },
    ]) {
      expect(await invoke(IpcChannel.addProvider, { ...vertex, cloud })).toEqual({
        ok: false,
        message: 'Invalid provider.',
      })
    }
    expect(providers.addProvider.mock.calls).toEqual([[kimi], [vertex]])
    await invoke(IpcChannel.updateProvider, 'p-kimi', { apiKey: 'sk-new' })
    expect(providers.updateProvider).toHaveBeenCalledWith('p-kimi', { apiKey: 'sk-new' })
    await invoke(IpcChannel.removeProvider, 'p-kimi')
    expect(providers.removeProvider).toHaveBeenCalledWith('p-kimi')
    await invoke(IpcChannel.setGlobalProvider, 'claude', 'p-kimi')
    await invoke(IpcChannel.setGlobalProvider, 'shell', 'p-kimi')
    expect(providers.setGlobal.mock.calls).toEqual([['claude', 'p-kimi']])
    await invoke(IpcChannel.setGlobalModel, 'claude', null)
    expect(providers.setGlobalModel).toHaveBeenCalledWith('claude', null)

    const agent = { harness: 'claude', providerId: 'p-kimi', model: 'kimi-k3.1-pro' }
    const mapped = { ...agent, modelMap: { haiku: 'kimi-k3', subagent: 'kimi-k3' } }
    const tuned = { ...agent, effort: 'max', extraArgs: ['--verbose'] }
    await invoke(IpcChannel.makeAgent, agent)
    await invoke(IpcChannel.makeAgent, mapped)
    await invoke(IpcChannel.makeAgent, tuned)
    await invoke(IpcChannel.makeAgent, { ...agent, harness: 'shell' })
    // A role Claude Code does not have, or a blank model, is no model map.
    await invoke(IpcChannel.makeAgent, { ...agent, modelMap: { gpt: 'kimi-k3' } })
    await invoke(IpcChannel.makeAgent, { ...agent, modelMap: { haiku: '' } })
    await invoke(IpcChannel.makeAgent, { ...agent, effort: '' })
    await invoke(IpcChannel.makeAgent, { ...agent, extraArgs: [''] })
    expect(providers.addAgent.mock.calls).toEqual([[agent], [mapped], [tuned]])
    send(IpcChannel.changeAgent, 'agent-1', { enabled: false, extraArgs: ['--verbose'] })
    send(IpcChannel.changeAgent, 'agent-1', { extraArgs: [3] })
    send(IpcChannel.changeAgent, 'agent-1', { modelMap: { opus: 'kimi-k3.1-pro' } })
    send(IpcChannel.changeAgent, 'agent-1', { modelMap: { opus: 3 } })
    expect(providers.updateAgent.mock.calls).toEqual([
      ['agent-1', { enabled: false, extraArgs: ['--verbose'] }],
      ['agent-1', { modelMap: { opus: 'kimi-k3.1-pro' } }],
    ])
    send(IpcChannel.deleteAgent, 'agent-1')
    expect(providers.removeAgent).toHaveBeenCalledWith('agent-1')

    providers.emit('changed', providersState)
    expect(webContents.send).toHaveBeenCalledWith(IpcChannel.providersChanged, providersState)
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

describe('the messages of the sidebar', () => {
  it('keep whether the Projects or the Chats group is collapsed, and nothing else', () => {
    send(IpcChannel.setGroupExpanded, 'projects', false)
    send(IpcChannel.setGroupExpanded, 'chats', false)
    send(IpcChannel.setGroupExpanded, 'chats', true)
    send(IpcChannel.setGroupExpanded, 'issues', false)
    send(IpcChannel.setGroupExpanded, 'projects', 'no')
    expect(sidebar.setGroupCollapsed.mock.calls).toEqual([
      ['projects', true],
      ['chats', true],
      ['chats', false],
    ])
  })
})

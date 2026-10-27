import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { HookEventReport } from '../../shared/hoot-cli'
import type { SessionInfo } from '../../shared/session'
import { openDatabase } from '../database/database'
import { ChatManager, newConversationId, ownConversations, visibleInput } from './chat-manager'
import type { AgentConversation, ChatConversations } from './conversations'

class FakeConversations implements ChatConversations {
  claude = false
  codex: AgentConversation[] | null = []
  opencode: AgentConversation[] | null = []

  async claudeConversation(): Promise<boolean> {
    return this.claude
  }

  async codexConversations(): Promise<AgentConversation[] | null> {
    return this.codex
  }

  async openCodeConversations(): Promise<AgentConversation[] | null> {
    return this.opencode
  }
}

const hook = (
  event: HookEventReport['event'],
  conversationId: string | null,
  source: string | null = null,
): HookEventReport => ({
  event,
  startedAt: 1_000,
  subagent: false,
  turn: null,
  conversationId,
  source,
  reason: null,
})

/** A saved session's process that ended. */
const endedSaved = (
  savedSessionId: string,
  worktreePath: string,
  toolId: 'claude' | 'codex' | 'opencode',
): SessionInfo => ({
  id: `session-${savedSessionId}`,
  projectRoot: '/work/project',
  worktreePath,
  chatId: null,
  savedSessionId,
  toolId,
  issueId: null,
  status: 'exited',
  exit: { code: 0, signal: null, abnormal: false },
})

/** The process of a saved session in its project's own folder that ended. */
const endedLocal = (
  savedSessionId: string,
  projectRoot: string,
  toolId: 'claude' | 'codex' | 'opencode',
): SessionInfo => ({
  id: `session-${savedSessionId}`,
  projectRoot,
  worktreePath: null,
  chatId: null,
  savedSessionId,
  toolId,
  issueId: null,
  status: 'exited',
  exit: { code: 0, signal: null, abnormal: false },
})

const ended = (chatId: string, toolId: 'claude' | 'codex' | 'opencode'): SessionInfo => ({
  id: `session-${chatId}`,
  projectRoot: `/chats/${chatId}`,
  worktreePath: null,
  chatId,
  savedSessionId: null,
  toolId,
  issueId: null,
  status: 'exited',
  exit: { code: 0, signal: null, abnormal: false },
})

describe('ChatManager', () => {
  let root: string
  let db: DatabaseSync
  let conversations: FakeConversations
  let clock: number
  let manager: ChatManager
  /** The folders moved to the Trash, in order. */
  let trashed: string[]
  /** Moves a folder to the Trash, which is a folder of the test's own. */
  let trash: (folder: string) => Promise<void>

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-chats-'))
    db = openDatabase(path.join(root, 'data', 'hoot.db'))
    conversations = new FakeConversations()
    clock = 1_000
    trashed = []
    trash = async (folder) => {
      fs.mkdirSync(path.join(root, 'Trash'), { recursive: true })
      fs.renameSync(folder, path.join(root, 'Trash', path.basename(folder)))
      trashed.push(folder)
    }
    manager = new ChatManager({
      db,
      conversations,
      home: path.join(root, 'home'),
      now: () => ++clock,
      trash: (folder) => trash(folder),
    })
  })

  afterEach(() => {
    db.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  const chatsRoot = () => path.join(root, 'home', '.hoot', 'chats')

  /** The manager of a Hoot started again, which reads what happened meanwhile. */
  const restarted = async (): Promise<ChatManager> => {
    const again = new ChatManager({
      db,
      conversations,
      home: path.join(root, 'home'),
      now: () => ++clock,
      trash: (folder) => trash(folder),
    })
    await again.reconcileAll()
    return again
  }

  /** A worktree's folder, with a file in it. */
  const worktreeFolder = (name: string): string => {
    const folder = path.join(root, 'worktrees', name)
    fs.mkdirSync(folder, { recursive: true })
    fs.writeFileSync(path.join(folder, 'README.md'), '# Project\n')
    return folder
  }

  /**
   * Two saved sessions of an agent in a worktree, each with a conversation of
   * its own, which their agents recorded and ended: the second made later.
   */
  const twoSavedSessions = async (toolId: 'codex' | 'opencode', folder: string) => {
    const first = manager.createSavedSession('/work/project', folder, toolId)
    const firstConversation = first.conversationId ?? 'thread-1'
    const record = (list: AgentConversation[]) => {
      if (toolId === 'codex') conversations.codex = list
      else conversations.opencode = list
    }
    manager.opened(first.id)
    manager.typed(first.id, 'session-first', 'first question\r')
    record([{ id: firstConversation, title: 'First', createdAt: 1 }])
    manager.sessionEnded(endedSaved(first.id, folder, toolId))
    await manager.flush()
    const second = manager.createSavedSession('/work/project', folder, toolId)
    const secondConversation = second.conversationId ?? 'thread-2'
    manager.opened(second.id)
    manager.typed(second.id, 'session-second', 'second question\r')
    record([
      { id: firstConversation, title: 'First', createdAt: 1 },
      { id: secondConversation, title: 'Second', createdAt: 2 },
    ])
    manager.sessionEnded(endedSaved(second.id, folder, toolId))
    await manager.flush()
    expect(manager.get(first.id)?.conversationId).toBe(firstConversation)
    expect(manager.get(second.id)?.conversationId).toBe(secondConversation)
    return { first, second, firstConversation, secondConversation, record }
  }

  it('gives every Codex and OpenCode chat a new folder, and Claude Code chats the shared one', async () => {
    const claude = await manager.create('claude')
    const codex = await manager.create('codex')
    const opencode = await manager.create('opencode')
    const codexAgain = await manager.create('codex')

    expect(claude.folder).toBe(path.join(chatsRoot(), 'claude-code'))
    expect(fs.statSync(claude.folder).isDirectory()).toBe(true)
    for (const chat of [codex, opencode, codexAgain]) {
      expect(path.dirname(chat.folder)).toBe(chatsRoot())
      expect(chat.folder).not.toBe(claude.folder)
      expect(fs.statSync(chat.folder).isDirectory()).toBe(true)
    }
    expect(new Set([codex.folder, opencode.folder, codexAgain.folder]).size).toBe(3)

    expect(claude.conversationId).toMatch(/^[0-9a-f-]{36}$/)
    expect(opencode.conversationId).toMatch(/^ses_[0-9a-f]+$/)
    expect(codex.conversationId).toBeNull()
    expect(manager.list().map((chat) => chat.id)).toEqual([
      codexAgain.id,
      opencode.id,
      codex.id,
      claude.id,
    ])
  })

  it('keeps a chat name, title and position in the database', async () => {
    const first = await manager.create('claude')
    const second = await manager.create('codex')
    manager.setTitle(first.id, '✳ Fix the login')
    manager.rename(first.id, 'Login')
    manager.opened(first.id)

    const again = new ChatManager({ db, conversations, home: path.join(root, 'home') })
    expect(again.list()[0]).toMatchObject({
      id: first.id,
      title: '✳ Fix the login',
      customName: 'Login',
    })
    expect(again.list()[1]!.id).toBe(second.id)
  })

  it('keeps the last title an agent set when its program clears it on exit', async () => {
    const chat = await manager.create('claude')
    manager.setTitle(chat.id, '✳ Fix the login')
    manager.setTitle(chat.id, '')
    expect(manager.get(chat.id)?.title).toBe('✳ Fix the login')
  })

  it('makes a chat folder again when it was deleted, and starts its conversation anew or resumes it', async () => {
    const codex = await manager.create('codex')
    fs.rmSync(codex.folder, { recursive: true })
    const prepared = await manager.prepareSession(codex.id)
    expect(fs.statSync(codex.folder).isDirectory()).toBe(true)
    expect(prepared).toEqual({
      folder: codex.folder,
      launch: { conversationId: null, resume: false },
    })

    conversations.codex = [{ id: 'thread-1', title: 'One', createdAt: 1 }]
    manager.sessionEnded(ended(codex.id, 'codex'))
    await manager.flush()
    expect(await manager.prepareSession(codex.id)).toMatchObject({
      launch: { conversationId: 'thread-1', resume: true },
    })

    const claude = await manager.create('claude')
    expect(await manager.prepareSession(claude.id)).toMatchObject({
      launch: { conversationId: claude.conversationId, resume: false },
    })
  })

  it('splits off the conversation Claude Code left at /clear, named by its title', async () => {
    const chat = await manager.create('claude')
    manager.setTitle(chat.id, '✳ Fix the login')
    manager.noteHookEvent(chat.id, hook('UserPromptSubmit', chat.conversationId!))
    await manager.flush()
    expect(manager.get(chat.id)?.hasMessages).toBe(true)

    manager.noteHookEvent(chat.id, hook('SessionStart', 'new-conversation', 'clear'))
    await manager.flush()

    const chats = manager.list()
    expect(chats).toHaveLength(2)
    expect(manager.get(chat.id)).toMatchObject({
      conversationId: 'new-conversation',
      hasMessages: false,
      title: '',
      customName: null,
    })
    const split = chats.find((entry) => entry.id !== chat.id)!
    expect(split).toMatchObject({
      conversationId: chat.conversationId,
      title: '✳ Fix the login',
      folder: chat.folder,
      hasMessages: true,
    })
  })

  it('names the conversation Claude Code leaves at /clear by its title at that moment', async () => {
    const chat = await manager.create('claude')
    manager.setTitle(chat.id, '✳ Old conversation')
    manager.noteHookEvent(chat.id, hook('UserPromptSubmit', chat.conversationId!))
    await manager.flush()

    // The title of the next conversation comes in before the hook that tells of it,
    // and the terminal's answers to its queries are part of the input too.
    manager.typed(chat.id, 'session-1', '\x1b[?1;2c\x1b[<35;56;20M/clear\r')
    manager.setTitle(chat.id, '✳ New conversation')
    manager.noteHookEvent(chat.id, hook('SessionStart', 'new-conversation', 'clear'))
    await manager.flush()

    expect(manager.get(chat.id)?.title).toBe('✳ New conversation')
    const split = manager.list().find((entry) => entry.id !== chat.id)!
    expect(split.title).toBe('✳ Old conversation')
  })

  it('leaves only the conversation a Claude Code chat left when /clear gets no message', async () => {
    const chat = await manager.create('claude')
    manager.setTitle(chat.id, '✳ Old conversation')
    manager.noteHookEvent(chat.id, hook('UserPromptSubmit', chat.conversationId!))
    await manager.flush()
    manager.typed(chat.id, 'session-1', '/clear\r')
    manager.noteHookEvent(chat.id, hook('SessionStart', 'new-conversation', 'clear'))
    await manager.flush()
    expect(manager.list()).toHaveLength(2)

    // The new conversation never got a message: the chat goes, its split stays.
    conversations.claude = false
    manager.sessionEnded(ended(chat.id, 'claude'))
    await manager.flush()
    const chats = manager.list()
    expect(chats).toHaveLength(1)
    expect(chats[0]).toMatchObject({
      conversationId: chat.conversationId,
      title: '✳ Old conversation',
      hasMessages: true,
    })
  })

  it('does not split the conversation a Claude Code chat compacts', async () => {
    const chat = await manager.create('claude')
    manager.noteHookEvent(chat.id, hook('UserPromptSubmit', chat.conversationId!))
    await manager.flush()
    manager.noteHookEvent(chat.id, hook('SessionStart', chat.conversationId, 'compact'))
    await manager.flush()
    expect(manager.list()).toHaveLength(1)
    expect(manager.get(chat.id)).toMatchObject({
      conversationId: chat.conversationId,
      hasMessages: true,
    })
  })

  it('splits off an earlier Codex conversation when the process ends', async () => {
    const chat = await manager.create('codex')
    conversations.codex = [
      { id: 'thread-old', title: 'Old work', createdAt: 1 },
      { id: 'thread-new', title: 'New work', createdAt: 2 },
    ]
    manager.sessionEnded(ended(chat.id, 'codex'))
    await manager.flush()

    const chats = manager.list()
    expect(chats).toHaveLength(2)
    expect(manager.get(chat.id)).toMatchObject({
      conversationId: 'thread-new',
      hasMessages: true,
    })
    const split = chats.find((entry) => entry.id !== chat.id)!
    expect(split).toMatchObject({
      conversationId: 'thread-old',
      title: 'Old work',
      folder: chat.folder,
      hasMessages: true,
    })
  })

  it('splits an OpenCode chat at /new even when the new conversation gets no message', async () => {
    const chat = await manager.create('opencode')
    const old = chat.conversationId!
    manager.typed(chat.id, 'session-1', 'first question\r')
    await manager.flush()
    expect(manager.get(chat.id)?.hasMessages).toBe(true)

    manager.typed(chat.id, 'session-1', '/new\r')
    await manager.flush()
    expect(manager.get(chat.id)).toMatchObject({
      conversationId: null,
      hasMessages: false,
      title: '',
    })
    expect(manager.list()).toHaveLength(2)

    // No conversation was started after `/new`: the chat goes, and the one it
    // left stays.
    conversations.opencode = [{ id: old, title: 'First', createdAt: 1 }]
    manager.sessionEnded(ended(chat.id, 'opencode'))
    await manager.flush()
    expect(manager.list()).toHaveLength(1)
    expect(manager.list()[0]).toMatchObject({ conversationId: old, title: 'First' })
  })

  it('does not keep a chat whose agent ignored `/new` and stayed in the conversation', async () => {
    const chat = await manager.create('opencode')
    const old = chat.conversationId!
    manager.typed(chat.id, 'session-1', 'first question\r')
    await manager.flush()
    manager.typed(chat.id, 'session-1', '/new\r')
    await manager.flush()
    manager.typed(chat.id, 'session-1', 'second question\r')
    await manager.flush()
    expect(manager.list()).toHaveLength(2)

    // The agent ignored `/new`: its records hold the first conversation only,
    // which the split chat keeps; the chat that went on is the leftover.
    conversations.opencode = [{ id: old, title: 'First', createdAt: 1 }]
    const again = new ChatManager({ db, conversations, home: path.join(root, 'home') })
    await again.reconcileAll()
    const chats = again.list()
    expect(chats).toHaveLength(1)
    expect(chats[0]).toMatchObject({
      conversationId: old,
      title: 'First',
      hasMessages: true,
    })
  })

  it('keeps a chat whose agent only ran other slash commands without a message', async () => {
    const chat = await manager.create('codex')
    manager.typed(chat.id, 'session-1', '/model\r')
    await manager.flush()
    expect(manager.get(chat.id)?.hasMessages).toBe(false)
    conversations.codex = []
    manager.sessionEnded(ended(chat.id, 'codex'))
    await manager.flush()
    expect(manager.list()).toEqual([])
  })
  it('keeps a chat whose message the agent did not record, as when a request failed', async () => {
    const chat = await manager.create('codex')
    manager.typed(chat.id, 'session-1', 'Reply with the single word: ok\r')
    await manager.flush()
    conversations.codex = []
    manager.sessionEnded(ended(chat.id, 'codex'))
    await manager.flush()

    expect(manager.get(chat.id)).toMatchObject({ hasMessages: true, conversationId: null })
    expect(manager.list()).toHaveLength(1)
  })

  it('removes a chat whose conversation never got a message, and its empty folder', async () => {
    const chat = await manager.create('opencode')
    conversations.opencode = []
    manager.sessionEnded(ended(chat.id, 'opencode'))
    await manager.flush()

    expect(manager.list()).toEqual([])
    expect(fs.existsSync(chat.folder)).toBe(false)
  })

  it('keeps a folder that holds a file, and Claude Code’s shared folder', async () => {
    const opencode = await manager.create('opencode')
    fs.writeFileSync(path.join(opencode.folder, 'notes.txt'), 'keep')
    manager.sessionEnded(ended(opencode.id, 'opencode'))
    await manager.flush()
    expect(manager.list()).toEqual([])
    expect(fs.readdirSync(opencode.folder)).toEqual(['notes.txt'])

    const claude = await manager.create('claude')
    conversations.claude = false
    manager.sessionEnded(ended(claude.id, 'claude'))
    await manager.flush()
    expect(manager.list()).toEqual([])
    expect(fs.statSync(claude.folder).isDirectory()).toBe(true)
  })

  it('lets only the chat opened last take a conversation no chat has', async () => {
    const chat = await manager.create('opencode')
    const first = chat.conversationId!
    conversations.opencode = [
      { id: first, title: 'First', createdAt: 1 },
      { id: 'ses_second', title: 'Second', createdAt: 2 },
    ]
    await manager.reconcileAll()
    const split = manager.list().find((entry) => entry.id !== chat.id)!

    // A third conversation no chat has, as a /new whose chat did not say so.
    conversations.opencode = [
      { id: first, title: 'First', createdAt: 1 },
      { id: 'ses_second', title: 'Second', createdAt: 2 },
      { id: 'ses_third', title: 'Third', createdAt: 3 },
    ]
    await manager.reconcileAll()

    expect(manager.list()).toHaveLength(3)
    expect(manager.get(chat.id)?.conversationId).toBe('ses_third')
    expect(manager.get(split.id)?.conversationId).toBe(first)
    expect(manager.list().filter((entry) => entry.conversationId === 'ses_third')).toHaveLength(1)
  })

  it('reads what happened while Hoot was not running when it starts', async () => {
    const chat = await manager.create('opencode')
    const folder = chat.folder
    const first = chat.conversationId!
    conversations.opencode = [
      { id: first, title: 'First', createdAt: 1 },
      { id: 'ses_second', title: 'Second', createdAt: 2 },
    ]

    await manager.reconcileAll()

    const chats = manager.list()
    expect(chats).toHaveLength(2)
    expect(manager.get(chat.id)).toMatchObject({
      conversationId: 'ses_second',
      hasMessages: true,
    })
    expect(chats.find((entry) => entry.id !== chat.id)).toMatchObject({
      conversationId: first,
      title: 'First',
      folder,
    })

    // Reading again does not split the same conversation twice.
    await manager.reconcileAll()
    expect(manager.list()).toHaveLength(2)
    expect(manager.get(chat.id)?.conversationId).toBe('ses_second')
    expect(manager.list().find((entry) => entry.id !== chat.id)?.conversationId).toBe(first)
  })

  it('keeps a saved session of a worktree apart from the chats, with its folder as it is', () => {
    const worktree = path.join(root, 'worktrees', 'fix-login-bug')
    fs.mkdirSync(worktree, { recursive: true })

    const saved = manager.createSavedSession('/work/project', worktree, 'claude')
    const later = manager.createSavedSession('/work/project', worktree, 'codex')

    expect(saved).toMatchObject({
      folder: worktree,
      projectRoot: '/work/project',
      worktreePath: worktree,
      hasMessages: false,
    })
    expect(saved.conversationId).toMatch(/^[0-9a-f-]{36}$/)
    expect(manager.listSavedSessions().map((entry) => entry.id)).toEqual([saved.id, later.id])
    expect(manager.list().map((entry) => entry.id)).toEqual([])
    // It starts in the worktree, and Hoot makes nothing in it.
    expect(fs.readdirSync(worktree)).toEqual([])
  })

  it('removes the saved sessions of a worktree that is deleted, and no others', () => {
    const first = path.join(root, 'worktrees', 'first')
    const second = path.join(root, 'worktrees', 'second')
    const kept = manager.createSavedSession('/work/project', second, 'claude')
    manager.createSavedSession('/work/project', first, 'claude')
    manager.createSavedSession('/work/project', first, 'codex')

    manager.removeForWorktree(first)

    expect(manager.listSavedSessions().map((entry) => entry.id)).toEqual([kept.id])
  })

  it('removes a saved session that never got a message when its agent ends, keeping the worktree', async () => {
    const worktree = path.join(root, 'worktrees', 'fix-login-bug')
    fs.mkdirSync(worktree, { recursive: true })
    const saved = manager.createSavedSession('/work/project', worktree, 'claude')
    conversations.claude = false

    manager.sessionEnded({
      id: 'session-1',
      projectRoot: '/work/project',
      worktreePath: worktree,
      chatId: null,
      savedSessionId: saved.id,
      toolId: 'claude',
      issueId: null,
      status: 'exited',
      exit: { code: 0, signal: null, abnormal: false },
    })
    await manager.flush()

    expect(manager.get(saved.id)).toBeUndefined()
    expect(fs.statSync(worktree).isDirectory()).toBe(true)
  })

  it('keeps a saved session that got a message, and opens it again on its conversation', async () => {
    const worktree = path.join(root, 'worktrees', 'fix-login-bug')
    fs.mkdirSync(worktree, { recursive: true })
    const saved = manager.createSavedSession('/work/project', worktree, 'claude')
    manager.noteHookEvent(saved.id, hook('UserPromptSubmit', saved.conversationId))
    await manager.flush()

    expect(manager.get(saved.id)).toMatchObject({ hasMessages: true })
    const prepared = await manager.prepareSession(saved.id)
    expect(prepared).toEqual({
      folder: worktree,
      launch: { conversationId: saved.conversationId, resume: true },
    })
  })

  it('splits a saved session’s conversation off below the same worktree, after it', async () => {
    const worktree = path.join(root, 'worktrees', 'fix-login-bug')
    fs.mkdirSync(worktree, { recursive: true })
    const saved = manager.createSavedSession('/work/project', worktree, 'codex')
    conversations.codex = [
      { id: 'first', title: 'First', createdAt: 1 },
      { id: 'second', title: 'Second', createdAt: 2 },
    ]
    manager.noteHookEvent(saved.id, hook('UserPromptSubmit', null, null))
    manager.typed(saved.id, 'session-1', '/new\r')
    manager.sessionEnded({
      id: 'session-1',
      projectRoot: '/work/project',
      worktreePath: worktree,
      chatId: null,
      savedSessionId: saved.id,
      toolId: 'codex',
      issueId: null,
      status: 'exited',
      exit: { code: 0, signal: null, abnormal: false },
    })
    await manager.flush()

    const split = manager.listSavedSessions()
    expect(split).toHaveLength(2)
    expect(split[0]!.id).toBe(saved.id)
    expect(split[1]).toMatchObject({
      folder: worktree,
      projectRoot: '/work/project',
      worktreePath: worktree,
      toolId: 'codex',
      conversationId: 'first',
    })
    expect(manager.get(saved.id)?.conversationId).toBe('second')
  })

  it('deletes a Claude Code chat for good, leaving the shared folder and what is in it', async () => {
    const chat = await manager.create('claude')
    const other = await manager.create('claude')
    fs.writeFileSync(path.join(chat.folder, 'notes.txt'), 'keep')
    manager.noteHookEvent(chat.id, hook('UserPromptSubmit', chat.conversationId))
    await manager.flush()
    conversations.claude = true

    await manager.delete(chat.id)

    expect(manager.list().map((entry) => entry.id)).toEqual([other.id])
    expect(manager.get(chat.id)).toBeUndefined()
    expect(fs.readdirSync(chat.folder)).toEqual(['notes.txt'])
    expect(trashed).toEqual([])
    const again = await restarted()
    expect(again.list().map((entry) => entry.id)).toEqual([other.id])
    expect(again.get(chat.id)).toBeUndefined()
  })

  it('no longer starts, renames or opens a deleted chat', async () => {
    const chat = await manager.create('opencode')
    manager.typed(chat.id, 'session-1', 'question\r')
    await manager.flush()
    await manager.delete(chat.id)

    expect(await manager.prepareSession(chat.id)).toBeNull()
    expect(manager.rename(chat.id, 'Back')).toBe(false)
    manager.opened(chat.id)
    manager.setTitle(chat.id, 'A title')
    expect(manager.list()).toEqual([])
    expect(manager.get(chat.id)).toBeUndefined()
  })

  for (const toolId of ['codex', 'opencode'] as const) {
    it(`keeps the conversation of a deleted ${toolId} saved session from the other sessions of its worktree`, async () => {
      const folder = worktreeFolder('fix-login-bug')
      const { first, second, firstConversation } = await twoSavedSessions(toolId, folder)
      manager.rename(first.id, 'Kept')

      await manager.delete(second.id)

      expect(manager.listSavedSessions().map((entry) => entry.id)).toEqual([first.id])
      expect(manager.get(second.id)).toBeUndefined()
      // Opened last, the one left is the one an agent's later conversation
      // would belong to; the deleted one's is not one of them.
      manager.opened(first.id)
      const again = await restarted()
      expect(again.listSavedSessions()).toEqual([
        expect.objectContaining({
          id: first.id,
          conversationId: firstConversation,
          customName: 'Kept',
        }),
      ])
      // The worktree stays as it was.
      expect(fs.readdirSync(folder)).toEqual(['README.md'])
      expect(fs.readFileSync(path.join(folder, 'README.md'), 'utf8')).toBe('# Project\n')
    })

    it(`gives the conversation of a deleted ${toolId} saved session to no session made after it`, async () => {
      const folder = worktreeFolder('fix-login-bug')
      const { first, second, secondConversation } = await twoSavedSessions(toolId, folder)

      await manager.delete(first.id)
      // A new session, closed without a message.
      const third = manager.createSavedSession('/work/project', folder, toolId)
      manager.opened(third.id)
      manager.sessionEnded(endedSaved(third.id, folder, toolId))
      await manager.flush()

      expect(manager.get(third.id)).toBeUndefined()
      const again = await restarted()
      expect(again.listSavedSessions()).toEqual([
        expect.objectContaining({ id: second.id, conversationId: secondConversation }),
      ])
    })
  }

  it('learns the conversation of a Codex saved session deleted while it ran, before any other takes it', async () => {
    const folder = worktreeFolder('fix-login-bug')
    const first = manager.createSavedSession('/work/project', folder, 'codex')
    conversations.codex = [{ id: 'thread-1', title: 'First', createdAt: 1 }]
    manager.opened(first.id)
    manager.sessionEnded(endedSaved(first.id, folder, 'codex'))
    await manager.flush()
    const second = manager.createSavedSession('/work/project', folder, 'codex')
    manager.opened(second.id)
    manager.typed(second.id, 'session-second', 'second question\r')
    // The first is opened again after it, so that it is the one opened last.
    manager.opened(first.id)
    conversations.codex = [
      { id: 'thread-1', title: 'First', createdAt: 1 },
      { id: 'thread-2', title: 'Second', createdAt: 2 },
    ]

    // Deleted while its agent still ran, as when Hoot quit before it saw it end.
    await manager.delete(second.id)
    expect(manager.listSavedSessions().map((entry) => entry.id)).toEqual([first.id])

    const again = await restarted()
    expect(again.listSavedSessions()).toEqual([
      expect.objectContaining({ id: first.id, conversationId: 'thread-1' }),
    ])

    // Deleted once its agent ended, it takes its conversation along at once.
    const third = again.createSavedSession('/work/project', folder, 'codex')
    again.opened(third.id)
    again.typed(third.id, 'session-third', 'third question\r')
    conversations.codex = [
      { id: 'thread-1', title: 'First', createdAt: 1 },
      { id: 'thread-2', title: 'Second', createdAt: 2 },
      { id: 'thread-3', title: 'Third', createdAt: 3 },
    ]
    again.sessionEnded(endedSaved(third.id, folder, 'codex'))
    await again.delete(third.id)
    again.opened(first.id)
    const later = await restarted()
    expect(later.listSavedSessions()).toEqual([
      expect.objectContaining({ id: first.id, conversationId: 'thread-1' }),
    ])
  })

  it('keeps the conversation a deleted Codex chat went on to after /new from the chat it split off', async () => {
    const chat = await manager.create('codex')
    manager.opened(chat.id)
    manager.typed(chat.id, 'session-1', 'first question\r')
    manager.typed(chat.id, 'session-1', '/new\r')
    manager.typed(chat.id, 'session-1', 'second question\r')
    conversations.codex = [
      { id: 'thread-1', title: 'First', createdAt: 1 },
      { id: 'thread-2', title: 'Second', createdAt: 2 },
    ]
    manager.sessionEnded(ended(chat.id, 'codex'))
    await manager.flush()
    const split = manager.list().find((entry) => entry.id !== chat.id)!
    expect(split.conversationId).toBe('thread-1')
    expect(manager.get(chat.id)?.conversationId).toBe('thread-2')
    fs.writeFileSync(path.join(chat.folder, 'notes.txt'), 'keep')

    await manager.delete(chat.id)

    // The folder stays while the other chat runs in it.
    expect(trashed).toEqual([])
    expect(fs.readdirSync(chat.folder)).toEqual(['notes.txt'])
    manager.opened(split.id)
    const again = await restarted()
    expect(again.list()).toEqual([
      expect.objectContaining({ id: split.id, conversationId: 'thread-1' }),
    ])
  })

  it('keeps the conversation a deleted OpenCode chat went on to after /new from the chat it left', async () => {
    const chat = await manager.create('opencode')
    const old = chat.conversationId!
    manager.opened(chat.id)
    manager.typed(chat.id, 'session-1', 'first question\r')
    manager.typed(chat.id, 'session-1', '/new\r')
    manager.typed(chat.id, 'session-1', 'second question\r')
    await manager.flush()
    const split = manager.list().find((entry) => entry.id !== chat.id)!
    expect(split.conversationId).toBe(old)

    // Deleted while it still ran, before Hoot learned the conversation it went on to.
    conversations.opencode = [
      { id: old, title: 'First', createdAt: 1 },
      { id: 'ses_second', title: 'Second', createdAt: 2 },
    ]
    manager.sessionEnded(ended(chat.id, 'opencode'))
    await manager.delete(chat.id)

    manager.opened(split.id)
    const again = await restarted()
    expect(again.list()).toEqual([expect.objectContaining({ id: split.id, conversationId: old })])
  })

  it('moves the folder of a deleted chat to the Trash with what is in it, once no other chat runs in it', async () => {
    const chat = await manager.create('opencode')
    const old = chat.conversationId!
    manager.typed(chat.id, 'session-1', 'first question\r')
    manager.typed(chat.id, 'session-1', '/new\r')
    manager.typed(chat.id, 'session-1', 'second question\r')
    conversations.opencode = [
      { id: old, title: 'First', createdAt: 1 },
      { id: 'ses_second', title: 'Second', createdAt: 2 },
    ]
    manager.sessionEnded(ended(chat.id, 'opencode'))
    await manager.flush()
    const split = manager.list().find((entry) => entry.id !== chat.id)!
    fs.writeFileSync(path.join(chat.folder, 'notes.txt'), 'keep')

    await manager.delete(split.id)
    expect(trashed).toEqual([])
    expect(fs.readdirSync(chat.folder)).toEqual(['notes.txt'])
    expect(manager.list().map((entry) => entry.id)).toEqual([chat.id])

    await manager.delete(chat.id)
    expect(trashed).toEqual([chat.folder])
    expect(fs.existsSync(chat.folder)).toBe(false)
    expect(fs.readdirSync(path.join(root, 'Trash', path.basename(chat.folder)))).toEqual([
      'notes.txt',
    ])
    expect(manager.list()).toEqual([])
    // Nothing of the folder's chats is kept once it is gone.
    expect(db.prepare('SELECT COUNT(*) AS count FROM chats').get()).toEqual({ count: 0 })
  })

  it('deletes a chat whose folder cannot go to the Trash, leaving the folder as it is', async () => {
    const chat = await manager.create('codex')
    manager.typed(chat.id, 'session-1', 'question\r')
    conversations.codex = [{ id: 'thread-1', title: 'Question', createdAt: 1 }]
    manager.sessionEnded(ended(chat.id, 'codex'))
    await manager.flush()
    fs.writeFileSync(path.join(chat.folder, 'notes.txt'), 'keep')
    trash = async () => {
      throw new Error('The folder is in use.')
    }

    await manager.delete(chat.id)

    expect(manager.list()).toEqual([])
    expect(fs.readdirSync(chat.folder)).toEqual(['notes.txt'])
    const again = await restarted()
    expect(again.list()).toEqual([])
  })

  it('leaves the other chats and saved sessions as they are', async () => {
    const folder = worktreeFolder('fix-login-bug')
    const { first, second } = await twoSavedSessions('opencode', folder)
    manager.rename(second.id, 'Second one')
    const chat = await manager.create('claude')
    manager.rename(chat.id, 'Chat')
    const before = { chats: manager.list(), saved: manager.listSavedSessions() }

    await manager.delete(first.id)

    expect(manager.list()).toEqual(before.chats)
    expect(manager.listSavedSessions()).toEqual(
      before.saved.filter((entry) => entry.id !== first.id),
    )
  })

  for (const toolId of ['codex', 'opencode'] as const) {
    for (const kind of ['saved session', 'chat'] as const) {
      it(`leaves the conversation a running ${toolId} ${kind} went on to after /new to it when the one split off is deleted`, async () => {
        const folder = worktreeFolder('fix-login-bug')
        const made =
          kind === 'chat'
            ? await manager.create(toolId)
            : manager.createSavedSession('/work/project', folder, toolId)
        const listed = (from: ChatManager) =>
          kind === 'chat' ? from.list() : from.listSavedSessions()
        const end = () =>
          manager.sessionEnded(
            kind === 'chat' ? ended(made.id, toolId) : endedSaved(made.id, folder, toolId),
          )
        const record = (list: AgentConversation[]) => {
          if (toolId === 'codex') conversations.codex = list
          else conversations.opencode = list
        }
        const first = made.conversationId ?? 'thread-1'
        manager.opened(made.id)
        manager.typed(made.id, 'session-1', 'first question\r')
        record([{ id: first, title: 'First', createdAt: 1 }])
        end()
        await manager.flush()
        // Opened again, it starts another conversation, whose id Hoot learns
        // once its agent ends.
        manager.opened(made.id)
        manager.typed(made.id, 'session-2', '/new\r')
        manager.typed(made.id, 'session-2', 'second question\r')
        await manager.flush()
        const split = listed(manager).find((entry) => entry.id !== made.id)!
        expect(split.conversationId).toBe(first)
        record([
          { id: first, title: 'First', createdAt: 1 },
          { id: 'second', title: 'Second', createdAt: 2 },
        ])

        await manager.delete(split.id)
        end()
        await manager.flush()

        expect(listed(manager)).toEqual([
          expect.objectContaining({ id: made.id, conversationId: 'second' }),
        ])
        const again = await restarted()
        expect(listed(again)).toEqual([
          expect.objectContaining({ id: made.id, conversationId: 'second' }),
        ])
      })
    }
  }

  it('leaves the conversation a running session started to it when a session without one is deleted', async () => {
    const folder = worktreeFolder('fix-login-bug')
    // A message its agent did not record leaves it without a conversation.
    const broken = manager.createSavedSession('/work/project', folder, 'codex')
    manager.opened(broken.id)
    manager.typed(broken.id, 'session-broken', 'question\r')
    manager.sessionEnded(endedSaved(broken.id, folder, 'codex'))
    await manager.flush()
    expect(manager.get(broken.id)).toEqual(
      expect.objectContaining({ conversationId: null, hasMessages: true }),
    )
    const running = manager.createSavedSession('/work/project', folder, 'codex')
    manager.opened(running.id)
    manager.typed(running.id, 'session-running', 'question\r')
    conversations.codex = [{ id: 'thread-1', title: 'Question', createdAt: 1 }]

    await manager.delete(broken.id)
    manager.sessionEnded(endedSaved(running.id, folder, 'codex'))
    await manager.flush()

    expect(manager.listSavedSessions()).toEqual([
      expect.objectContaining({ id: running.id, conversationId: 'thread-1' }),
    ])
    const again = await restarted()
    expect(again.listSavedSessions()).toEqual([
      expect.objectContaining({ id: running.id, conversationId: 'thread-1' }),
    ])
  })

  it('leaves a later conversation to the session it is of when the session opened last is deleted', async () => {
    const folder = worktreeFolder('fix-login-bug')
    const deleted = manager.createSavedSession('/work/project', folder, 'codex')
    manager.opened(deleted.id)
    manager.typed(deleted.id, 'session-1', 'first question\r')
    conversations.codex = [{ id: 'thread-1', title: 'First', createdAt: 1 }]
    manager.sessionEnded(endedSaved(deleted.id, folder, 'codex'))
    await manager.flush()
    // Codex's records cannot be read when the other's agent ends, nor when
    // the first is opened again, last, and ends.
    const other = manager.createSavedSession('/work/project', folder, 'codex')
    manager.opened(other.id)
    manager.typed(other.id, 'session-2', 'second question\r')
    conversations.codex = null
    manager.sessionEnded(endedSaved(other.id, folder, 'codex'))
    await manager.flush()
    manager.opened(deleted.id)
    manager.sessionEnded(endedSaved(deleted.id, folder, 'codex'))
    await manager.flush()
    conversations.codex = [
      { id: 'thread-1', title: 'First', createdAt: 1 },
      { id: 'thread-2', title: 'Second', createdAt: 2 },
    ]

    await manager.delete(deleted.id)

    const again = await restarted()
    expect(again.listSavedSessions()).toEqual([
      expect.objectContaining({ id: other.id, conversationId: 'thread-2' }),
    ])
  })

  for (const toolId of ['codex', 'opencode'] as const) {
    it(`keeps a ${toolId} saved session deleted while another of its worktree ran out of Hoot`, async () => {
      const folder = worktreeFolder('fix-login-bug')
      const deleted = manager.createSavedSession('/work/project', folder, toolId)
      const other = manager.createSavedSession('/work/project', folder, toolId)
      // Both start a conversation Hoot does not know while both run.
      for (const [saved, message] of [
        [deleted, 'first question\r'],
        [other, 'second question\r'],
      ] as const) {
        manager.opened(saved.id)
        if (toolId === 'opencode') manager.typed(saved.id, `session-${saved.id}`, '/new\r')
        manager.typed(saved.id, `session-${saved.id}`, message)
      }
      const recorded = [
        { id: 'first', title: 'First', createdAt: 1 },
        { id: 'second', title: 'Second', createdAt: 2 },
      ]
      if (toolId === 'codex') conversations.codex = recorded
      else conversations.opencode = recorded

      // As deleting a running session does: its agent ends first.
      manager.sessionEnded(endedSaved(deleted.id, folder, toolId))
      await manager.delete(deleted.id)
      expect(manager.get(deleted.id)).toBeUndefined()
      expect(manager.listSavedSessions().map((entry) => entry.id)).not.toContain(deleted.id)
      manager.sessionEnded(endedSaved(other.id, folder, toolId))
      await manager.flush()

      const again = await restarted()
      expect(again.get(deleted.id)).toBeUndefined()
      expect(again.listSavedSessions().map((entry) => entry.id)).not.toContain(deleted.id)
    })
  }

  /** A project's own folder, with a file in it. */
  const projectFolder = (): string => {
    const folder = path.join(root, 'projects', 'app')
    fs.mkdirSync(folder, { recursive: true })
    fs.writeFileSync(path.join(folder, 'README.md'), '# App\n')
    return folder
  }

  /** Two conversations an agent had in the project folder out of Hoot, before any session there. */
  const outside: AgentConversation[] = [
    { id: 'outside-1', title: 'Outside 1', createdAt: 10 },
    { id: 'outside-2', title: 'Outside 2', createdAt: 20 },
  ]

  it('keeps a saved session in the project folder apart from the chats, and never makes the folder', async () => {
    const folder = projectFolder()
    const local = manager.createSavedSession(folder, null, 'claude')

    expect(local).toMatchObject({
      folder,
      projectRoot: folder,
      worktreePath: null,
      hasMessages: false,
    })
    expect(manager.listSavedSessions().map((entry) => entry.id)).toEqual([local.id])
    expect(manager.list()).toEqual([])
    expect(fs.readdirSync(folder)).toEqual(['README.md'])

    // One whose folder is gone, as when it was renamed, does not make it again.
    fs.renameSync(folder, `${folder}-renamed`)
    expect(await manager.prepareSession(local.id)).toEqual({
      folder,
      launch: { conversationId: local.conversationId, resume: false },
    })
    expect(fs.existsSync(folder)).toBe(false)
  })

  it('keeps a Claude Code session of the project folder that got a message, and resumes it', async () => {
    const folder = projectFolder()
    const local = manager.createSavedSession(folder, null, 'claude')
    manager.opened(local.id)
    manager.noteHookEvent(local.id, hook('UserPromptSubmit', local.conversationId))
    conversations.claude = true
    manager.sessionEnded(endedLocal(local.id, folder, 'claude'))
    await manager.flush()

    const again = await restarted()
    expect(again.listSavedSessions()).toEqual([
      expect.objectContaining({ id: local.id, worktreePath: null, hasMessages: true }),
    ])
    expect(await again.prepareSession(local.id)).toEqual({
      folder,
      launch: { conversationId: local.conversationId, resume: true },
    })
  })

  it('leaves the project folder as it is when its sessions go', async () => {
    const folder = projectFolder()
    // One that never got a message goes once its agent ends.
    const empty = manager.createSavedSession(folder, null, 'codex')
    manager.opened(empty.id)
    manager.sessionEnded(endedLocal(empty.id, folder, 'codex'))
    await manager.flush()
    expect(manager.get(empty.id)).toBeUndefined()
    // One the user deletes goes too.
    const deleted = manager.createSavedSession(folder, null, 'opencode')
    await manager.delete(deleted.id)
    expect(manager.listSavedSessions()).toEqual([])

    expect(trashed).toEqual([])
    expect(fs.readdirSync(folder)).toEqual(['README.md'])
  })

  for (const toolId of ['codex', 'opencode'] as const) {
    const record = (list: AgentConversation[]) => {
      if (toolId === 'codex') conversations.codex = list
      else conversations.opencode = list
    }

    it(`gives a ${toolId} session of the project folder none of the conversations from before it`, async () => {
      const folder = projectFolder()
      record(outside)
      const local = manager.createSavedSession(folder, null, toolId)
      const own = local.conversationId ?? 'thread-own'
      manager.opened(local.id)
      manager.typed(local.id, 'session-local', 'a question\r')
      record([...outside, { id: own, title: 'Own', createdAt: local.createdAt + 5 }])
      manager.sessionEnded(endedLocal(local.id, folder, toolId))
      await manager.flush()

      expect(manager.listSavedSessions()).toEqual([
        expect.objectContaining({ id: local.id, conversationId: own, hasMessages: true }),
      ])
      // Opened last, it still takes none of them up when Hoot starts again.
      manager.opened(local.id)
      const again = await restarted()
      expect(again.listSavedSessions()).toEqual([
        expect.objectContaining({ id: local.id, conversationId: own }),
      ])
    })

    it(`splits off what a ${toolId} session of the project folder left at /new, and nothing older`, async () => {
      const folder = projectFolder()
      record(outside)
      const local = manager.createSavedSession(folder, null, toolId)
      const first = local.conversationId ?? 'thread-1'
      manager.opened(local.id)
      manager.typed(local.id, 'session-local', 'first question\r')
      manager.typed(local.id, 'session-local', '/new\r')
      manager.typed(local.id, 'session-local', 'second question\r')
      record([
        ...outside,
        { id: first, title: 'First', createdAt: local.createdAt + 1 },
        { id: 'thread-2', title: 'Second', createdAt: local.createdAt + 2 },
      ])
      manager.sessionEnded(endedLocal(local.id, folder, toolId))
      await manager.flush()

      const listed = manager.listSavedSessions()
      expect(listed.map((entry) => [entry.id === local.id, entry.conversationId])).toEqual([
        [true, 'thread-2'],
        [false, first],
      ])
      expect(listed[1]).toMatchObject({ folder, projectRoot: folder, worktreePath: null })
      // The one split off keeps its conversation, which began before it was split off.
      const again = await restarted()
      expect(again.listSavedSessions().map((entry) => entry.conversationId)).toEqual([
        'thread-2',
        first,
      ])
    })

    it(`gives a new ${toolId} session of the project folder nothing from before it, once the others are deleted`, async () => {
      const folder = projectFolder()
      record(outside)
      const deleted = manager.createSavedSession(folder, null, toolId)
      const deletedOwn = deleted.conversationId ?? 'thread-deleted'
      manager.opened(deleted.id)
      manager.typed(deleted.id, 'session-deleted', 'a question\r')
      const recorded = [
        ...outside,
        { id: deletedOwn, title: 'Deleted', createdAt: deleted.createdAt + 1 },
      ]
      record(recorded)
      manager.sessionEnded(endedLocal(deleted.id, folder, toolId))
      await manager.flush()
      await manager.delete(deleted.id)
      // Another conversation out of Hoot, before the next session.
      recorded.push({ id: 'outside-3', title: 'Outside 3', createdAt: clock })

      const local = manager.createSavedSession(folder, null, toolId)
      const own = local.conversationId ?? 'thread-own'
      manager.opened(local.id)
      manager.typed(local.id, 'session-local', 'another question\r')
      record([...recorded, { id: own, title: 'Own', createdAt: local.createdAt + 1 }])
      manager.sessionEnded(endedLocal(local.id, folder, toolId))
      await manager.flush()

      const again = await restarted()
      expect(again.listSavedSessions()).toEqual([
        expect.objectContaining({ id: local.id, conversationId: own }),
      ])
    })

    it(`gives ${toolId} sessions of the project folder that ran side by side nothing from before them`, async () => {
      const folder = projectFolder()
      record(outside)
      const first = manager.createSavedSession(folder, null, toolId)
      const second = manager.createSavedSession(folder, null, toolId)
      // Both start a conversation Hoot does not know while both run.
      for (const [saved, message] of [
        [first, 'first question\r'],
        [second, 'second question\r'],
      ] as const) {
        manager.opened(saved.id)
        if (toolId === 'opencode') manager.typed(saved.id, `session-${saved.id}`, '/new\r')
        manager.typed(saved.id, `session-${saved.id}`, message)
      }
      record([
        ...outside,
        { id: 'side-1', title: 'Side 1', createdAt: second.createdAt + 1 },
        { id: 'side-2', title: 'Side 2', createdAt: second.createdAt + 2 },
      ])
      manager.sessionEnded(endedLocal(first.id, folder, toolId))
      manager.sessionEnded(endedLocal(second.id, folder, toolId))
      await manager.flush()

      const again = await restarted()
      const held = again.listSavedSessions().map((entry) => entry.conversationId)
      expect(held.length).toBeGreaterThan(0)
      expect(held).not.toContain('outside-1')
      expect(held).not.toContain('outside-2')
    })

    /**
     * A session S of the project folder that got a message, its agent ended,
     * and a later one, L, whose agent runs and started a conversation Hoot
     * does not know yet, before S is opened again: the two agents run side
     * by side, and neither starts another conversation meanwhile.
     */
    const sideBySide = async (folder: string) => {
      /** Starts a session's agent as Hoot does. */
      const start = async (id: string) => {
        await manager.prepareSession(id)
        manager.opened(id)
      }
      const earlier = manager.createSavedSession(folder, null, toolId)
      const own = earlier.conversationId ?? 'thread-earlier'
      await start(earlier.id)
      manager.typed(earlier.id, 'session-earlier-1', 'a question\r')
      const recorded: AgentConversation[] = [
        { id: own, title: 'Earlier', createdAt: earlier.createdAt + 1 },
      ]
      record(recorded)
      manager.sessionEnded(endedLocal(earlier.id, folder, toolId))
      await manager.flush()

      const later = manager.createSavedSession(folder, null, toolId)
      await start(later.id)
      if (toolId === 'opencode') manager.typed(later.id, 'session-later', '/new\r')
      manager.typed(later.id, 'session-later', 'another question\r')
      recorded.push({ id: 'thread-later', title: 'Later', createdAt: ++clock })
      record(recorded)
      await start(earlier.id)
      await manager.flush()
      return { earlier, own, later }
    }

    it(`keeps a ${toolId} session of the project folder on its conversation when it ends while another runs`, async () => {
      const folder = projectFolder()
      const { earlier, own, later } = await sideBySide(folder)

      manager.sessionEnded(endedLocal(earlier.id, folder, toolId))
      await manager.flush()
      // The conversation the later one started is not the earlier one's.
      expect(manager.listSavedSessions().map((entry) => [entry.id, entry.conversationId])).toEqual([
        [earlier.id, own],
        [later.id, null],
      ])

      manager.sessionEnded(endedLocal(later.id, folder, toolId))
      await manager.flush()
      const expected = [
        [earlier.id, own],
        [later.id, 'thread-later'],
      ]
      expect(manager.listSavedSessions().map((entry) => [entry.id, entry.conversationId])).toEqual(
        expected,
      )
      const again = await restarted()
      expect(again.listSavedSessions().map((entry) => [entry.id, entry.conversationId])).toEqual(
        expected,
      )
    })

    it(`keeps each ${toolId} session of the project folder on its conversation when both end at once`, async () => {
      for (const order of ['earlier first', 'later first'] as const) {
        const folder = path.join(projectFolder(), order.replace(' ', '-'))
        fs.mkdirSync(folder)
        const { earlier, own, later } = await sideBySide(folder)
        const both = order === 'earlier first' ? [earlier, later] : [later, earlier]
        // Each is read once both ended.
        for (const saved of both) manager.sessionEnded(endedLocal(saved.id, folder, toolId))
        await manager.flush()
        expect(
          manager
            .listSavedSessions()
            .filter((entry) => entry.folder === folder)
            .map((entry) => [entry.id, entry.conversationId]),
        ).toEqual([
          [earlier.id, own],
          [later.id, 'thread-later'],
        ])
      }
    })

    it(`removes a ${toolId} session of the project folder left empty at /new while another runs, and nothing else`, async () => {
      const folder = projectFolder()
      const { earlier, own, later } = await sideBySide(folder)
      manager.typed(earlier.id, 'session-earlier-2', '/new\r')
      await manager.flush()

      manager.sessionEnded(endedLocal(earlier.id, folder, toolId))
      manager.sessionEnded(endedLocal(later.id, folder, toolId))
      await manager.flush()
      // The conversation it left stays as a session of its own.
      const listed = manager.listSavedSessions()
      expect(listed.map((entry) => entry.id)).not.toContain(earlier.id)
      expect(listed.map((entry) => [entry.id === later.id, entry.conversationId])).toEqual([
        [true, 'thread-later'],
        [false, own],
      ])
    })
  }

  it('still splits off every earlier conversation of a worktree for a saved session there', async () => {
    const folder = worktreeFolder('fix-login-bug')
    conversations.codex = outside
    const saved = manager.createSavedSession('/work/project', folder, 'codex')
    manager.opened(saved.id)
    manager.typed(saved.id, 'session-saved', 'a question\r')
    conversations.codex = [...outside, { id: 'own', title: 'Own', createdAt: saved.createdAt + 1 }]
    manager.sessionEnded(endedSaved(saved.id, folder, 'codex'))
    await manager.flush()

    expect(manager.listSavedSessions().map((entry) => entry.conversationId)).toEqual([
      'own',
      'outside-1',
      'outside-2',
    ])
  })
})

describe('ownConversations', () => {
  const recorded: AgentConversation[] = [
    { id: 'old', title: null, createdAt: 10 },
    { id: 'kept', title: null, createdAt: 20 },
    { id: 'unknown', title: null, createdAt: 0 },
    { id: 'new', title: null, createdAt: 40 },
  ]

  it('leaves a session of a project folder its own conversation and those since it was made', () => {
    const local = { projectRoot: '/work/app', worktreePath: null, createdAt: 30 }
    expect(
      ownConversations({ ...local, conversationId: null }, recorded).map((entry) => entry.id),
    ).toEqual(['new'])
    expect(
      ownConversations({ ...local, conversationId: 'kept' }, recorded).map((entry) => entry.id),
    ).toEqual(['kept', 'new'])
    expect(
      ownConversations({ ...local, createdAt: 40, conversationId: null }, recorded).map(
        (entry) => entry.id,
      ),
    ).toEqual(['new'])
  })

  it('leaves a session of a project folder only those since its agent began to start, once it ends', () => {
    const local = { projectRoot: '/work/app', worktreePath: null, createdAt: 15 }
    expect(
      ownConversations({ ...local, conversationId: 'kept' }, recorded).map((entry) => entry.id),
    ).toEqual(['kept', 'new'])
    expect(
      ownConversations({ ...local, conversationId: 'old' }, recorded, 30).map((entry) => entry.id),
    ).toEqual(['old', 'new'])
    expect(
      ownConversations({ ...local, conversationId: null }, recorded, 30).map((entry) => entry.id),
    ).toEqual(['new'])
    // Nor any from before it was made, as for one split off since.
    expect(
      ownConversations({ ...local, createdAt: 45, conversationId: 'kept' }, recorded, 30).map(
        (entry) => entry.id,
      ),
    ).toEqual(['kept'])
  })

  it('leaves a chat and a saved session of a worktree every conversation', () => {
    for (const owner of [
      { projectRoot: null, worktreePath: null },
      { projectRoot: '/work/app', worktreePath: '/work/app-fix' },
    ]) {
      for (const runStartedAt of [null, 35]) {
        expect(
          ownConversations(
            { ...owner, createdAt: 30, conversationId: null },
            recorded,
            runStartedAt,
          ),
        ).toEqual(recorded)
      }
    }
  })
})

const makeId = () => 'ABC-123'

describe('visibleInput', () => {
  it('leaves what the user typed, without the answers a terminal gives or escape sequences', () => {
    expect(
      visibleInput(
        '\x1b[I\x1b[?1;2c\x1b[?2026;2$y\x1b[<35;56;20M\x1b]0;a title\x07Reply with one word',
      ),
    ).toBe('Reply with one word')
    expect(visibleInput('\x1b[<0;1;1M/clear')).toBe('/clear')
    expect(visibleInput('\x1bP>|xterm.js(6.1.0)\x1b\\hello')).toBe('hello')
  })
})

describe('newConversationId', () => {
  it('picks an id Claude Code and OpenCode accept, and none for Codex', () => {
    expect(newConversationId('claude', makeId)).toBe('ABC-123')
    expect(newConversationId('opencode', makeId)).toBe('ses_ABC123')
    expect(newConversationId('codex', makeId)).toBeNull()
  })
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { HookEventReport } from '../../shared/hoot-cli'
import type { SessionInfo } from '../../shared/session'
import { openDatabase } from '../database/database'
import { ChatManager, newConversationId, visibleInput } from './chat-manager'
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

const ended = (chatId: string, toolId: 'claude' | 'codex' | 'opencode'): SessionInfo => ({
  id: `session-${chatId}`,
  projectRoot: `/chats/${chatId}`,
  worktreePath: null,
  chatId,
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

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-chats-'))
    db = openDatabase(path.join(root, 'data', 'hoot.db'))
    conversations = new FakeConversations()
    clock = 1_000
    manager = new ChatManager({
      db,
      conversations,
      home: path.join(root, 'home'),
      now: () => ++clock,
    })
  })

  afterEach(() => {
    db.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  const chatsRoot = () => path.join(root, 'home', '.hoot', 'chats')

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

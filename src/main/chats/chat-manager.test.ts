import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { HookEventReport } from '../../shared/hoot-cli'
import type { SessionInfo } from '../../shared/session'
import { openDatabase } from '../database/database'
import { ChatManager, newConversationId, ownConversations, visibleInput } from './chat-manager'
import { ChatStore } from './chat-store'
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
  startedAt = 1_000,
): HookEventReport => ({
  event,
  startedAt,
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

  /**
   * Adds a chat that an earlier version of Hoot split off from a chat, in the
   * same folder, with a conversation of its own, and returns its id.
   */
  const splitOff = (chatId: string, conversationId: string): string => {
    const chat = manager.get(chatId)!
    const id = `split-${conversationId}`
    new ChatStore(db).insert({
      ...chat,
      id,
      conversationId,
      title: '',
      customName: null,
      hasMessages: true,
      createdAt: ++clock,
    })
    return id
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

    // Claude Code and Codex pick the ids of their conversations.
    expect(claude.conversationId).toBeNull()
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

    manager.typed(codex.id, 'session-1', 'a question\r')
    conversations.codex = [{ id: 'thread-1', title: 'One', createdAt: clock }]
    manager.sessionEnded(ended(codex.id, 'codex'))
    await manager.flush()
    expect(await manager.prepareSession(codex.id)).toMatchObject({
      launch: { conversationId: 'thread-1', resume: true },
    })

    const claude = await manager.create('claude')
    expect(await manager.prepareSession(claude.id)).toMatchObject({
      launch: { conversationId: null, resume: false },
    })
  })

  it('goes on in the conversation Claude Code went to at /clear once a message is sent there, adding no chat', async () => {
    const chat = await manager.create('claude')
    const first = 'first-conversation'
    manager.setTitle(chat.id, '✳ Fix the login')
    manager.noteHookEvent(chat.id, hook('UserPromptSubmit', first))
    await manager.flush()
    expect(manager.get(chat.id)?.hasMessages).toBe(true)

    manager.typed(chat.id, 'session-1', '/clear\r')
    manager.noteHookEvent(chat.id, hook('SessionStart', 'new-conversation', 'clear', 2_000))
    await manager.flush()
    expect(manager.list()).toEqual([
      expect.objectContaining({
        id: chat.id,
        conversationId: first,
        hasMessages: true,
        title: '✳ Fix the login',
      }),
    ])

    manager.noteHookEvent(chat.id, hook('UserPromptSubmit', 'new-conversation', null, 3_000))
    await manager.flush()
    expect(manager.list()).toEqual([
      expect.objectContaining({
        id: chat.id,
        conversationId: 'new-conversation',
        hasMessages: true,
        title: '',
        customName: null,
      }),
    ])
  })

  it('names a chat after the title Claude Code gives the conversation it went on to', async () => {
    const chat = await manager.create('claude')
    manager.setTitle(chat.id, '✳ Old conversation')
    manager.noteHookEvent(chat.id, hook('UserPromptSubmit', 'first-conversation'))
    await manager.flush()

    // The title of the next conversation comes in before the hook that tells
    // of its message, and the terminal's answers to its queries are part of
    // the input too.
    manager.typed(chat.id, 'session-1', '\x1b[?1;2c\x1b[<35;56;20M/clear\r')
    manager.noteHookEvent(chat.id, hook('SessionStart', 'new-conversation', 'clear', 2_000))
    manager.setTitle(chat.id, '✳ New conversation')
    manager.noteHookEvent(chat.id, hook('UserPromptSubmit', 'new-conversation', null, 3_000))
    await manager.flush()
    expect(manager.get(chat.id)?.title).toBe('✳ New conversation')

    // A title that only shows Claude Code at work on the conversation it left
    // is not the next one's.
    manager.typed(chat.id, 'session-1', '/clear\r')
    manager.setTitle(chat.id, '◐ New conversation')
    manager.noteHookEvent(chat.id, hook('UserPromptSubmit', 'third-conversation', null, 4_000))
    await manager.flush()
    expect(manager.get(chat.id)).toMatchObject({ conversationId: 'third-conversation', title: '' })
  })

  it('keeps the name the user gave a chat that goes on to another conversation', async () => {
    const chat = await manager.create('claude')
    manager.rename(chat.id, 'My task')
    manager.noteHookEvent(chat.id, hook('UserPromptSubmit', 'first-conversation'))
    manager.typed(chat.id, 'session-1', '/clear\r')
    manager.noteHookEvent(chat.id, hook('UserPromptSubmit', 'next', null, 2_000))
    await manager.flush()
    expect(manager.get(chat.id)).toMatchObject({ conversationId: 'next', customName: 'My task' })
  })

  it('keeps a Claude Code chat in its conversation when the next one gets no message', async () => {
    const chat = await manager.create('claude')
    const first = 'first-conversation'
    manager.setTitle(chat.id, '✳ Old conversation')
    manager.noteHookEvent(chat.id, hook('UserPromptSubmit', first))
    await manager.flush()
    manager.typed(chat.id, 'session-1', '/clear\r')
    manager.noteHookEvent(chat.id, hook('SessionStart', 'new-conversation', 'clear', 2_000))
    await manager.flush()

    conversations.claude = true
    manager.sessionEnded(ended(chat.id, 'claude'))
    await manager.flush()
    expect(manager.list()).toEqual([
      expect.objectContaining({
        id: chat.id,
        conversationId: first,
        title: '✳ Old conversation',
        hasMessages: true,
      }),
    ])
    expect((await manager.prepareSession(chat.id))?.launch).toEqual({
      conversationId: first,
      resume: true,
    })
  })

  it('goes on in the conversation Claude Code resumes or branches to, another chat’s too', async () => {
    const one = await manager.create('claude')
    const two = await manager.create('claude')
    const theirs = 'their-conversation'
    manager.noteHookEvent(one.id, hook('UserPromptSubmit', 'own-conversation'))
    manager.noteHookEvent(two.id, hook('UserPromptSubmit', theirs))
    await manager.flush()

    manager.typed(one.id, 'session-1', '/resume\r')
    manager.noteHookEvent(one.id, hook('SessionStart', theirs, 'resume', 2_000))
    manager.noteHookEvent(one.id, hook('UserPromptSubmit', theirs, null, 3_000))
    await manager.flush()
    expect(manager.list().map((chat) => [chat.id, chat.conversationId])).toEqual([
      [two.id, theirs],
      [one.id, theirs],
    ])

    manager.noteHookEvent(one.id, hook('SessionStart', 'branch', 'fork', 4_000))
    manager.noteHookEvent(one.id, hook('UserPromptSubmit', 'branch', null, 5_000))
    await manager.flush()
    expect(manager.get(one.id)?.conversationId).toBe('branch')
    expect(manager.get(two.id)?.conversationId).toBe(theirs)
  })

  it('leaves a chat in the conversation it went on to when a message of the one it left is told late', async () => {
    const chat = await manager.create('claude')
    const first = 'first-conversation'
    manager.noteHookEvent(chat.id, hook('UserPromptSubmit', first, null, 1_000))
    manager.noteHookEvent(chat.id, hook('UserPromptSubmit', 'next', null, 3_000))
    manager.noteHookEvent(chat.id, hook('UserPromptSubmit', first, null, 2_000))
    await manager.flush()
    expect(manager.get(chat.id)?.conversationId).toBe('next')
  })

  it('does not change the conversation of a Claude Code chat that compacts it', async () => {
    const chat = await manager.create('claude')
    manager.noteHookEvent(chat.id, hook('UserPromptSubmit', 'first-conversation'))
    await manager.flush()
    manager.typed(chat.id, 'session-1', '/compact\r')
    manager.noteHookEvent(chat.id, hook('SessionStart', 'first-conversation', 'compact', 2_000))
    manager.noteHookEvent(chat.id, hook('UserPromptSubmit', 'first-conversation', null, 3_000))
    await manager.flush()
    expect(manager.list()).toEqual([
      expect.objectContaining({ conversationId: 'first-conversation', hasMessages: true }),
    ])
  })

  it('removes a Claude Code chat whose agent told of no conversation with a message, as with its hooks off', async () => {
    const chat = await manager.create('claude')
    await manager.prepareSession(chat.id)
    manager.opened(chat.id)
    manager.typed(chat.id, 'session-1', 'one\r')
    // Claude Code tells of the conversation it starts before any message.
    manager.noteHookEvent(chat.id, hook('SessionStart', 'unsent', 'startup'))
    conversations.claude = true
    manager.sessionEnded(ended(chat.id, 'claude'))
    await manager.flush()
    expect(manager.list()).toEqual([])

    // So does one left without a conversation when Hoot starts again.
    const left = await manager.create('claude')
    const again = await restarted()
    expect(again.get(left.id)).toBeUndefined()
  })

  it('keeps a Claude Code chat in its conversation while its agent tells of none', async () => {
    const chat = await manager.create('claude')
    manager.noteHookEvent(chat.id, hook('UserPromptSubmit', 'conversation-1'))
    await manager.flush()
    await manager.prepareSession(chat.id)
    manager.opened(chat.id)
    manager.typed(chat.id, 'session-2', '/clear\r')
    manager.typed(chat.id, 'session-2', 'two\r')
    manager.sessionEnded(ended(chat.id, 'claude'))
    await manager.flush()
    expect((await manager.prepareSession(chat.id))?.launch).toEqual({
      conversationId: 'conversation-1',
      resume: true,
    })
  })

  it('opens a Claude Code chat made by an earlier version of Hoot on its own conversation', async () => {
    const store = new ChatStore(db)
    const at = ++clock
    const chat = {
      id: 'earlier-chat',
      toolId: 'claude' as const,
      folder: path.join(chatsRoot(), 'claude-code'),
      projectRoot: null,
      worktreePath: null,
      conversationId: '0f6e2c1a-8a51-4a39-9d61-7c2f3b1e4d5a',
      title: '✳ Earlier work',
      customName: null,
      hasMessages: true,
      createdAt: at,
      lastOpenedAt: at,
    }
    store.insert(chat)
    // One whose conversation Hoot had not yet seen a message of, which the
    // agent recorded one in.
    store.insert({
      ...chat,
      id: 'unseen',
      conversationId: 'unseen-conversation',
      hasMessages: false,
    })
    conversations.claude = true

    const again = new ChatManager({ db, conversations, home: path.join(root, 'home') })
    expect((await again.prepareSession(chat.id))?.launch).toEqual({
      conversationId: chat.conversationId,
      resume: true,
    })
    await again.reconcileAll()
    expect(again.get('unseen')).toMatchObject({ hasMessages: true })

    // And one whose conversation never got one, which starts anew.
    store.insert({
      ...chat,
      id: 'unused',
      conversationId: 'unused-conversation',
      hasMessages: false,
    })
    conversations.claude = false
    expect((await again.prepareSession('unused'))?.launch).toMatchObject({ resume: false })
    again.opened('unused')
    again.sessionEnded(ended('unused', 'claude'))
    await again.flush()
    expect(again.get('unused')).toBeUndefined()
    expect(again.get(chat.id)).toMatchObject({ conversationId: chat.conversationId })
  })

  it('goes on in the newest Codex conversation when the process ends, listing no other', async () => {
    const chat = await manager.create('codex')
    manager.typed(chat.id, 'session-1', 'first question\r')
    manager.typed(chat.id, 'session-1', '/new\r')
    manager.typed(chat.id, 'session-1', 'second question\r')
    conversations.codex = [
      { id: 'thread-old', title: 'Old work', createdAt: 1 },
      { id: 'thread-new', title: 'New work', createdAt: 2 },
    ]
    manager.sessionEnded(ended(chat.id, 'codex'))
    await manager.flush()

    expect(manager.list()).toEqual([
      expect.objectContaining({ id: chat.id, conversationId: 'thread-new', hasMessages: true }),
    ])
  })

  it('keeps an OpenCode chat in its conversation after /new until a message is sent in the next one', async () => {
    const chat = await manager.create('opencode')
    const old = chat.conversationId!
    await manager.prepareSession(chat.id)
    manager.opened(chat.id)
    manager.typed(chat.id, 'session-1', 'first question\r')
    manager.typed(chat.id, 'session-1', '/new\r')
    await manager.flush()
    expect(manager.list()).toEqual([
      expect.objectContaining({ id: chat.id, conversationId: old, hasMessages: true }),
    ])
    conversations.opencode = [{ id: old, title: 'First', createdAt: clock }]
    manager.sessionEnded(ended(chat.id, 'opencode'))
    await manager.flush()
    expect(manager.list()).toEqual([
      expect.objectContaining({ id: chat.id, conversationId: old, hasMessages: true }),
    ])

    // Opened again, it goes on to the conversation `/new` started there once
    // that got a message, named by the title OpenCode recorded for it.
    await manager.prepareSession(chat.id)
    manager.opened(chat.id)
    manager.setTitle(chat.id, 'First')
    manager.typed(chat.id, 'session-2', '/new\r')
    manager.typed(chat.id, 'session-2', 'second question\r')
    conversations.opencode = [
      { id: old, title: 'First', createdAt: 1 },
      { id: 'ses_second', title: 'Second', createdAt: clock + 1 },
    ]
    manager.sessionEnded(ended(chat.id, 'opencode'))
    await manager.flush()
    expect(manager.list()).toEqual([
      expect.objectContaining({ id: chat.id, conversationId: 'ses_second', title: 'Second' }),
    ])
  })

  it('leaves a chat in its conversation when its run sent no message', async () => {
    const chat = await manager.create('codex')
    manager.typed(chat.id, 'session-1', 'a question\r')
    conversations.codex = [{ id: 'thread-1', title: 'One', createdAt: 1 }]
    manager.sessionEnded(ended(chat.id, 'codex'))
    await manager.flush()

    await manager.prepareSession(chat.id)
    manager.opened(chat.id)
    manager.typed(chat.id, 'session-2', '/new\r')
    conversations.codex = [
      { id: 'thread-1', title: 'One', createdAt: 1 },
      { id: 'thread-2', title: 'Two', createdAt: clock + 1 },
    ]
    manager.sessionEnded(ended(chat.id, 'codex'))
    await manager.flush()
    expect(manager.list()).toEqual([
      expect.objectContaining({ id: chat.id, conversationId: 'thread-1' }),
    ])
  })

  it('takes Enter after a key that recalls a message from the agent’s history for a message where it starts a conversation', async () => {
    // A new chat whose only message the user recalled, with Up.
    const chat = await manager.create('codex')
    await manager.prepareSession(chat.id)
    manager.opened(chat.id)
    manager.typed(chat.id, 'session-1', '\x1b[A')
    manager.typed(chat.id, 'session-1', '\r')
    conversations.codex = [{ id: 'thread-1', title: 'One', createdAt: clock }]
    manager.sessionEnded(ended(chat.id, 'codex'))
    await manager.flush()
    expect(manager.list()).toEqual([
      expect.objectContaining({ id: chat.id, conversationId: 'thread-1', hasMessages: true }),
    ])

    // A recalled message after /new, with Up as in application cursor key mode.
    await manager.prepareSession(chat.id)
    manager.opened(chat.id)
    manager.typed(chat.id, 'session-2', '/new\r')
    manager.typed(chat.id, 'session-2', '\x1bOA\r')
    conversations.codex = [
      { id: 'thread-1', title: 'One', createdAt: 1 },
      { id: 'thread-2', title: 'Two', createdAt: clock + 1 },
    ]
    manager.sessionEnded(ended(chat.id, 'codex'))
    await manager.flush()
    expect(manager.list()).toEqual([
      expect.objectContaining({ id: chat.id, conversationId: 'thread-2' }),
    ])

    // Codex also recalls one with Ctrl+P: in a new chat, and after /clear or /fork.
    const recalledOnly = await manager.create('codex')
    await manager.prepareSession(recalledOnly.id)
    manager.opened(recalledOnly.id)
    manager.typed(recalledOnly.id, 'session-3', '\x10\r')
    conversations.codex = [{ id: 'thread-3', title: 'Three', createdAt: clock }]
    manager.sessionEnded(ended(recalledOnly.id, 'codex'))
    await manager.flush()
    expect(manager.get(recalledOnly.id)).toMatchObject({ conversationId: 'thread-3' })
    let previous = 'thread-3'
    for (const [command, next] of [
      ['/clear', 'thread-4'],
      ['/fork', 'thread-5'],
    ] as const) {
      await manager.prepareSession(recalledOnly.id)
      manager.opened(recalledOnly.id)
      manager.typed(recalledOnly.id, `session-${next}`, `${command}\r`)
      manager.typed(recalledOnly.id, `session-${next}`, '\x10\r')
      conversations.codex = [
        { id: previous, title: previous, createdAt: 1 },
        { id: next, title: next, createdAt: clock + 1 },
      ]
      manager.sessionEnded(ended(recalledOnly.id, 'codex'))
      await manager.flush()
      expect(manager.get(recalledOnly.id)).toMatchObject({ conversationId: next })
      previous = next
    }

    // OpenCode, whose history Up alone recalls, after /new.
    const openCode = await manager.create('opencode')
    await manager.prepareSession(openCode.id)
    manager.opened(openCode.id)
    manager.typed(openCode.id, 'session-6', 'a question\r')
    conversations.opencode = [{ id: openCode.conversationId!, title: 'One', createdAt: clock }]
    manager.sessionEnded(ended(openCode.id, 'opencode'))
    await manager.flush()
    await manager.prepareSession(openCode.id)
    manager.opened(openCode.id)
    manager.typed(openCode.id, 'session-7', '/new\r\x1b[A\r')
    conversations.opencode = [
      { id: openCode.conversationId!, title: 'One', createdAt: 1 },
      { id: 'ses_two', title: 'Two', createdAt: clock + 1 },
    ]
    manager.sessionEnded(ended(openCode.id, 'opencode'))
    await manager.flush()
    expect(manager.get(openCode.id)).toMatchObject({ conversationId: 'ses_two' })
  })

  it('takes Enter after a key that recalls a message for none where a message would not start a conversation, as on an item of a list', async () => {
    // A new chat whose review of Codex's hooks was answered with Up, which
    // picks its last item, and which sent no message: it goes.
    const unused = await manager.create('codex')
    await manager.prepareSession(unused.id)
    manager.opened(unused.id)
    manager.typed(unused.id, 'session-1', '\x1b[A')
    manager.typed(unused.id, 'session-1', '\r')
    manager.sessionEnded(ended(unused.id, 'codex'))
    await manager.flush()
    expect(manager.get(unused.id)).toBeUndefined()

    // A chat with a conversation whose review was answered with Up, which
    // then left its conversation with /new and sent no message, while a
    // conversation started out of Hoot in its folder.
    const chat = await manager.create('codex')
    manager.typed(chat.id, 'session-2', 'a question\r')
    conversations.codex = [{ id: 'thread-1', title: 'One', createdAt: 1 }]
    manager.sessionEnded(ended(chat.id, 'codex'))
    await manager.flush()
    await manager.prepareSession(chat.id)
    manager.opened(chat.id)
    manager.typed(chat.id, 'session-3', '\x1b[A\r')
    manager.typed(chat.id, 'session-3', '/new\r')
    manager.typed(chat.id, 'session-3', '\r')
    conversations.codex = [
      { id: 'thread-1', title: 'One', createdAt: 1 },
      { id: 'outside', title: 'Outside', createdAt: clock + 1 },
    ]
    manager.sessionEnded(ended(chat.id, 'codex'))
    await manager.flush()
    expect(manager.get(chat.id)).toMatchObject({ conversationId: 'thread-1' })

    // A chat whose conversation Codex reported, which picked an item of a
    // list with Up or Ctrl+P and sent no message.
    const reported = await manager.create('codex')
    await manager.prepareSession(reported.id)
    manager.opened(reported.id)
    manager.typed(reported.id, 'session-4', 'one\r')
    manager.noteHookEvent(reported.id, hook('UserPromptSubmit', 'thread-one', null, ++clock))
    manager.sessionEnded(ended(reported.id, 'codex'))
    await manager.flush()
    await manager.prepareSession(reported.id)
    manager.opened(reported.id)
    manager.typed(reported.id, 'session-5', '/theme\r\x1b[A\r')
    manager.typed(reported.id, 'session-5', '/model\r\x10\r')
    conversations.codex = [
      { id: 'thread-one', title: 'One', createdAt: 1 },
      { id: 'outside', title: 'Outside', createdAt: clock + 1 },
    ]
    manager.sessionEnded(ended(reported.id, 'codex'))
    await manager.flush()
    expect(manager.get(reported.id)).toMatchObject({ conversationId: 'thread-one' })

    // Ctrl+P recalls nothing in OpenCode, where it moves the selection of a dialog.
    const openCode = await manager.create('opencode')
    await manager.prepareSession(openCode.id)
    manager.opened(openCode.id)
    manager.typed(openCode.id, 'session-6', 'a question\r')
    conversations.opencode = [{ id: openCode.conversationId!, title: 'One', createdAt: clock }]
    manager.sessionEnded(ended(openCode.id, 'opencode'))
    await manager.flush()
    await manager.prepareSession(openCode.id)
    manager.opened(openCode.id)
    manager.typed(openCode.id, 'session-7', '/new\r\x10\r')
    conversations.opencode = [
      { id: openCode.conversationId!, title: 'One', createdAt: 1 },
      { id: 'ses_two', title: 'Two', createdAt: clock + 1 },
    ]
    manager.sessionEnded(ended(openCode.id, 'opencode'))
    await manager.flush()
    expect(manager.get(openCode.id)).toMatchObject({ conversationId: openCode.conversationId })
  })

  it('takes neither Enter alone, as on an answer picked with Down, nor a command after Up for a message', async () => {
    const chat = await manager.create('codex')
    manager.typed(chat.id, 'session-1', 'a question\r')
    conversations.codex = [{ id: 'thread-1', title: 'One', createdAt: 1 }]
    manager.sessionEnded(ended(chat.id, 'codex'))
    await manager.flush()

    await manager.prepareSession(chat.id)
    manager.opened(chat.id)
    manager.typed(chat.id, 'session-2', '\x1b[B')
    manager.typed(chat.id, 'session-2', '\x1b[B\r')
    manager.typed(chat.id, 'session-2', '\x1b[A/new\r\r')
    manager.typed(chat.id, 'session-2', '\r')
    conversations.codex = [
      { id: 'thread-1', title: 'One', createdAt: 1 },
      { id: 'thread-2', title: 'Two', createdAt: clock + 1 },
    ]
    manager.sessionEnded(ended(chat.id, 'codex'))
    await manager.flush()
    expect(manager.list()).toEqual([
      expect.objectContaining({ id: chat.id, conversationId: 'thread-1' }),
    ])
  })

  it('leaves out of what is typed the digits typed first in a Codex session, which may answer its review of hooks', async () => {
    // A new chat whose review was answered with 3, then Enter alone: it goes.
    const unused = await manager.create('codex')
    await manager.prepareSession(unused.id)
    manager.opened(unused.id)
    manager.typed(unused.id, 'session-1', '\x1b[I3')
    manager.typed(unused.id, 'session-1', '\r')
    manager.sessionEnded(ended(unused.id, 'codex'))
    await manager.flush()
    expect(manager.get(unused.id)).toBeUndefined()

    // A new chat whose first message is digits alone, as without a review to
    // answer, or after 3 answered it: the agent's records tell it was one.
    for (const [index, typed] of ['42\r', '342\r'].entries()) {
      const digits = await manager.create('codex')
      await manager.prepareSession(digits.id)
      manager.opened(digits.id)
      manager.typed(digits.id, `session-digits-${index}`, typed)
      conversations.codex = [{ id: `thread-42-${index}`, title: '42', createdAt: clock }]
      manager.sessionEnded(ended(digits.id, 'codex'))
      await manager.flush()
      expect(manager.get(digits.id)).toMatchObject({
        conversationId: `thread-42-${index}`,
        hasMessages: true,
      })
    }
    conversations.codex = []

    // A chat with a conversation whose review was answered with 3, which then
    // left its conversation with /new and sent no message, while a
    // conversation started out of Hoot in its folder.
    const chat = await manager.create('codex')
    manager.typed(chat.id, 'session-2', 'a question\r')
    conversations.codex = [{ id: 'thread-1', title: 'One', createdAt: 1 }]
    manager.sessionEnded(ended(chat.id, 'codex'))
    await manager.flush()
    await manager.prepareSession(chat.id)
    manager.opened(chat.id)
    manager.setTitle(chat.id, 'One')
    manager.typed(chat.id, 'session-3', '3')
    manager.typed(chat.id, 'session-3', '/new\r')
    conversations.codex = [
      { id: 'thread-1', title: 'One', createdAt: 1 },
      { id: 'outside', title: 'Outside', createdAt: clock + 1 },
    ]
    manager.sessionEnded(ended(chat.id, 'codex'))
    await manager.flush()
    expect(manager.get(chat.id)).toMatchObject({ conversationId: 'thread-1' })

    // Opened again, its /new after 3 is a command: the chat goes on in the
    // next conversation once a message is sent there, recalled here, with the
    // title Codex set for that one.
    await manager.prepareSession(chat.id)
    manager.opened(chat.id)
    manager.typed(chat.id, 'session-4', '3/new\r')
    manager.setTitle(chat.id, 'Topic two')
    manager.typed(chat.id, 'session-4', '\x1b[A\r')
    conversations.codex = [
      { id: 'thread-1', title: 'One', createdAt: 1 },
      { id: 'thread-2', title: 'Two', createdAt: clock + 1 },
    ]
    manager.sessionEnded(ended(chat.id, 'codex'))
    await manager.flush()
    expect(manager.get(chat.id)).toMatchObject({ conversationId: 'thread-2', title: 'Topic two' })

    // Digits typed later are typed, as are those of a message after other keys.
    const counted = await manager.create('codex')
    await manager.prepareSession(counted.id)
    manager.opened(counted.id)
    manager.typed(counted.id, 'session-5', '\r3\r')
    manager.sessionEnded(ended(counted.id, 'codex'))
    await manager.flush()
    expect(manager.get(counted.id)).toMatchObject({ hasMessages: true })

    // OpenCode shows no such review: a digit typed first is typed.
    const openCode = await manager.create('opencode')
    await manager.prepareSession(openCode.id)
    manager.opened(openCode.id)
    manager.typed(openCode.id, 'session-6', '3\r')
    await manager.flush()
    expect(manager.get(openCode.id)).toMatchObject({ hasMessages: true })
  })

  it('goes on to no conversation that started before its agent did', async () => {
    const folder = worktreeFolder('fix-login-bug')
    const saved = manager.createSavedSession('/work/project', folder, 'codex')
    await manager.prepareSession(saved.id)
    manager.opened(saved.id)
    manager.typed(saved.id, 'session-1', 'a question\r')
    conversations.codex = [{ id: 'thread-1', title: 'One', createdAt: clock }]
    manager.sessionEnded(endedSaved(saved.id, folder, 'codex'))
    await manager.flush()

    // Another conversation in the worktree, out of Hoot, before it is opened again.
    conversations.codex = [
      { id: 'thread-1', title: 'One', createdAt: clock - 1 },
      { id: 'outside', title: 'Outside', createdAt: ++clock },
    ]
    await manager.prepareSession(saved.id)
    manager.opened(saved.id)
    manager.typed(saved.id, 'session-2', 'another question\r')
    manager.sessionEnded(endedSaved(saved.id, folder, 'codex'))
    await manager.flush()
    expect(manager.listSavedSessions()).toEqual([
      expect.objectContaining({ id: saved.id, conversationId: 'thread-1' }),
    ])
  })

  it('removes a chat whose agent only ran slash commands, without a message', async () => {
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

  it('lets only the session opened last go on to a conversation no session has', async () => {
    const folder = worktreeFolder('fix-login-bug')
    const { first, second, firstConversation, secondConversation, record } = await twoSavedSessions(
      'opencode',
      folder,
    )
    record([
      { id: firstConversation, title: 'First', createdAt: 1 },
      { id: secondConversation, title: 'Second', createdAt: 2 },
      { id: 'ses_third', title: 'Third', createdAt: 3 },
    ])
    await manager.reconcileAll()

    expect(manager.listSavedSessions().map((entry) => [entry.id, entry.conversationId])).toEqual([
      [first.id, firstConversation],
      [second.id, 'ses_third'],
    ])
  })

  it('reads what happened while Hoot was not running when it starts', async () => {
    const chat = await manager.create('opencode')
    const first = chat.conversationId!
    conversations.opencode = [
      { id: first, title: 'First', createdAt: 1 },
      { id: 'ses_second', title: 'Second', createdAt: 2 },
    ]

    await manager.reconcileAll()
    expect(manager.list()).toEqual([
      expect.objectContaining({ id: chat.id, conversationId: 'ses_second', hasMessages: true }),
    ])

    // Reading again changes nothing.
    await manager.reconcileAll()
    expect(manager.list()).toEqual([
      expect.objectContaining({ id: chat.id, conversationId: 'ses_second' }),
    ])
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
    expect(saved.conversationId).toBeNull()
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
    manager.noteHookEvent(saved.id, hook('UserPromptSubmit', 'conversation-1'))
    await manager.flush()

    expect(manager.get(saved.id)).toMatchObject({
      conversationId: 'conversation-1',
      hasMessages: true,
    })
    const prepared = await manager.prepareSession(saved.id)
    expect(prepared).toEqual({
      folder: worktree,
      launch: { conversationId: 'conversation-1', resume: true },
    })
  })

  it('makes a saved session with a name, and sends its first message only until its agent has started', async () => {
    const project = path.join(root, 'project')
    fs.mkdirSync(project)
    const saved = manager.createSavedSession(project, null, 'codex', {
      name: 'Merge feature-x',
      firstMessage: 'Merge it.',
    })
    expect(saved).toMatchObject({ customName: 'Merge feature-x', worktreePath: null })
    expect(manager.listSavedSessions()).toMatchObject([
      { id: saved.id, customName: 'Merge feature-x' },
    ])
    // A start that did not go ahead sends it the next time.
    expect(await manager.prepareSession(saved.id)).toEqual({
      folder: project,
      launch: { conversationId: null, resume: false, firstMessage: 'Merge it.' },
    })
    expect(await manager.prepareSession(saved.id)).toMatchObject({
      launch: { firstMessage: 'Merge it.' },
    })
    manager.opened(saved.id)
    expect(await manager.prepareSession(saved.id)).toEqual({
      folder: project,
      launch: { conversationId: null, resume: false },
    })
    // It can be renamed as any other.
    manager.rename(saved.id, 'Mine')
    expect(manager.get(saved.id)).toMatchObject({ customName: 'Mine' })

    // Nor is a first message sent to a conversation that is continued, nor kept for one deleted.
    const other = manager.createSavedSession(project, null, 'claude', { firstMessage: 'Hi.' })
    manager.noteHookEvent(other.id, hook('UserPromptSubmit', 'conversation-1'))
    await manager.flush()
    expect((await manager.prepareSession(other.id))?.launch).toEqual({
      conversationId: 'conversation-1',
      resume: true,
    })
    const gone = manager.createSavedSession(project, null, 'opencode', { firstMessage: 'Hi.' })
    await manager.delete(gone.id)
    expect(await manager.prepareSession(gone.id)).toBeNull()
  })

  it('goes on in a saved session’s next conversation, adding no session below its worktree', async () => {
    const worktree = path.join(root, 'worktrees', 'fix-login-bug')
    fs.mkdirSync(worktree, { recursive: true })
    const saved = manager.createSavedSession('/work/project', worktree, 'codex')
    conversations.codex = [
      { id: 'first', title: 'First', createdAt: 1 },
      { id: 'second', title: 'Second', createdAt: 2 },
    ]
    manager.typed(saved.id, 'session-1', 'first question\r')
    manager.typed(saved.id, 'session-1', '/new\r')
    manager.typed(saved.id, 'session-1', 'second question\r')
    manager.sessionEnded(endedSaved(saved.id, worktree, 'codex'))
    await manager.flush()

    expect(manager.listSavedSessions()).toEqual([
      expect.objectContaining({ id: saved.id, conversationId: 'second' }),
    ])
  })

  it('deletes a Claude Code chat for good, leaving the shared folder and what is in it', async () => {
    const chat = await manager.create('claude')
    const other = await manager.create('claude')
    fs.writeFileSync(path.join(chat.folder, 'notes.txt'), 'keep')
    manager.noteHookEvent(chat.id, hook('UserPromptSubmit', 'conversation-1'))
    manager.noteHookEvent(other.id, hook('UserPromptSubmit', 'conversation-2'))
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
    manager.typed(first.id, 'session-first', 'first question\r')
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

  it('moves the folder of a deleted chat to the Trash with what is in it, once no other chat runs in it', async () => {
    const chat = await manager.create('opencode')
    const old = chat.conversationId!
    manager.typed(chat.id, 'session-1', 'first question\r')
    conversations.opencode = [{ id: old, title: 'First', createdAt: 1 }]
    manager.sessionEnded(ended(chat.id, 'opencode'))
    await manager.flush()
    // A chat an earlier version of Hoot split off from it, in the same folder.
    const split = splitOff(chat.id, 'ses_earlier')
    fs.writeFileSync(path.join(chat.folder, 'notes.txt'), 'keep')

    await manager.delete(split)
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
    manager.noteHookEvent(local.id, hook('UserPromptSubmit', 'conversation-1'))
    conversations.claude = true
    manager.sessionEnded(endedLocal(local.id, folder, 'claude'))
    await manager.flush()

    const again = await restarted()
    expect(again.listSavedSessions()).toEqual([
      expect.objectContaining({ id: local.id, worktreePath: null, hasMessages: true }),
    ])
    expect(await again.prepareSession(local.id)).toEqual({
      folder,
      launch: { conversationId: 'conversation-1', resume: true },
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

    it(`goes on in what a ${toolId} session of the project folder went on to at /new, and nothing older`, async () => {
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

      expect(manager.listSavedSessions()).toEqual([
        expect.objectContaining({ id: local.id, conversationId: 'thread-2', worktreePath: null }),
      ])
      const again = await restarted()
      expect(again.listSavedSessions().map((entry) => entry.conversationId)).toEqual(['thread-2'])
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
        [later.id, later.conversationId],
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

    it(`keeps a ${toolId} session of the project folder on its conversation after /new without a message while another runs`, async () => {
      const folder = projectFolder()
      const { earlier, own, later } = await sideBySide(folder)
      manager.typed(earlier.id, 'session-earlier-2', '/new\r')
      await manager.flush()

      manager.sessionEnded(endedLocal(earlier.id, folder, toolId))
      manager.sessionEnded(endedLocal(later.id, folder, toolId))
      await manager.flush()
      expect(manager.listSavedSessions().map((entry) => [entry.id, entry.conversationId])).toEqual([
        [earlier.id, own],
        [later.id, 'thread-later'],
      ])
    })
  }

  /** Starts a session's agent as Hoot does. */
  const start = async (id: string) => {
    await manager.prepareSession(id)
    manager.opened(id)
  }

  for (const order of ['first', 'second'] as const) {
    it(`keeps Codex sessions side by side in a worktree on the conversations Codex reported, closing the ${order} first`, async () => {
      const folder = worktreeFolder('fix-login-bug')
      const one = manager.createSavedSession('/work/project', folder, 'codex')
      const two = manager.createSavedSession('/work/project', folder, 'codex')
      await start(one.id)
      await start(two.id)
      manager.typed(one.id, 'session-one', 'one\r')
      manager.noteHookEvent(one.id, hook('UserPromptSubmit', 'thread-one', null, ++clock))
      manager.typed(two.id, 'session-two', 'two\r')
      manager.noteHookEvent(two.id, hook('UserPromptSubmit', 'thread-two', null, ++clock))
      // And one out of Hoot, after both.
      conversations.codex = [
        { id: 'thread-one', title: 'One', createdAt: clock - 1 },
        { id: 'thread-two', title: 'Two', createdAt: clock },
        { id: 'outside', title: 'Outside', createdAt: ++clock },
      ]

      for (const saved of order === 'first' ? [one, two] : [two, one]) {
        manager.sessionEnded(endedSaved(saved.id, folder, 'codex'))
        await manager.flush()
      }
      const expected = [
        [one.id, 'thread-one'],
        [two.id, 'thread-two'],
      ]
      expect(manager.listSavedSessions().map((entry) => [entry.id, entry.conversationId])).toEqual(
        expected,
      )
      const again = await restarted()
      expect(again.listSavedSessions().map((entry) => [entry.id, entry.conversationId])).toEqual(
        expected,
      )
    })
  }

  it('keeps a Codex session on the conversation Codex reported when another of its worktree is deleted', async () => {
    const folder = worktreeFolder('fix-login-bug')
    const one = manager.createSavedSession('/work/project', folder, 'codex')
    const two = manager.createSavedSession('/work/project', folder, 'codex')
    await start(one.id)
    await start(two.id)
    manager.typed(one.id, 'session-one', 'one\r')
    manager.noteHookEvent(one.id, hook('UserPromptSubmit', 'thread-one', null, ++clock))
    manager.typed(two.id, 'session-two', 'two\r')
    manager.noteHookEvent(two.id, hook('UserPromptSubmit', 'thread-two', null, ++clock))
    await manager.flush()
    conversations.codex = [
      { id: 'thread-one', title: 'One', createdAt: clock - 1 },
      { id: 'thread-two', title: 'Two', createdAt: clock },
    ]

    manager.sessionEnded(endedSaved(one.id, folder, 'codex'))
    await manager.delete(one.id)
    manager.sessionEnded(endedSaved(two.id, folder, 'codex'))
    await manager.flush()

    expect(manager.listSavedSessions().map((entry) => [entry.id, entry.conversationId])).toEqual([
      [two.id, 'thread-two'],
    ])
    const again = await restarted()
    expect(again.listSavedSessions().map((entry) => [entry.id, entry.conversationId])).toEqual([
      [two.id, 'thread-two'],
    ])
  })

  it('keeps a Codex session of the project folder on the conversation Codex reported, whatever starts out of Hoot', async () => {
    const folder = projectFolder()
    const local = manager.createSavedSession(folder, null, 'codex')
    await start(local.id)
    manager.typed(local.id, 'session-local', 'one\r')
    manager.noteHookEvent(local.id, hook('UserPromptSubmit', 'thread-one', null, ++clock))
    conversations.codex = [
      { id: 'thread-one', title: 'One', createdAt: clock },
      { id: 'outside', title: 'Outside', createdAt: ++clock },
    ]
    manager.sessionEnded(endedLocal(local.id, folder, 'codex'))
    await manager.flush()
    manager.opened(local.id)
    const again = await restarted()
    expect(again.listSavedSessions().map((entry) => [entry.id, entry.conversationId])).toEqual([
      [local.id, 'thread-one'],
    ])

    // Opened again, it reads nothing of its folder while it sends no message.
    await again.prepareSession(local.id)
    again.opened(local.id)
    conversations.codex.push({ id: 'outside-later', title: 'Outside', createdAt: ++clock })
    again.sessionEnded(endedLocal(local.id, folder, 'codex'))
    await again.flush()
    expect(again.get(local.id)?.conversationId).toBe('thread-one')
  })

  it('goes on in the conversation Codex reports a message in after /new, /resume or /fork', async () => {
    const chat = await manager.create('codex')
    const other = await manager.create('codex')
    await start(chat.id)
    manager.noteHookEvent(chat.id, hook('UserPromptSubmit', 'thread-one', null, ++clock))
    manager.noteHookEvent(other.id, hook('UserPromptSubmit', 'thread-theirs', null, ++clock))
    await manager.flush()

    manager.typed(chat.id, 'session-1', '/new\r')
    await manager.flush()
    expect(manager.get(chat.id)?.conversationId).toBe('thread-one')
    manager.noteHookEvent(chat.id, hook('UserPromptSubmit', 'thread-two', null, ++clock))
    await manager.flush()
    expect(manager.get(chat.id)?.conversationId).toBe('thread-two')

    manager.typed(chat.id, 'session-1', '/resume\r')
    manager.noteHookEvent(chat.id, hook('UserPromptSubmit', 'thread-theirs', null, ++clock))
    await manager.flush()
    expect(manager.list().map((entry) => [entry.id, entry.conversationId])).toEqual([
      [chat.id, 'thread-theirs'],
      [other.id, 'thread-theirs'],
    ])

    manager.typed(chat.id, 'session-1', '/fork\r')
    manager.noteHookEvent(chat.id, hook('UserPromptSubmit', 'thread-fork', null, ++clock))
    // Its agent ends, as it reported, whatever its folder records.
    conversations.codex = [{ id: 'thread-later', title: 'Later', createdAt: ++clock }]
    manager.sessionEnded(ended(chat.id, 'codex'))
    await manager.flush()
    expect(manager.list().map((entry) => [entry.id, entry.conversationId])).toEqual([
      [chat.id, 'thread-fork'],
      [other.id, 'thread-theirs'],
    ])
    expect((await manager.prepareSession(chat.id))?.launch).toEqual({
      conversationId: 'thread-fork',
      resume: true,
    })
  })

  it('reads the folder of a Codex session whose later run reported no conversation', async () => {
    const folder = worktreeFolder('fix-login-bug')
    const saved = manager.createSavedSession('/work/project', folder, 'codex')
    await start(saved.id)
    manager.typed(saved.id, 'session-1', 'one\r')
    manager.noteHookEvent(saved.id, hook('UserPromptSubmit', 'thread-one', null, ++clock))
    manager.sessionEnded(endedSaved(saved.id, folder, 'codex'))
    await manager.flush()

    // Its hook no longer runs, as when the user took back their trust in it.
    await start(saved.id)
    manager.typed(saved.id, 'session-2', '/new\r')
    manager.typed(saved.id, 'session-2', 'two\r')
    conversations.codex = [
      { id: 'thread-one', title: 'One', createdAt: 1 },
      { id: 'thread-two', title: 'Two', createdAt: ++clock },
    ]
    manager.sessionEnded(endedSaved(saved.id, folder, 'codex'))
    await manager.flush()
    expect(manager.listSavedSessions()).toEqual([
      expect.objectContaining({ id: saved.id, conversationId: 'thread-two', title: 'Two' }),
    ])
    const again = await restarted()
    expect(again.get(saved.id)?.conversationId).toBe('thread-two')
  })

  it('reads at its next start what a run of a Codex session Hoot did not see end did, when Codex reported nothing in it', async () => {
    const folder = worktreeFolder('fix-login-bug')
    const saved = manager.createSavedSession('/work/project', folder, 'codex')
    await start(saved.id)
    manager.typed(saved.id, 'session-1', 'one\r')
    manager.noteHookEvent(saved.id, hook('UserPromptSubmit', 'thread-one', null, ++clock))
    manager.sessionEnded(endedSaved(saved.id, folder, 'codex'))
    await manager.flush()

    // Its hook no longer runs, and Hoot quits without seeing the run end.
    await start(saved.id)
    manager.typed(saved.id, 'session-2', '/new\r')
    manager.typed(saved.id, 'session-2', 'two\r')
    conversations.codex = [
      { id: 'thread-one', title: 'One', createdAt: 1 },
      { id: 'thread-two', title: 'Two', createdAt: ++clock },
    ]
    const again = await restarted()
    expect(again.listSavedSessions()).toEqual([
      expect.objectContaining({ id: saved.id, conversationId: 'thread-two', title: 'Two' }),
    ])
  })

  it('keeps at its next start the conversation of a Codex session whose run Hoot did not see end, when Codex reported one or no message was sent', async () => {
    const folder = worktreeFolder('fix-login-bug')
    const saved = manager.createSavedSession('/work/project', folder, 'codex')
    await start(saved.id)
    manager.typed(saved.id, 'session-1', 'one\r')
    manager.noteHookEvent(saved.id, hook('UserPromptSubmit', 'thread-one', null, ++clock))
    manager.sessionEnded(endedSaved(saved.id, folder, 'codex'))
    await manager.flush()
    conversations.codex = [{ id: 'thread-one', title: 'One', createdAt: 1 }]
    const started = () => clock

    // A run that sends no message, while a conversation starts out of Hoot.
    await start(saved.id)
    conversations.codex.push({ id: 'outside-1', title: 'Outside', createdAt: ++clock })
    let again = await restarted()
    expect(again.get(saved.id)?.conversationId).toBe('thread-one')

    // A run in which Codex reports the conversation, then Hoot quits.
    await again.prepareSession(saved.id)
    again.opened(saved.id)
    again.typed(saved.id, 'session-3', 'more\r')
    again.noteHookEvent(saved.id, hook('UserPromptSubmit', 'thread-one', null, ++clock))
    await again.flush()
    conversations.codex.push({ id: 'outside-2', title: 'Outside', createdAt: ++clock })
    again = await restarted()
    expect(again.get(saved.id)?.conversationId).toBe('thread-one')

    // A run whose report never came, in the conversation it was in: read once.
    const runStart = started()
    await again.prepareSession(saved.id)
    again.opened(saved.id)
    again.typed(saved.id, 'session-4', 'again\r')
    again = await restarted()
    expect(again.get(saved.id)?.conversationId).toBe('thread-one')
    conversations.codex.push({ id: 'outside-3', title: 'Outside', createdAt: runStart + 100 })
    again = await restarted()
    expect(again.get(saved.id)?.conversationId).toBe('thread-one')

    // One whose report never came that Hoot saw end: read when it ended only.
    clock += 1_000
    const lastStart = started()
    await again.prepareSession(saved.id)
    again.opened(saved.id)
    again.typed(saved.id, 'session-5', 'last\r')
    again.sessionEnded(endedSaved(saved.id, folder, 'codex'))
    await again.flush()
    conversations.codex.push({ id: 'outside-4', title: 'Outside', createdAt: lastStart + 100 })
    again = await restarted()
    expect(again.get(saved.id)?.conversationId).toBe('thread-one')
  })

  it('lists none of the earlier conversations of a worktree as a session of its own', async () => {
    const folder = worktreeFolder('fix-login-bug')
    conversations.codex = outside
    const saved = manager.createSavedSession('/work/project', folder, 'codex')
    manager.opened(saved.id)
    manager.typed(saved.id, 'session-saved', 'a question\r')
    conversations.codex = [...outside, { id: 'own', title: 'Own', createdAt: saved.createdAt + 1 }]
    manager.sessionEnded(endedSaved(saved.id, folder, 'codex'))
    await manager.flush()

    expect(manager.listSavedSessions().map((entry) => entry.conversationId)).toEqual(['own'])
    const again = await restarted()
    expect(again.listSavedSessions().map((entry) => entry.conversationId)).toEqual(['own'])
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
    // Nor any from before it was made, when that is later.
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
  it('picks an id OpenCode accepts, and none for Claude Code and Codex', () => {
    expect(newConversationId('claude', makeId)).toBeNull()
    expect(newConversationId('opencode', makeId)).toBe('ses_ABC123')
    expect(newConversationId('codex', makeId)).toBeNull()
  })
})

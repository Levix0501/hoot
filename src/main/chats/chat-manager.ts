import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { inProjectFolder, type ChatInfo, type SavedSessionInfo } from '../../shared/chats'
import type { HookEventReport } from '../../shared/hoot-cli'
import type { SessionInfo } from '../../shared/session'
import type { CodingToolId } from '../../shared/tools'
import type { ChatLaunch } from '../session/launch'
import { ChatStore, type StoredChat } from './chat-store'
import type { AgentConversation, ChatConversations } from './conversations'

/** What a saved session is made with, besides its folder and its agent. */
export interface SavedSessionOptions {
  /** The name it shows, as one the user gave it with Rename… would be. */
  name?: string
  /**
   * The first message of its conversation, which its agent is sent when it
   * first starts, and never again.
   */
  firstMessage?: string
}

/** What a chat session runs: the folder its agent runs in, and how to continue its conversation. */
export interface PreparedChatSession {
  folder: string
  launch: ChatLaunch
}

export interface ChatManagerOptions {
  db: DatabaseSync
  conversations: ChatConversations
  /** The user's home directory; `~` of the chats folder. */
  home?: string
  /** The time to record, in milliseconds since the Unix epoch. */
  now?: () => number
  /** Makes the ids of chats and of the conversations Hoot starts. */
  newId?: () => string
  /**
   * Moves a folder, with what is in it, to the Trash (the Recycle Bin on
   * Windows); rejects when it cannot. Without it, every folder stays.
   */
  trash?: (folder: string) => Promise<void>
}

// Terminal queries and their answers are control characters by nature.
// oxlint-disable no-control-regex
/** What a terminal's escape sequences and query answers look like in the input Hoot gets. */
export function visibleInput(data: string): string {
  return data
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1bP[^\x1b]*\x1b\\/g, '')
    .replace(/\x1b\[[0-9;?<=>]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[()][0-9A-Za-z]/g, '')
    .replace(/\x1b./g, '')
}
// oxlint-enable no-control-regex

/**
 * The chats Hoot lists in the sidebar, and the saved sessions it lists below
 * their worktrees and their projects' Local rows, and what running them
 * takes: the folder each agent runs in (a chat's own under `~/.hoot/chats`,
 * for a saved session a worktree's root or its project's own folder), the
 * conversation its agent continues, and the new conversation an agent starts
 * with `/clear` or `/new`.
 *
 * It reads the agent's own records when a chat's process ends, and when Hoot
 * starts, to tell whether the chat's conversation got a message, to learn the
 * ids of the conversations an agent started since, and to split off the
 * conversations that came before them as chats of their own. A project's own
 * folder may hold conversations from before Hoot ran an agent there: a saved
 * session in it never takes up, nor splits off, one that started before the
 * session was made; once its agent ends, not one that started before Hoot
 * began to start that agent either, which may be another session's there.
 *
 * A chat the user deletes leaves the lists for good, but keeps its row, with
 * the conversation it was in, for as long as another chat in its folder could
 * take that conversation up: the agent's records still hold it.
 */
export class ChatManager extends EventEmitter<{
  changed: [chats: ChatInfo[]]
  'saved-changed': [sessions: SavedSessionInfo[]]
}> {
  private readonly chats: ChatStore
  private readonly home: string
  private readonly now: () => number
  private readonly newId: () => string
  private readonly conversations: ChatConversations
  private readonly trash: (folder: string) => Promise<void>
  /** The work under way for each chat, one after another. */
  private readonly queues = new Map<string, Promise<void>>()
  private readonly pending = new Set<Promise<void>>()
  /** The chats whose agent's process Hoot started and has not seen end. */
  private readonly running = new Set<string>()
  /** The line being typed in each chat's session, for the commands that start another conversation. */
  private readonly typing = new Map<string, string>()
  /** The title a Claude Code chat had when `/clear` was typed, for the chat its conversation leaves. */
  private readonly clearTitles = new Map<string, string>()
  /** The title each chat had before the last one its agent set. */
  private readonly previousTitles = new Map<string, string>()
  /** When the conversation a Claude Code chat is in started, by the hook that told of it. */
  private readonly conversationStartedAt = new Map<string, number>()
  /** When Hoot last began to start each chat's agent, before its process ran. */
  private readonly runStartedAt = new Map<string, number>()
  /** The first messages of the saved sessions whose agents have not started yet. */
  private readonly firstMessages = new Map<string, string>()

  constructor(options: ChatManagerOptions) {
    super()
    this.chats = new ChatStore(options.db)
    this.home = options.home ?? os.homedir()
    this.now = options.now ?? Date.now
    this.newId = options.newId ?? randomUUID
    this.conversations = options.conversations
    this.trash =
      options.trash ??
      (async () => {
        throw new Error('There is no Trash to move the folder to.')
      })
  }

  /** Every chat, in the order of the sidebar's Chats group. */
  list(): ChatInfo[] {
    return this.chats.list()
  }

  /**
   * Every saved session, oldest first, as they show below their worktrees and
   * their projects' Local rows.
   */
  listSavedSessions(): SavedSessionInfo[] {
    return this.chats.listSavedSessions()
  }

  /** The chat or saved session with this id, if any and the user has not deleted it. */
  get(id: string): ChatInfo | undefined {
    const chat = this.chats.get(id)
    if (!chat || chat.deleted) return undefined
    const { deleted: _deleted, ...info } = chat
    return info
  }

  /** The folder all the chats of an agent share, or where every other chat's folder goes. */
  private get chatsRoot(): string {
    return path.join(this.home, '.hoot', 'chats')
  }

  private get claudeFolder(): string {
    return path.join(this.chatsRoot, 'claude-code')
  }

  /**
   * Makes a chat of an agent, in a folder of its own: under `~/.hoot/chats`
   * for Codex and OpenCode, and in `~/.hoot/chats/claude-code`, which they
   * share, for Claude Code.
   */
  async create(toolId: CodingToolId): Promise<ChatInfo> {
    const folder = await this.newFolder(toolId)
    const at = this.now()
    const chat: ChatInfo = {
      id: this.newId(),
      toolId,
      folder,
      projectRoot: null,
      worktreePath: null,
      conversationId: newConversationId(toolId, this.newId),
      title: '',
      customName: null,
      hasMessages: false,
      createdAt: at,
      lastOpenedAt: at,
    }
    this.chats.insert(chat)
    this.emitChanged()
    return chat
  }

  /**
   * Makes a saved session of an agent, in a worktree of a project, or with
   * `null` for the worktree, in the project's own folder: the agent runs in
   * that folder, which Hoot keeps as it is. It can be made with a name, and
   * with a first message, which Hoot keeps only until its agent has started.
   */
  createSavedSession(
    projectRoot: string,
    worktreePath: string | null,
    toolId: CodingToolId,
    options: SavedSessionOptions = {},
  ): SavedSessionInfo {
    const at = this.now()
    const session = {
      id: this.newId(),
      toolId,
      folder: worktreePath ?? projectRoot,
      projectRoot,
      worktreePath,
      conversationId: newConversationId(toolId, this.newId),
      title: '',
      customName: options.name ?? null,
      hasMessages: false,
      createdAt: at,
      lastOpenedAt: at,
    }
    this.chats.insert(session)
    if (options.firstMessage !== undefined) this.firstMessages.set(session.id, options.firstMessage)
    this.emitChanged()
    return session
  }

  /** Deletes the saved sessions of a worktree that was deleted or removed. */
  removeForWorktree(worktreePath: string): void {
    if (this.chats.deleteForWorktree(worktreePath) > 0) this.emitChanged()
  }

  /** The folder a new chat of an agent runs in, made when it does not exist. */
  private async newFolder(toolId: CodingToolId): Promise<string> {
    await fs.mkdir(this.chatsRoot, { recursive: true })
    if (toolId === 'claude') {
      await fs.mkdir(this.claudeFolder, { recursive: true })
      return this.claudeFolder
    }
    return fs.mkdtemp(path.join(this.chatsRoot, `${toolId}-`))
  }

  /** Makes a chat's folder when it does not exist, as when it was deleted while the chat stayed. */
  private async ensureFolder(chat: ChatInfo): Promise<void> {
    await fs.mkdir(chat.folder, { recursive: true })
  }

  /**
   * What starting the chat's agent takes: its folder, made when missing, the
   * conversation to continue, fresh when it never got a message, and the
   * first message of a saved session whose agent has not started yet.
   */
  async prepareSession(id: string): Promise<PreparedChatSession | null> {
    const chat = this.chats.get(id)
    if (!chat || chat.deleted) return null
    this.clearTitles.delete(id)
    this.conversationStartedAt.delete(id)
    this.runStartedAt.set(id, this.now())
    // A saved session's folder is its worktree or its project's folder, which
    // Hoot does not make.
    if (chat.projectRoot === null) await this.ensureFolder(chat)
    let conversationId = chat.conversationId
    if (conversationId === null && chat.toolId !== 'codex') {
      conversationId = newConversationId(chat.toolId, this.newId)
      if (conversationId !== null) this.chats.update(id, { conversationId })
    }
    const resume = chat.hasMessages && conversationId !== null
    const firstMessage = this.firstMessages.get(id)
    return {
      folder: chat.folder,
      launch: {
        conversationId,
        resume,
        ...(firstMessage === undefined || resume ? {} : { firstMessage }),
      },
    }
  }

  /**
   * Notes that the chat's agent started, which moves the chat to the top of
   * Chats; it was sent its first message, if it had one, which it is not sent
   * again.
   */
  opened(id: string): void {
    this.firstMessages.delete(id)
    if (this.chats.get(id)?.deleted !== false) return
    this.chats.update(id, { lastOpenedAt: this.now() })
    this.running.add(id)
    this.emitChanged()
  }

  /** Changes the name the user gave a chat; an empty name takes it away. */
  rename(id: string, name: string): boolean {
    if (this.chats.get(id)?.deleted !== false) return false
    this.chats.update(id, { customName: name === '' ? null : name })
    this.emitChanged()
    return true
  }

  /** Notes the terminal title an agent set in the chat's conversation. */
  setTitle(id: string, title: string): void {
    const chat = this.chats.get(id)
    if (!chat || chat.deleted || chat.title === title) return
    // A program clears its title when it ends; the last title it set stays,
    // so that the chat's name does not change when it exits.
    if (title === '') return
    this.previousTitles.set(id, chat.title)
    this.chats.update(id, { title })
    this.emitChanged()
  }

  /**
   * Notes an event of a Claude Code hook of a chat's session: its first
   * message, or the new conversation `/clear` starts. A conversation that
   * had messages and is left for another stays as a chat of its own.
   */
  noteHookEvent(chatId: string, report: HookEventReport): void {
    if (report.event !== 'SessionStart' && report.event !== 'UserPromptSubmit') return
    const started = report.conversationId ?? null
    void this.enqueue(chatId, async () => {
      const chat = this.chats.get(chatId)
      if (!chat || chat.deleted) return
      if (started === null) {
        if (report.event === 'UserPromptSubmit' && !chat.hasMessages) {
          this.chats.update(chatId, { hasMessages: true })
          this.emitChanged()
        }
        return
      }
      if (started !== chat.conversationId) {
        // A message submitted before the conversation it belongs to changed
        // is not a message of the next one.
        if (
          report.event === 'UserPromptSubmit' &&
          report.startedAt < (this.conversationStartedAt.get(chatId) ?? 0)
        ) {
          return
        }
        this.conversationStartedAt.set(chatId, report.startedAt)
        const before = this.clearTitles.get(chatId)
        if (chat.conversationId !== null && chat.hasMessages) {
          // The title the conversation had when `/clear` was typed, before
          // Claude Code set the next one, if the title came in meanwhile; or
          // the title before the latest one.
          const previous = this.previousTitles.get(chatId)
          const title = before ?? (previous ? previous : chat.title)
          this.insertSplit(chat, {
            id: chat.conversationId,
            title: title === '' ? null : title,
            createdAt: chat.createdAt,
          })
        }
        this.clearTitles.delete(chatId)
        this.chats.update(chatId, {
          conversationId: started,
          hasMessages: report.event === 'UserPromptSubmit',
          // A title Claude Code already set for the new conversation stays.
          title: before !== undefined && chat.title !== before ? chat.title : '',
        })
        this.emitChanged()
        return
      }
      if (report.event === 'UserPromptSubmit' && !chat.hasMessages) {
        this.chats.update(chatId, { hasMessages: true })
        this.emitChanged()
      }
    })
  }

  /**
   * Notes what the user types in a chat, which a Codex or OpenCode agent can
   * start another conversation with, or that in Claude Code `/clear` does.
   */
  typed(chatId: string, sessionId: string, data: string): void {
    const chat = this.chats.get(chatId)
    if (!chat || chat.deleted) return
    let line = this.typing.get(sessionId) ?? ''
    for (const character of visibleInput(data)) {
      if (character === '\r' || character === '\n') {
        const command = line.trim()
        line = ''
        if (chat.toolId === 'claude') {
          // Claude Code reports `/clear` through its hooks; the title it had
          // before it started the next conversation names the one it leaves.
          if (command === '/clear') this.clearTitles.set(chatId, chat.title)
        } else if (command === '/new' || command === '/clear') {
          this.resetConversation(chatId, chat.title)
        } else if (command !== '' && !command.startsWith('/')) {
          this.markMessages(chatId)
        }
        continue
      }
      if (character === '\x7f' || character === '\b') {
        line = line.slice(0, -1)
        continue
      }
      // Escape sequences and other control characters are not part of a command.
      if ((character.codePointAt(0) ?? 0) < 32) continue
      line += character
      if (line.length > 10_000) line = ''
    }
    this.typing.set(sessionId, line)
  }

  /** Starts a conversation anew in the chat, keeping the one it had as a chat of its own. */
  private resetConversation(chatId: string, title: string): void {
    void this.enqueue(chatId, async () => {
      const chat = this.chats.get(chatId)
      if (!chat) return
      if (chat.conversationId !== null && chat.hasMessages) {
        this.insertSplit(chat, {
          id: chat.conversationId,
          title: title === '' ? null : title,
          createdAt: chat.createdAt,
        })
      }
      this.chats.update(chatId, { conversationId: null, hasMessages: false, title: '' })
      this.emitChanged()
    })
  }

  /** Notes that the user sent a message in the chat, which its conversation now has. */
  private markMessages(chatId: string): void {
    void this.enqueue(chatId, async () => {
      const chat = this.chats.get(chatId)
      if (!chat || chat.hasMessages) return
      this.chats.update(chatId, { hasMessages: true })
      this.emitChanged()
    })
  }

  /** Reads a chat's or saved session's records again once its process ended, to keep what it did. */
  sessionEnded(session: SessionInfo): void {
    const id = session.chatId ?? session.savedSessionId
    if (id === null || session.status !== 'exited') return
    this.running.delete(id)
    this.typing.delete(session.id)
    // The conversations its agent started, started once Hoot began to start it.
    const since = this.runStartedAt.get(id) ?? null
    this.runStartedAt.delete(id)
    void this.enqueue(id, () => this.reconcileChat(id, since))
  }

  /**
   * Reads the records of every chat's and saved session's agent, as when Hoot
   * starts: first for those the user deleted before Hoot learned which
   * conversation they were in, so that no other takes it up.
   */
  reconcileAll(): Promise<void> {
    return this.enqueue('*', async () => {
      for (const chat of [
        ...this.chats.deletedWithoutConversation(),
        ...this.list(),
        ...this.listSavedSessions(),
      ]) {
        await this.reconcileChat(chat.id)
      }
    })
  }

  /**
   * Deletes a chat or saved session the user no longer wants, once its agent
   * has ended: it leaves the lists for good, and the agent's own records of
   * its conversations stay as they are. As those records still hold its
   * conversation, a Codex or OpenCode one keeps its row, with the
   * conversation it was in, once Hoot read which that is: no other chat or
   * saved session in its folder takes it up then, and Hoot does not list it
   * as one of its own again. A Claude Code one, whose conversations no other
   * takes up, goes altogether. A chat's own folder goes to the Trash with
   * what is in it, once no other chat runs in it; a folder that cannot be
   * moved there stays as it is. A saved session's worktree or project folder
   * stays as it is.
   */
  delete(id: string): Promise<void> {
    this.firstMessages.delete(id)
    return this.enqueue(id, async () => {
      const chat = this.chats.get(id)
      if (!chat || chat.deleted) return
      if (chat.toolId === 'claude') {
        this.chats.delete(id)
        this.forget(id)
      } else {
        this.chats.markDeleted(id, this.now())
        // The conversation it was in, as its agent left its records, when
        // Hoot did not know it yet. While the agent of another session of its
        // folder runs, a conversation Hoot does not know may be that one's:
        // it is read when Hoot starts again, before any other.
        if (!this.anotherRunsIn(chat)) await this.reconcileChat(id)
      }
      this.emitChanged()
      await this.trashFolderIfOwned(chat)
    })
  }

  /** Settles once the reads and changes under way have finished. */
  async flush(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled(this.pending)
  }

  /**
   * Reads what the chat's agent recorded: whether its conversation got a
   * message, and which conversations it holds. When the agent left the chat's
   * conversation for a later one, the conversation it left becomes a chat of
   * its own, and the chat continues the newest; when its conversation never
   * got a message, the chat goes. `runStartedAt` is when Hoot began to start
   * the agent whose process just ended, if it did.
   */
  private async reconcileChat(chatId: string, runStartedAt: number | null = null): Promise<void> {
    // A chat whose agent runs is left to its process.
    if (this.running.has(chatId)) return
    let chat = this.chats.get(chatId)
    if (!chat) return
    if (chat.toolId === 'claude') {
      const exists =
        chat.conversationId !== null
          ? await this.conversations.claudeConversation(chat.folder, chat.conversationId)
          : false
      chat = this.chats.get(chatId)
      if (!chat) return
      if (!exists) {
        // A message the agent did not record, as when it failed, still keeps
        // the chat; one never sent removes it.
        if (!chat.hasMessages) await this.removeChat(chat)
        return
      }
      if (!chat.hasMessages) {
        this.chats.update(chatId, { hasMessages: true })
        this.emitChanged()
      }
      return
    }

    chat = this.chats.get(chatId)
    if (!chat) return
    const recorded =
      chat.toolId === 'codex'
        ? await this.conversations.codexConversations(chat.folder)
        : await this.conversations.openCodeConversations(chat.folder)
    // Without the agent's records, the chat is left as it is.
    if (recorded === null) return
    chat = this.chats.get(chatId)
    if (!chat) return
    const conversations = ownConversations(chat, recorded, runStartedAt)
    // The conversations that already belong to a chat of their own: those
    // this chat leaves for another stay as chats, and are not taken again.
    const claimed = new Set(
      this.chats
        .inFolder(chat.folder)
        .filter((other) => other.id !== chat.id)
        .flatMap((other) => (other.conversationId === null ? [] : [other.conversationId])),
    )
    const conversationId = chat.conversationId
    if (conversationId === null) {
      // The chat continues the newest conversation no other chat has, as a
      // first conversation, or one `/new` or `/clear` started.
      const unclaimed = conversations.filter((conversation) => !claimed.has(conversation.id))
      const newest = unclaimed.at(-1)
      if (!newest) {
        // It never got a message, as after `/clear` and none; a message the
        // agent did not record keeps the chat. A chat in a folder where
        // another chat holds a conversation is the one a command such as
        // `/new` left, whose agent stayed in that conversation or started one
        // that left no record: the conversation it had is the other chat's,
        // so it goes rather than becoming a chat with none.
        if (!chat.hasMessages || this.hasConversationSibling(chat)) {
          for (const conversation of conversations) this.insertSplit(chat, conversation)
          await this.removeChat(chat)
        }
        return
      }
      // Any conversations before it came from conversations the agent started and left.
      for (const conversation of unclaimed.slice(0, -1)) {
        this.insertSplit(chat, conversation)
      }
      this.chats.update(chatId, { conversationId: newest.id, hasMessages: true })
      this.emitChanged()
      return
    }
    const current = conversations.findIndex((conversation) => conversation.id === conversationId)
    if (current === -1) {
      // The conversation never got a message, as when `/clear` was followed by
      // none; one whose message the agent did not record keeps the chat.
      if (!chat.hasMessages) await this.removeChat(chat)
      return
    }
    const after = conversations
      .slice(current + 1)
      .filter((conversation) => !claimed.has(conversation.id))
    // A deleted chat keeps the conversation it was in: one after it may be
    // that of another chat in its folder.
    if (after.length > 0 && !chat.deleted && this.isActiveChat(chat)) {
      // The chat left its conversation for the newest one no other chat has,
      // as when the agent started another; the conversation it left stays as
      // a chat of its own, and so does any between them.
      const newest = after.at(-1)!
      this.insertSplit(chat, conversations[current]!)
      for (const conversation of after.slice(0, -1)) this.insertSplit(chat, conversation)
      this.chats.update(chatId, { conversationId: newest.id, hasMessages: true })
      this.emitChanged()
      return
    }
    if (!chat.hasMessages) {
      this.chats.update(chatId, { hasMessages: true })
      this.emitChanged()
    }
  }

  /**
   * Whether another chat in the folder holds a conversation. A chat with no
   * conversation of its own and a message the agent did not record is then
   * what a command such as `/new` left when the agent stayed in its
   * conversation, which that other chat already keeps.
   */
  private hasConversationSibling(chat: ChatInfo): boolean {
    return this.chats
      .inFolder(chat.folder)
      .some((other) => other.id !== chat.id && other.conversationId !== null)
  }

  /** Whether the agent of another chat of the same agent runs in the chat's folder. */
  private anotherRunsIn(chat: ChatInfo): boolean {
    return this.chats
      .inFolder(chat.folder)
      .some(
        (other) =>
          other.id !== chat.id && other.toolId === chat.toolId && this.running.has(other.id),
      )
  }

  /**
   * Whether this chat is the one opened last among those in its folder: the
   * one a conversation an agent started belongs to, when the chat that
   * started it does not say so itself.
   */
  private isActiveChat(chat: ChatInfo): boolean {
    const siblings = this.chats.inFolder(chat.folder)
    const active = siblings.reduce((best, candidate) => {
      if (candidate.lastOpenedAt !== best.lastOpenedAt) {
        return candidate.lastOpenedAt > best.lastOpenedAt ? candidate : best
      }
      return candidate.createdAt > best.createdAt ? candidate : best
    })
    return active.id === chat.id
  }

  /**
   * Adds a chat for a conversation the agent started and left, unless one has
   * it already: deleted, when the user deleted the chat it comes from.
   */
  private insertSplit(
    chat: StoredChat,
    conversation: Pick<AgentConversation, 'id' | 'title' | 'createdAt'>,
  ): void {
    const existing = this.chats
      .inFolder(chat.folder)
      .find((other) => other.id !== chat.id && other.conversationId === conversation.id)
    if (existing) {
      // The agent may have recorded the title of the conversation after the
      // chat was split off, as Codex and OpenCode do when they end.
      if (existing.customName === null && existing.title === '' && conversation.title !== null) {
        this.chats.update(existing.id, { title: conversation.title })
      }
      return
    }
    this.chats.insert(
      {
        id: this.newId(),
        toolId: chat.toolId,
        folder: chat.folder,
        projectRoot: chat.projectRoot,
        worktreePath: chat.worktreePath,
        conversationId: conversation.id,
        title: conversation.title ?? '',
        customName: null,
        hasMessages: true,
        // A saved session split off shows where it was split off, after the
        // sessions made before it; a chat comes in the order of Chats.
        createdAt:
          chat.projectRoot === null
            ? conversation.createdAt === 0
              ? this.now()
              : conversation.createdAt
            : this.now(),
        lastOpenedAt: chat.lastOpenedAt,
      },
      chat.deleted ? this.now() : null,
    )
  }

  /** Removes a chat whose conversation never got a message, with its folder when nothing else uses it. */
  private async removeChat(chat: ChatInfo): Promise<void> {
    // A saved session's worktree or project folder stays as it is.
    this.chats.delete(chat.id)
    this.forget(chat.id)
    await this.removeFolderIfOwned(chat)
    this.emitChanged()
  }

  /** Forgets what Hoot noted of a chat while its agent ran. */
  private forget(id: string): void {
    this.clearTitles.delete(id)
    this.conversationStartedAt.delete(id)
    this.previousTitles.delete(id)
    this.runStartedAt.delete(id)
  }

  /**
   * Whether a chat runs in a folder Hoot made for it alone: one under
   * `~/.hoot/chats` for a Codex or OpenCode chat, which the chats split off
   * from it share. Claude Code's shared folder, and a saved session's
   * worktree or project folder, are not.
   */
  private ownsFolder(chat: ChatInfo): boolean {
    if (chat.projectRoot !== null) return false
    if (chat.toolId === 'claude') return false
    if (path.resolve(path.dirname(chat.folder)) !== path.resolve(this.chatsRoot)) return false
    return path.resolve(chat.folder) !== path.resolve(this.claudeFolder)
  }

  /**
   * Removes a folder Hoot made for a chat when it is empty and no other chat
   * uses it. Claude Code's shared folder stays, and so does any file in it,
   * which Hoot never removes.
   */
  private async removeFolderIfOwned(chat: ChatInfo): Promise<void> {
    if (!this.ownsFolder(chat)) return
    if (this.chats.inFolder(chat.folder).length > 0) return
    try {
      // Only an empty folder is removed; one with anything in it stays.
      await fs.rmdir(chat.folder)
    } catch {
      // What is in it stays as it is.
    }
  }

  /**
   * Moves the folder Hoot made for a deleted chat to the Trash, with what is
   * in it, once no chat the user has not deleted runs in it. The deleted
   * chats of the folder go with it, as no other chat can take up their
   * conversations then. A folder that cannot be moved stays as it is, and so
   * do they.
   */
  private async trashFolderIfOwned(chat: ChatInfo): Promise<void> {
    if (!this.ownsFolder(chat)) return
    if (this.chats.inFolder(chat.folder).some((other) => !other.deleted)) return
    try {
      await this.trash(chat.folder)
    } catch {
      return
    }
    this.chats.deleteInFolder(chat.folder)
  }

  private emitChanged(): void {
    this.emit('changed', this.chats.list())
    this.emit('saved-changed', this.chats.listSavedSessions())
  }

  /** Runs `task` once the work already queued for `key` has finished. */
  private enqueue(key: string, task: () => Promise<void>): Promise<void> {
    const before = this.queues.get(key) ?? Promise.resolve()
    const run = before.then(task)
    const settled = run.catch((error: unknown) => {
      console.error(`Could not read the chat's conversations:`, error)
    })
    this.queues.set(key, settled)
    this.pending.add(settled)
    void settled.then(() => {
      if (this.queues.get(key) === settled) this.queues.delete(key)
      this.pending.delete(settled)
    })
    return run
  }
}

/**
 * The conversations of a chat's folder, oldest first, that can be the chat's
 * own: all of them, except in a project's own folder, which may hold
 * conversations the agent had there before Hoot ran it there, in Hoot or out
 * of it. A saved session there never takes up one that started before Hoot
 * made the session, nor splits one off as a session of its own: only the one
 * it is in, which a session split off had before it was made, and those that
 * started since. Once its agent's process ends, those that started since Hoot
 * began to start that agent (`runStartedAt`): one that started before is not
 * one that process started, and may be that of another session there whose
 * agent runs, or ended since and is still to be read.
 */
export function ownConversations(
  chat: Pick<ChatInfo, 'projectRoot' | 'worktreePath' | 'conversationId' | 'createdAt'>,
  recorded: readonly AgentConversation[],
  runStartedAt: number | null = null,
): AgentConversation[] {
  if (!inProjectFolder(chat)) return [...recorded]
  const since = Math.max(chat.createdAt, runStartedAt ?? 0)
  return recorded.filter(
    (conversation) => conversation.id === chat.conversationId || conversation.createdAt >= since,
  )
}

/**
 * The id of a new conversation an agent starts with: a UUID Claude Code can
 * be given, a session id OpenCode accepts, or `null` for Codex, which picks
 * its own and Hoot learns later.
 */
export function newConversationId(
  toolId: CodingToolId,
  makeId: () => string = randomUUID,
): string | null {
  switch (toolId) {
    case 'claude':
      return makeId()
    case 'opencode':
      // OpenCode's session ids start with `ses`.
      return `ses_${makeId().replaceAll('-', '')}`
    case 'codex':
      return null
  }
}

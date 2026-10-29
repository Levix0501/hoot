import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { inProjectFolder, type ChatInfo, type SavedSessionInfo } from '../../shared/chats'
import type { HookEventReport } from '../../shared/hoot-cli'
import { defaultSessionName, type SessionInfo } from '../../shared/session'
import type { CodingToolId } from '../../shared/tools'
import type { ChatLaunch } from '../session/launch'
import { ChatStore } from './chat-store'
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
 * The commands with which an agent leaves its conversation for another in a
 * session: a new one, one it had before, or a branch of the one it is in.
 * Hoot notes the title the chat had then, for the name it shows once the
 * agent reports the next conversation; it does not tell from them, or from
 * anything else typed, which conversation a chat is in.
 */
const SWITCH_COMMANDS: Readonly<Record<CodingToolId, readonly string[]>> = {
  claude: ['/clear', '/resume', '/branch'],
  codex: ['/new', '/clear', '/resume', '/fork'],
  opencode: ['/new', '/clear'],
}

/** How a run of a chat's agent went, as Hoot saw it, once its process ended. */
interface EndedRun {
  /** When Hoot began to start the agent, if it did. */
  startedAt: number | null
  /** Whether the agent told of a conversation it sent a message in. */
  reported: boolean
}

/**
 * The chats Hoot lists in the sidebar, and the saved sessions it lists below
 * their worktrees and their projects' Local rows, and what running them
 * takes: the folder each agent runs in (a chat's own under `~/.hoot/chats`,
 * for a saved session a worktree's root or its project's own folder), and the
 * conversation its agent continues.
 *
 * A chat is in one conversation at a time. When its agent leaves it for
 * another, as with `/clear` or `/new`, the chat goes on in the next one once a
 * message is sent there, and the one it left is no longer listed: the agent's
 * own records keep it. Claude Code picks the id of each conversation it
 * starts, and tells of the conversation each message goes to through its
 * hooks: a Claude Code chat is in no conversation until it told of one, and
 * one that never did goes once its agent ends, as when the user turned off
 * Claude Code's hooks. Codex tells of the conversation each message goes to
 * through the hook Hoot gives it, once the user trusted that hook: a Codex
 * chat in a conversation Codex told of goes on in another only when Codex
 * tells of that one, whatever Codex records in the chat's folder and however
 * a later run went. For any other Codex chat, and for OpenCode, Hoot reads
 * the agent's own records to tell whether the chat's conversation got a
 * message and which conversation a chat went on to, as before Hoot learned
 * conversations from Codex. When a chat's process ends, and when Hoot starts
 * for a Codex run it did not see end, the chat can go on only to one that
 * started in that run and got a message. When Hoot starts, it also reads
 * each OpenCode chat, and each Codex chat in no conversation and without
 * such a run, with no run to go by: such a chat may take up, or go on to,
 * one that started at any time and got a message. It tells that from those
 * records alone, and from the chats and runs it noted, never from what the
 * user typed: a chat may go on to one started in its folder out of Hoot, or
 * by another chat's agent. It never lists a conversation it finds there as
 * a chat of its own.
 * A project's own folder may hold conversations from before Hoot ran an
 * agent there: a saved session in it never takes up one that started before
 * the session was made.
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
  /** The line being typed in each chat's session, for the commands that leave its conversation. */
  private readonly typing = new Map<string, string>()
  /**
   * The title each chat had when its agent was last told to leave its
   * conversation for another, until a message there takes the chat with it.
   */
  private readonly titlesAtSwitch = new Map<string, string>()
  /** When the hook that told of the latest message of each chat's conversation ran. */
  private readonly messageReportedAt = new Map<string, number>()
  /** When Hoot last began to start each chat's agent, before its process ran. */
  private readonly runStartedAt = new Map<string, number>()
  /** The chats whose agent told of a conversation it sent a message in since Hoot began to start it. */
  private readonly reported = new Set<string>()
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
    const {
      deleted: _deleted,
      conversationReported: _reported,
      unreportedRun: _unreportedRun,
      ...info
    } = chat
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
    this.titlesAtSwitch.delete(id)
    this.messageReportedAt.delete(id)
    this.reported.delete(id)
    const startedAt = this.now()
    this.runStartedAt.set(id, startedAt)
    // A saved session's folder is its worktree or its project's folder, which
    // Hoot does not make.
    if (chat.projectRoot === null) await this.ensureFolder(chat)
    // OpenCode is given the id of the conversation it starts; Claude Code and
    // Codex pick their own.
    let conversationId = chat.conversationId
    if (conversationId === null && chat.toolId === 'opencode') {
      conversationId = newConversationId(chat.toolId, this.newId)
      if (conversationId !== null) this.chats.update(id, { conversationId })
    }
    const resume = chat.hasMessages && conversationId !== null
    const firstMessage = this.firstMessages.get(id)
    // Kept until Codex reports a conversation in the run, or Hoot sees it end:
    // what Hoot reads when it starts again after quitting without that. A
    // conversation Codex reported is not read again.
    if (chat.toolId === 'codex' && !chat.conversationReported) {
      this.chats.update(id, { unreportedRun: { startedAt } })
    }
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
    this.chats.update(id, { title })
    this.emitChanged()
  }

  /**
   * Notes an event of a Claude Code or Codex hook of a chat's session: a
   * message sent in a conversation, which the chat goes on in from then on,
   * or the conversation Claude Code goes to as it leaves the one the chat is
   * in, which the chat does not go on in before a message is sent there. A
   * hook that ran before the one that told of the chat's latest message
   * tells of a conversation the chat may have left since.
   */
  noteHookEvent(chatId: string, report: HookEventReport): void {
    const reported = report.conversationId ?? null
    if (reported === null) return
    if (report.event === 'SessionStart') {
      void this.enqueue(chatId, async () => {
        const chat = this.chats.get(chatId)
        if (!chat || chat.deleted || chat.conversationId === null) return
        if (reported !== chat.conversationId) this.noteSwitch(chatId, chat.title)
      })
      return
    }
    if (report.event !== 'UserPromptSubmit') return
    // Known at once, for the end of the run, which may be read before this is,
    // and for Hoot's next start, should it quit without seeing the run end.
    this.reported.add(chatId)
    if (this.chats.get(chatId)?.unreportedRun) this.chats.update(chatId, { unreportedRun: null })
    void this.enqueue(chatId, async () => {
      const chat = this.chats.get(chatId)
      if (!chat || chat.deleted) return
      if (report.startedAt < (this.messageReportedAt.get(chatId) ?? 0)) return
      this.messageReportedAt.set(chatId, report.startedAt)
      if (reported === chat.conversationId) {
        if (!chat.hasMessages || !chat.conversationReported) {
          this.chats.update(chatId, { hasMessages: true, conversationReported: true })
          this.emitChanged()
        }
        return
      }
      const titleAtSwitch = this.titlesAtSwitch.get(chatId)
      this.titlesAtSwitch.delete(chatId)
      this.chats.update(chatId, {
        conversationId: reported,
        conversationReported: true,
        hasMessages: true,
        title: chat.conversationId === null ? chat.title : titleAfterSwitch(chat, titleAtSwitch),
      })
      this.emitChanged()
    })
  }

  /**
   * Notes that the chat's agent was told to leave its conversation for
   * another, with the title the chat had then, the one its agent gave the
   * conversation it leaves: once the chat goes on in the next one, a title
   * the agent sets after this one is that conversation's.
   */
  private noteSwitch(chatId: string, title: string): void {
    if (!this.titlesAtSwitch.has(chatId)) this.titlesAtSwitch.set(chatId, title)
  }

  /**
   * Notes the commands the user types in a chat that leave its conversation
   * for another, for the title the chat shows once its agent reports the next
   * one: nothing typed tells Hoot which conversation the chat is in.
   */
  typed(chatId: string, sessionId: string, data: string): void {
    const chat = this.chats.get(chatId)
    if (!chat || chat.deleted) return
    let line = this.typing.get(sessionId) ?? ''
    for (const character of visibleInput(data)) {
      if (character === '\r' || character === '\n') {
        const name = line.trim().split(/\s/, 1)[0] ?? ''
        line = ''
        if (SWITCH_COMMANDS[chat.toolId].includes(name)) this.noteSwitch(chatId, chat.title)
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

  /** Reads a chat's or saved session's records again once its process ended, to keep what it did. */
  sessionEnded(session: SessionInfo): void {
    const id = session.chatId ?? session.savedSessionId
    if (id === null || session.status !== 'exited') return
    this.running.delete(id)
    this.typing.delete(session.id)
    const run: EndedRun = {
      startedAt: this.runStartedAt.get(id) ?? null,
      reported: this.reported.has(id),
    }
    this.runStartedAt.delete(id)
    this.reported.delete(id)
    this.titlesAtSwitch.delete(id)
    void this.enqueue(id, async () => {
      await this.reconcileChat(id, run)
      if (run.startedAt !== null) this.endUnreportedRun(id, run.startedAt)
    })
  }

  /**
   * Forgets the run of a chat's agent that began at `startedAt`, once Hoot
   * read what it did, unless another run began since.
   */
  private endUnreportedRun(id: string, startedAt: number): void {
    if (this.chats.get(id)?.unreportedRun?.startedAt === startedAt) {
      this.chats.update(id, { unreportedRun: null })
    }
  }

  /**
   * Reads the records of every chat's and saved session's agent, as when Hoot
   * starts: first for those the user deleted before Hoot learned which
   * conversation they were in, so that no other takes it up. A run of a
   * Codex chat's agent that Hoot did not see end, as when Hoot quit without
   * ending it, and in which Codex reported no conversation, is read as Hoot
   * reads such a run when it ends. A Codex chat in a conversation is read for
   * no other: Hoot read each run it saw end when it ended, and does not read
   * one whose conversation Codex reported at all.
   */
  reconcileAll(): Promise<void> {
    return this.enqueue('*', async () => {
      // As Hoot left them, before any session of this start began.
      const chats = [
        ...this.chats.deletedWithoutConversation(),
        ...this.list(),
        ...this.listSavedSessions(),
      ].flatMap((chat) => this.chats.get(chat.id) ?? [])
      for (const chat of chats) {
        const run = chat.unreportedRun
        if (chat.toolId === 'codex' && chat.conversationId !== null && run === null) continue
        await this.reconcileChat(
          chat.id,
          run ? { startedAt: run.startedAt, reported: false } : null,
        )
        if (run) this.endUnreportedRun(chat.id, run.startedAt)
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
   * message, and which conversation the chat went on to. A Codex or OpenCode
   * chat without a conversation takes up the newest one no other chat has,
   * and one with a conversation goes on to the newest that came after it,
   * when it is the chat opened last in its folder; a conversation either
   * leaves is no longer the chat's, nor any other's. Once its agent ended,
   * only a conversation that started in that run can be the next one: the
   * agent records one only once a message was sent in it, so a run that sent
   * none leaves the chat as it was, unless one started in its folder out of
   * Hoot or by another chat's agent. When the chat's conversation never got
   * a message, the chat goes. A conversation Codex reported stays the chat's
   * for good: Hoot does not read the records for it. `run` is how the run of
   * the agent whose process just ended went, if one did, or one Hoot did not
   * see end, read when Hoot starts.
   */
  private async reconcileChat(chatId: string, run: EndedRun | null = null): Promise<void> {
    // A chat whose agent runs is left to its process.
    if (this.running.has(chatId)) return
    let chat = this.chats.get(chatId)
    if (!chat) return
    if (chat.toolId === 'claude') {
      // A Claude Code chat is in the conversation its agent reported a
      // message in: one in none goes, and Hoot does not look for one.
      if (chat.conversationId === null) {
        await this.removeChat(chat)
        return
      }
      if (chat.hasMessages) return
      // A conversation Hoot gave the agent before it reported its own, which
      // got a message unless the agent recorded none.
      const exists = await this.conversations.claudeConversation(chat.folder, chat.conversationId)
      chat = this.chats.get(chatId)
      if (!chat) return
      if (!exists) {
        await this.removeChat(chat)
        return
      }
      this.chats.update(chatId, { hasMessages: true })
      this.emitChanged()
      return
    }

    if (chat.conversationReported || run?.reported === true) return
    const recorded =
      chat.toolId === 'codex'
        ? await this.conversations.codexConversations(chat.folder)
        : await this.conversations.openCodeConversations(chat.folder)
    // Without the agent's records, the chat is left as it is.
    if (recorded === null) return
    chat = this.chats.get(chatId)
    if (!chat) return
    const conversations = ownConversations(chat, recorded, run?.startedAt ?? null)
    const conversationId = chat.conversationId
    const current = conversations.findIndex((conversation) => conversation.id === conversationId)
    // The conversations other chats are in, which this one does not take up.
    const claimed = new Set(
      this.chats
        .inFolder(chat.folder)
        .filter((other) => other.id !== chat.id)
        .flatMap((other) => (other.conversationId === null ? [] : [other.conversationId])),
    )
    // The newest conversation the chat can have gone on to: after its own, in
    // no other chat, and once its agent ended, one that started in its run.
    const since = run?.startedAt ?? null
    const next = conversations
      .slice(current + 1)
      .filter(
        (conversation) =>
          !claimed.has(conversation.id) && (since === null || conversation.createdAt >= since),
      )
      .at(-1)
    if (conversationId === null || current === -1) {
      // The chat had no conversation yet, or one that never got a message,
      // as one OpenCode was to start when another took its place.
      if (next) {
        this.chats.update(chatId, {
          conversationId: next.id,
          conversationReported: false,
          hasMessages: true,
          ...(conversationId === null ? {} : { title: next.title ?? '' }),
        })
        this.emitChanged()
        return
      }
      // A chat whose conversation got a message stays, though the records no
      // longer hold it. A chat without a conversation in a folder where
      // another chat holds one may have sent its message there, and goes
      // rather than becoming a chat with none.
      const gone =
        conversationId === null
          ? !chat.hasMessages || this.hasConversationSibling(chat)
          : !chat.hasMessages
      if (gone) await this.removeChat(chat)
      return
    }
    // A deleted chat keeps the conversation it was in: one after it may be
    // that of another chat in its folder.
    if (next && !chat.deleted && this.isActiveChat(chat)) {
      this.chats.update(chatId, {
        conversationId: next.id,
        conversationReported: false,
        hasMessages: true,
        title: next.title ?? '',
      })
      this.emitChanged()
      return
    }
    if (!chat.hasMessages) {
      this.chats.update(chatId, { hasMessages: true })
      this.emitChanged()
    }
  }

  /** Whether another chat in the folder holds a conversation. */
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
    this.titlesAtSwitch.delete(id)
    this.messageReportedAt.delete(id)
    this.runStartedAt.delete(id)
    this.reported.delete(id)
  }

  /**
   * Whether a chat runs in a folder Hoot made for it alone: one under
   * `~/.hoot/chats` for a Codex or OpenCode chat, which chats that earlier
   * versions of Hoot split off from it share. Claude Code's shared folder,
   * and a saved session's worktree or project folder, are not.
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
 * The title a chat shows once its agent reported the next conversation: one
 * the agent set since it was told to leave the conversation it was in, while
 * that title was `titleAtSwitch`. Without one, it shows the agent's name.
 */
function titleAfterSwitch(
  chat: Pick<ChatInfo, 'toolId' | 'title'>,
  titleAtSwitch: string | undefined,
): string {
  if (
    titleAtSwitch !== undefined &&
    defaultSessionName(chat.toolId, chat.title) !== defaultSessionName(chat.toolId, titleAtSwitch)
  ) {
    return chat.title
  }
  return ''
}

/**
 * The conversations of a chat's folder, oldest first, that can be the chat's
 * own: all of them, except in a project's own folder, which may hold
 * conversations the agent had there before Hoot ran it there, in Hoot or out
 * of it. A saved session there never takes up one that started before Hoot
 * made the session: only the one it is in, which a session that an earlier
 * version of Hoot split off had before it was made, and those that started
 * since. Once its agent's process ends, those that started since Hoot
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
 * The id of a new conversation an agent starts with: a session id OpenCode
 * accepts, or `null` for Claude Code and Codex, which pick their own and tell
 * Hoot, or leave it to their records.
 */
export function newConversationId(
  toolId: CodingToolId,
  makeId: () => string = randomUUID,
): string | null {
  switch (toolId) {
    case 'opencode':
      // OpenCode's session ids start with `ses`.
      return `ses_${makeId().replaceAll('-', '')}`
    case 'claude':
    case 'codex':
      return null
  }
}

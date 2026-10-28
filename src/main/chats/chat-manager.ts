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

/**
 * The keys, as a terminal sends them, with which the user puts a message sent
 * before, from the agent's history, in its empty input box, which Hoot does
 * not see: Up in either cursor key mode, and Ctrl+P for Codex as well. They
 * also move the selection in the agent's lists, such as Codex's review of
 * its hooks, where Enter sends nothing. Claude Code tells of its messages
 * through its hooks.
 */
const HISTORY_KEYS: Readonly<Record<CodingToolId, RegExp | null>> = {
  claude: null,
  codex: /\x1b[[O]A|\x10/,
  opencode: /\x1b[[O]A/,
}
// oxlint-enable no-control-regex

/**
 * The commands with which an agent leaves its conversation for another in a
 * session: a new one, one it had before, or a branch of the one it is in.
 */
const SWITCH_COMMANDS: Readonly<Record<CodingToolId, readonly string[]>> = {
  claude: ['/clear', '/resume', '/branch'],
  codex: ['/new', '/clear', '/resume', '/fork'],
  opencode: ['/new', '/clear'],
}

/**
 * The commands with which a Codex or OpenCode agent leaves its conversation
 * for a new one, which the next message starts.
 */
const NEW_CONVERSATION_COMMANDS: Readonly<Record<CodingToolId, readonly string[]>> = {
  claude: [],
  codex: ['/new', '/clear', '/fork'],
  opencode: ['/new', '/clear'],
}

/** How a run of a chat's agent went, as Hoot saw it, once its process ended. */
interface EndedRun {
  /** When Hoot began to start the agent, if it did. */
  startedAt: number | null
  /**
   * Whether Hoot saw a message sent in it: one typed, the first message it
   * started with, or one recalled from the agent's history that started a
   * conversation.
   */
  messaged: boolean
  /** Whether the agent told of a conversation it sent a message in. */
  reported: boolean
  /** The title the chat had when its agent was told to leave its conversation, if it was. */
  titleAtSwitch: string | undefined
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
 * through the hook Hoot gives it, once the user trusted that hook; the
 * conversation it tells of stays the chat's whatever Codex records in the
 * chat's folder. Otherwise, as for OpenCode, Hoot reads the agent's own
 * records when a chat's process ends, and when Hoot starts, to tell whether
 * the chat's conversation got a message and which conversation a chat went
 * on to, leaving out a Codex conversation that never got one; it never lists
 * a conversation it finds there as a chat of its own. A project's own folder
 * may hold conversations from before Hoot ran an agent there: a saved
 * session in it never takes up one that started before the session was
 * made; once its agent ends, not one that started before Hoot began to start
 * that agent either, which may be another session's there.
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
  /**
   * The sessions whose line being typed may hold a message recalled from the
   * agent's history since the last Enter, which Hoot does not see.
   */
  private readonly recalled = new Set<string>()
  /** The sessions whose agent was told to leave its conversation for a new one. */
  private readonly leftForNew = new Set<string>()
  /**
   * The sessions in which the user typed Enter or a character of the line:
   * in a Codex session, the digits typed first are not one.
   */
  private readonly typedInput = new Set<string>()
  /**
   * The title each chat had when its agent was last told to leave its
   * conversation for another, until a message there takes the chat with it.
   */
  private readonly titlesAtSwitch = new Map<string, string>()
  /** When the hook that told of the latest message of each chat's conversation ran. */
  private readonly messageReportedAt = new Map<string, number>()
  /** When Hoot last began to start each chat's agent, before its process ran. */
  private readonly runStartedAt = new Map<string, number>()
  /** The chats whose agent Hoot saw sent a message since it began to start it. */
  private readonly messaged = new Set<string>()
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
    this.messaged.delete(id)
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
    if (firstMessage !== undefined && !resume) this.messaged.add(id)
    // Kept until Codex reports a conversation in the run, or Hoot sees it end:
    // what Hoot reads when it starts again after quitting without that.
    if (chat.toolId === 'codex') {
      this.chats.update(id, { unreportedRun: { startedAt, messaged: this.messaged.has(id) } })
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
        title:
          chat.conversationId === null ? chat.title : titleAfterSwitch(chat, titleAtSwitch, null),
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
   * Notes what the user types in a chat: the messages the user sends, which
   * a Codex or OpenCode chat's conversation has from then on, and the
   * commands that leave the conversation for another. Enter on a line with
   * nothing typed, after a key that recalls a message from the agent's
   * history, may send that message, whose text Hoot does not see, or may
   * pick an item of a list. It is taken for a message only where a message
   * starts a conversation, which Hoot then finds in the agent's records: in
   * a chat without a conversation yet, and once the agent was told to leave
   * its conversation for a new one. Digits typed first in a Codex session
   * may answer Codex's review of its hooks, which shows before its input box
   * and takes a digit with no Enter after it: they are not part of the line.
   */
  typed(chatId: string, sessionId: string, data: string): void {
    const chat = this.chats.get(chatId)
    if (!chat || chat.deleted) return
    let line = this.typing.get(sessionId) ?? ''
    let recalled = this.recalled.has(sessionId)
    const historyKeys = HISTORY_KEYS[chat.toolId]
    const parts = historyKeys === null ? [data] : data.split(historyKeys)
    for (const [index, part] of parts.entries()) {
      if (index > 0) recalled = true
      for (const character of visibleInput(part)) {
        if (!this.typedInput.has(sessionId)) {
          if (chat.toolId === 'codex' && /^[1-9]$/.test(character)) continue
          if (character === '\r' || character === '\n' || character >= ' ') {
            this.typedInput.add(sessionId)
          }
        }
        if (character === '\r' || character === '\n') {
          const command = line.trim()
          const startsConversation = chat.conversationId === null || this.leftForNew.has(sessionId)
          const sent = command !== '' || (recalled && startsConversation)
          line = ''
          recalled = false
          if (command.startsWith('/')) {
            const name = command.split(/\s/, 1)[0] ?? ''
            if (SWITCH_COMMANDS[chat.toolId].includes(name)) this.noteSwitch(chatId, chat.title)
            if (NEW_CONVERSATION_COMMANDS[chat.toolId].includes(name)) {
              this.leftForNew.add(sessionId)
            }
            continue
          }
          if (!sent) continue
          if (!this.messaged.has(chatId)) {
            this.messaged.add(chatId)
            const run = this.chats.get(chatId)?.unreportedRun
            if (run && !run.messaged) {
              this.chats.update(chatId, { unreportedRun: { ...run, messaged: true } })
            }
          }
          // Claude Code tells of its messages through its hooks. A message
          // recalled may have been an item picked: the agent's records tell.
          if (chat.toolId !== 'claude' && command !== '') this.markMessages(chatId)
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
    }
    this.typing.set(sessionId, line)
    if (recalled) this.recalled.add(sessionId)
    else this.recalled.delete(sessionId)
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
    this.recalled.delete(session.id)
    this.leftForNew.delete(session.id)
    this.typedInput.delete(session.id)
    const run: EndedRun = {
      startedAt: this.runStartedAt.get(id) ?? null,
      messaged: this.messaged.has(id),
      reported: this.reported.has(id),
      titleAtSwitch: this.titlesAtSwitch.get(id),
    }
    this.runStartedAt.delete(id)
    this.messaged.delete(id)
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
   * conversation they were in, so that no other takes it up. A Codex chat
   * whose conversation Codex reported is read only for a run of its agent
   * that Hoot did not see end, as when Hoot quit without ending it, and in
   * which Codex reported no conversation: as Hoot reads such a run when it
   * ends.
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
        await this.reconcileChat(
          chat.id,
          run && chat.conversationReported
            ? { ...run, reported: false, titleAtSwitch: undefined }
            : null,
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
   * leaves is no longer the chat's, nor any other's. A run in which Hoot saw
   * no message sent leaves the chat in the conversation it was in. When the
   * chat's conversation never got a message, the chat goes. A conversation
   * the agent reported stays the chat's: Hoot reads the records again only
   * once a later run of the agent ended without reporting one. `run` is how
   * the run of the agent whose process just ended went, if one did, or one
   * Hoot did not see end, read when Hoot starts.
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

    if (run === null ? chat.conversationReported : run.reported) return
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
    if (run !== null && !run.messaged) {
      // The agent went on to no other conversation without a message; a
      // conversation that never got one leaves the chat with none.
      if (current !== -1 && !chat.hasMessages) {
        this.chats.update(chatId, { hasMessages: true })
        this.emitChanged()
      } else if (current === -1 && !chat.hasMessages) {
        await this.removeChat(chat)
      }
      return
    }
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
          ...(conversationId === null
            ? {}
            : { title: titleAfterSwitch(chat, run?.titleAtSwitch, next.title) }),
        })
        this.emitChanged()
        return
      }
      // A message the agent did not record keeps the chat. A chat without a
      // conversation in a folder where another chat holds one may have sent
      // its message there, and goes rather than becoming a chat with none.
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
        title: titleAfterSwitch(chat, run?.titleAtSwitch, next.title),
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
    this.messaged.delete(id)
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
 * The title a chat shows once it went on to the next conversation: one its
 * agent set since it was told to leave the conversation it was in, while
 * that title was `titleAtSwitch`, or else the title the agent recorded for
 * the next conversation, if any. Without one, it shows the agent's name.
 */
function titleAfterSwitch(
  chat: Pick<ChatInfo, 'toolId' | 'title'>,
  titleAtSwitch: string | undefined,
  recorded: string | null,
): string {
  if (
    titleAtSwitch !== undefined &&
    defaultSessionName(chat.toolId, chat.title) !== defaultSessionName(chat.toolId, titleAtSwitch)
  ) {
    return chat.title
  }
  return recorded ?? ''
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

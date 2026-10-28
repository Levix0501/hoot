import type { DatabaseSync } from 'node:sqlite'
import type { ChatInfo, SavedSessionInfo } from '../../shared/chats'
import type { CodingToolId } from '../../shared/tools'

interface ChatRow {
  id: string
  tool_id: CodingToolId
  folder: string
  project_root: string | null
  worktree_path: string | null
  conversation_id: string | null
  title: string
  custom_name: string | null
  has_messages: number
  created_at: number
  opened_at: number
  deleted_at: number | null
  conversation_reported: number
  unreported_run_started_at: number | null
  unreported_run_messaged: number
}

const COLUMNS = `id, tool_id, folder, project_root, worktree_path, conversation_id, title,
                 custom_name, has_messages, created_at, opened_at, deleted_at,
                 conversation_reported, unreported_run_started_at, unreported_run_messaged`

/**
 * A run of a Codex chat's agent that Hoot began and has not seen end, while
 * Codex reported no conversation in it: when Hoot began to start the agent,
 * and whether Hoot saw a message sent in it.
 */
export interface UnreportedRun {
  startedAt: number
  messaged: boolean
}

/**
 * A chat or saved session as the database keeps it: also one the user
 * deleted, which keeps its row so that its conversation stays its own.
 */
export interface StoredChat extends ChatInfo {
  /** Whether the user deleted it, which leaves it out of the sidebar for good. */
  deleted: boolean
  /**
   * Whether the agent itself reported the conversation it is in, which Hoot
   * then does not change by what the agent recorded in its folder.
   */
  conversationReported: boolean
  /**
   * The run of its agent that Hoot began and has not seen end, while Codex
   * reported no conversation in it, if any: what Hoot reads when it starts
   * again after quitting without seeing that run end.
   */
  unreportedRun: UnreportedRun | null
}

function chatFromRow(row: ChatRow): ChatInfo {
  return {
    id: row.id,
    toolId: row.tool_id,
    folder: row.folder,
    projectRoot: row.project_root,
    worktreePath: row.worktree_path,
    conversationId: row.conversation_id,
    title: row.title,
    customName: row.custom_name,
    hasMessages: row.has_messages === 1,
    createdAt: row.created_at,
    lastOpenedAt: row.opened_at,
  }
}

function storedFromRow(row: ChatRow): StoredChat {
  return {
    ...chatFromRow(row),
    deleted: row.deleted_at !== null,
    conversationReported: row.conversation_reported === 1,
    unreportedRun:
      row.unreported_run_started_at === null
        ? null
        : {
            startedAt: row.unreported_run_started_at,
            messaged: row.unreported_run_messaged === 1,
          },
  }
}

function savedSessionFromRow(row: ChatRow): SavedSessionInfo {
  const chat = chatFromRow(row)
  if (chat.projectRoot === null) throw new Error(`The saved session ${chat.id} has no project.`)
  return { ...chat, projectRoot: chat.projectRoot }
}

/** What can change about a chat; what is left out stays as it is. */
export interface ChatChanges {
  conversationId?: string | null
  conversationReported?: boolean
  unreportedRun?: UnreportedRun | null
  title?: string
  customName?: string | null
  hasMessages?: boolean
  lastOpenedAt?: number
}

/**
 * The chats and saved sessions, kept in the database. A chat has no project;
 * a saved session has one, and a worktree of it, or none for one in the
 * project's own folder. The chats come in the order of the sidebar's Chats
 * group, by when they were last opened, newest first; the saved sessions come
 * by when they were made, oldest first, as they show below their worktree or
 * their project's Local row. Those the user deleted are in
 * neither list, but are kept with their conversations.
 */
export class ChatStore {
  private readonly statements

  constructor(db: DatabaseSync) {
    this.statements = {
      chats: db.prepare(
        `SELECT ${COLUMNS}
         FROM chats WHERE project_root IS NULL AND deleted_at IS NULL
         ORDER BY opened_at DESC, created_at DESC, id`,
      ),
      savedSessions: db.prepare(
        `SELECT ${COLUMNS}
         FROM chats WHERE project_root IS NOT NULL AND deleted_at IS NULL
         ORDER BY created_at, id`,
      ),
      chat: db.prepare(`SELECT ${COLUMNS} FROM chats WHERE id = ?`),
      inFolder: db.prepare(
        `SELECT ${COLUMNS}
         FROM chats WHERE folder = ? ORDER BY opened_at DESC, created_at DESC, id`,
      ),
      deletedWithoutConversation: db.prepare(
        `SELECT ${COLUMNS}
         FROM chats WHERE deleted_at IS NOT NULL AND conversation_id IS NULL
         ORDER BY created_at, id`,
      ),
      insert: db.prepare(
        `INSERT INTO chats (id, tool_id, folder, project_root, worktree_path, conversation_id,
                            title, custom_name, has_messages, created_at, opened_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      update: db.prepare(
        `UPDATE chats
         SET conversation_id = ?, conversation_reported = ?, unreported_run_started_at = ?,
             unreported_run_messaged = ?, title = ?, custom_name = ?, has_messages = ?,
             opened_at = ?
         WHERE id = ?`,
      ),
      markDeleted: db.prepare('UPDATE chats SET deleted_at = ? WHERE id = ?'),
      delete: db.prepare('DELETE FROM chats WHERE id = ?'),
      deleteInFolder: db.prepare('DELETE FROM chats WHERE folder = ?'),
      deleteForWorktree: db.prepare('DELETE FROM chats WHERE worktree_path = ?'),
    }
  }

  /** Every chat, in the order of the sidebar's Chats group. */
  list(): ChatInfo[] {
    return (this.statements.chats.all() as unknown as ChatRow[]).map(chatFromRow)
  }

  /** Every saved session, oldest first. */
  listSavedSessions(): SavedSessionInfo[] {
    return (this.statements.savedSessions.all() as unknown as ChatRow[]).map(savedSessionFromRow)
  }

  /** The chat or saved session with this id, if any, also one the user deleted. */
  get(id: string): StoredChat | undefined {
    const row = this.statements.chat.get(id) as ChatRow | undefined
    return row ? storedFromRow(row) : undefined
  }

  /** The chats and saved sessions whose agent runs in this folder, also those the user deleted. */
  inFolder(folder: string): StoredChat[] {
    return (this.statements.inFolder.all(folder) as unknown as ChatRow[]).map(storedFromRow)
  }

  /** The chats and saved sessions the user deleted before Hoot learned their conversation's id. */
  deletedWithoutConversation(): StoredChat[] {
    return (this.statements.deletedWithoutConversation.all() as unknown as ChatRow[]).map(
      storedFromRow,
    )
  }

  /** Adds a chat or saved session; `deletedAt`, when given, is when the user deleted it. */
  insert(chat: ChatInfo, deletedAt: number | null = null): void {
    this.statements.insert.run(
      chat.id,
      chat.toolId,
      chat.folder,
      chat.projectRoot,
      chat.worktreePath,
      chat.conversationId,
      chat.title,
      chat.customName,
      chat.hasMessages ? 1 : 0,
      chat.createdAt,
      chat.lastOpenedAt,
      deletedAt,
    )
  }

  /** Changes a chat, leaving what `changes` does not name as it is; `false` without the chat. */
  update(id: string, changes: ChatChanges): boolean {
    const chat = this.get(id)
    if (!chat) return false
    const unreportedRun =
      changes.unreportedRun === undefined ? chat.unreportedRun : changes.unreportedRun
    this.statements.update.run(
      changes.conversationId === undefined ? chat.conversationId : changes.conversationId,
      (changes.conversationReported ?? chat.conversationReported) ? 1 : 0,
      unreportedRun?.startedAt ?? null,
      unreportedRun?.messaged ? 1 : 0,
      changes.title ?? chat.title,
      changes.customName === undefined ? chat.customName : changes.customName,
      (changes.hasMessages ?? chat.hasMessages) ? 1 : 0,
      changes.lastOpenedAt ?? chat.lastOpenedAt,
      id,
    )
    return true
  }

  /** Leaves a chat or saved session out of the lists from now on, keeping its row. */
  markDeleted(id: string, at: number): void {
    this.statements.markDeleted.run(at, id)
  }

  delete(id: string): void {
    this.statements.delete.run(id)
  }

  /** Deletes every chat whose agent runs in this folder, which is gone. */
  deleteInFolder(folder: string): void {
    this.statements.deleteInFolder.run(folder)
  }

  /** Deletes the saved sessions of a worktree, whose folder is gone or was deleted. */
  deleteForWorktree(worktreePath: string): number {
    return Number(this.statements.deleteForWorktree.run(worktreePath).changes)
  }
}

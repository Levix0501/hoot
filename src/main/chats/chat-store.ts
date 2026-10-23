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
}

const COLUMNS = `id, tool_id, folder, project_root, worktree_path, conversation_id, title,
                 custom_name, has_messages, created_at, opened_at`

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

function savedSessionFromRow(row: ChatRow): SavedSessionInfo {
  const chat = chatFromRow(row)
  if (chat.projectRoot === null || chat.worktreePath === null) {
    throw new Error(`The saved session ${chat.id} has no worktree.`)
  }
  return { ...chat, projectRoot: chat.projectRoot, worktreePath: chat.worktreePath }
}

/** What can change about a chat; what is left out stays as it is. */
export interface ChatChanges {
  conversationId?: string | null
  title?: string
  customName?: string | null
  hasMessages?: boolean
  lastOpenedAt?: number
}

/**
 * The chats and saved sessions, kept in the database. The chats come in the
 * order of the sidebar's Chats group, by when they were last opened, newest
 * first; the saved sessions come by when they were made or split off, oldest
 * first, as they show below their worktree.
 */
export class ChatStore {
  private readonly statements

  constructor(db: DatabaseSync) {
    this.statements = {
      chats: db.prepare(
        `SELECT ${COLUMNS}
         FROM chats WHERE worktree_path IS NULL
         ORDER BY opened_at DESC, created_at DESC, id`,
      ),
      savedSessions: db.prepare(
        `SELECT ${COLUMNS}
         FROM chats WHERE worktree_path IS NOT NULL
         ORDER BY created_at, id`,
      ),
      chat: db.prepare(`SELECT ${COLUMNS} FROM chats WHERE id = ?`),
      inFolder: db.prepare(
        `SELECT ${COLUMNS}
         FROM chats WHERE folder = ? ORDER BY opened_at DESC, created_at DESC, id`,
      ),
      insert: db.prepare(
        `INSERT INTO chats (id, tool_id, folder, project_root, worktree_path, conversation_id,
                            title, custom_name, has_messages, created_at, opened_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      update: db.prepare(
        `UPDATE chats
         SET conversation_id = ?, title = ?, custom_name = ?, has_messages = ?, opened_at = ?
         WHERE id = ?`,
      ),
      delete: db.prepare('DELETE FROM chats WHERE id = ?'),
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

  /** The chat or saved session with this id, if any. */
  get(id: string): ChatInfo | undefined {
    const row = this.statements.chat.get(id) as ChatRow | undefined
    return row ? chatFromRow(row) : undefined
  }

  /** The chats and saved sessions whose agent runs in this folder. */
  inFolder(folder: string): ChatInfo[] {
    return (this.statements.inFolder.all(folder) as unknown as ChatRow[]).map(chatFromRow)
  }

  insert(chat: ChatInfo): void {
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
    )
  }

  /** Changes a chat, leaving what `changes` does not name as it is; `false` without the chat. */
  update(id: string, changes: ChatChanges): boolean {
    const chat = this.get(id)
    if (!chat) return false
    this.statements.update.run(
      changes.conversationId === undefined ? chat.conversationId : changes.conversationId,
      changes.title ?? chat.title,
      changes.customName === undefined ? chat.customName : changes.customName,
      (changes.hasMessages ?? chat.hasMessages) ? 1 : 0,
      changes.lastOpenedAt ?? chat.lastOpenedAt,
      id,
    )
    return true
  }

  delete(id: string): void {
    this.statements.delete.run(id)
  }

  /** Deletes the saved sessions of a worktree, whose folder is gone or was deleted. */
  deleteForWorktree(worktreePath: string): number {
    return Number(this.statements.deleteForWorktree.run(worktreePath).changes)
  }
}

import type { DatabaseSync } from 'node:sqlite'
import type { ChatInfo } from '../../shared/chats'
import type { CodingToolId } from '../../shared/tools'

interface ChatRow {
  id: string
  tool_id: CodingToolId
  folder: string
  conversation_id: string | null
  title: string
  custom_name: string | null
  has_messages: number
  created_at: number
  opened_at: number
}

function chatFromRow(row: ChatRow): ChatInfo {
  return {
    id: row.id,
    toolId: row.tool_id,
    folder: row.folder,
    conversationId: row.conversation_id,
    title: row.title,
    customName: row.custom_name,
    hasMessages: row.has_messages === 1,
    createdAt: row.created_at,
    lastOpenedAt: row.opened_at,
  }
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
 * The chats, kept in the database: every chat, in the order of the sidebar's
 * Chats group, by when it was last opened, newest first.
 */
export class ChatStore {
  private readonly statements

  constructor(db: DatabaseSync) {
    this.statements = {
      chats: db.prepare(
        `SELECT id, tool_id, folder, conversation_id, title, custom_name, has_messages,
                created_at, opened_at
         FROM chats ORDER BY opened_at DESC, created_at DESC, id`,
      ),
      chat: db.prepare(
        `SELECT id, tool_id, folder, conversation_id, title, custom_name, has_messages,
                created_at, opened_at
         FROM chats WHERE id = ?`,
      ),
      inFolder: db.prepare(
        `SELECT id, tool_id, folder, conversation_id, title, custom_name, has_messages,
                created_at, opened_at
         FROM chats WHERE folder = ? ORDER BY opened_at DESC, created_at DESC, id`,
      ),
      insert: db.prepare(
        `INSERT INTO chats (id, tool_id, folder, conversation_id, title, custom_name, has_messages,
                            created_at, opened_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      update: db.prepare(
        `UPDATE chats
         SET conversation_id = ?, title = ?, custom_name = ?, has_messages = ?, opened_at = ?
         WHERE id = ?`,
      ),
      delete: db.prepare('DELETE FROM chats WHERE id = ?'),
    }
  }

  /** Every chat, in the order of the sidebar's Chats group. */
  list(): ChatInfo[] {
    return (this.statements.chats.all() as unknown as ChatRow[]).map(chatFromRow)
  }

  /** The chat with this id, if any. */
  get(id: string): ChatInfo | undefined {
    const row = this.statements.chat.get(id) as ChatRow | undefined
    return row ? chatFromRow(row) : undefined
  }

  /** The chats whose agent runs in this folder. */
  inFolder(folder: string): ChatInfo[] {
    return (this.statements.inFolder.all(folder) as unknown as ChatRow[]).map(chatFromRow)
  }

  insert(chat: ChatInfo): void {
    this.statements.insert.run(
      chat.id,
      chat.toolId,
      chat.folder,
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
}

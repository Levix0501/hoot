import { execFile } from 'node:child_process'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'
import type { Env } from '../env/env'
import { commandProgram } from '../tools/command-program'
import { findCommand } from '../tools/find-command'
import type { LoginEnvironment } from '../tools/tool-service'

const execFileAsync = promisify(execFile)

/** How long Hoot waits for an agent to list its conversations. */
const LIST_TIMEOUT_MS = 10_000

/** One conversation as the agent itself records it. */
export interface AgentConversation {
  /** The id the agent resumes it by. */
  id: string
  /** The title the agent records for it, if any. */
  title: string | null
  /** When the agent started it, in milliseconds since the Unix epoch. */
  createdAt: number
}

/**
 * What Hoot reads of an agent's own records to tell whether a chat's
 * conversation has messages, and which conversations its folder holds.
 */
export interface ChatConversations {
  /** Whether Claude Code recorded a message in this conversation in this folder. */
  claudeConversation(folder: string, conversationId: string): Promise<boolean>
  /** The conversations Codex recorded in this folder, oldest first; `null` when they cannot be read. */
  codexConversations(folder: string): Promise<AgentConversation[] | null>
  /** The conversations OpenCode recorded in this folder, oldest first; `null` when they cannot be read. */
  openCodeConversations(folder: string): Promise<AgentConversation[] | null>
}

/** Whether two folder paths name the same folder. */
function sameFolder(left: string, right: string): boolean {
  const a = path.resolve(left)
  const b = path.resolve(right)
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

/** When a timestamp the agent wrote is, in milliseconds since the Unix epoch; `NaN` when it is none. */
function milliseconds(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') return Date.parse(value)
  return Number.NaN
}

/** The most of a file's first line Hoot reads. */
const FIRST_LINE_LIMIT = 1024 * 1024

/** The first line of a file, up to `FIRST_LINE_LIMIT` bytes of it, read without reading the rest. */
async function firstLine(file: string): Promise<string> {
  const handle = await fs.open(file, 'r')
  try {
    const chunks: Buffer[] = []
    let length = 0
    while (length < FIRST_LINE_LIMIT) {
      const buffer = Buffer.alloc(64 * 1024)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, length)
      if (bytesRead === 0) break
      const read = buffer.subarray(0, bytesRead)
      const end = read.indexOf(10)
      if (end !== -1) {
        chunks.push(read.subarray(0, end))
        break
      }
      chunks.push(read)
      length += bytesRead
    }
    return Buffer.concat(chunks).toString('utf8')
  } finally {
    await handle.close()
  }
}

/** A line of JSON, parsed when it is an object. */
function objectLine(line: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * Whether a transcript entry is a message the user sent: a user message that
 * is not one Claude Code marks as its own, and is not one of its slash
 * commands, which it records as user messages too, or only a tool's result.
 * A command such as `/clear` leaves a conversation without messages.
 */
function sentMessage(record: Record<string, unknown>): boolean {
  if (record.type !== 'user' || record.isMeta === true) return false
  const message = record.message
  if (typeof message !== 'object' || message === null || Array.isArray(message)) return false
  const content = (message as { content?: unknown }).content
  if (typeof content === 'string') {
    const text = content.trim()
    return text !== '' && !text.startsWith('<command-') && !text.startsWith('<local-command-')
  }
  if (!Array.isArray(content)) return false
  let text = ''
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const { type, text: part } = block as { type?: unknown; text?: unknown }
    if (type === 'tool_result') continue
    if (type === 'text' && typeof part === 'string') {
      text += part
      continue
    }
    // An image, a document or another part of a message the user sent.
    if (type !== undefined) return true
  }
  const trimmed = text.trim()
  return (
    trimmed !== '' && !trimmed.startsWith('<command-') && !trimmed.startsWith('<local-command-')
  )
}

/** Whether Claude Code recorded a message the user sent in a transcript file. */
async function claudeConversationHasMessage(file: string): Promise<boolean> {
  const input = createReadStream(file)
  const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY })
  try {
    for await (const line of lines) {
      const record = objectLine(line)
      if (record !== null && sentMessage(record)) return true
    }
    return false
  } catch {
    return false
  } finally {
    lines.close()
    input.destroy()
  }
}

/**
 * The titles Codex recorded for its conversations, by id, as its session
 * index gives them: the last title of each wins.
 */
async function codexTitles(home: string): Promise<Map<string, string>> {
  const titles = new Map<string, string>()
  let text: string
  try {
    text = await fs.readFile(path.join(home, '.codex', 'session_index.jsonl'), 'utf8')
  } catch {
    return titles
  }
  for (const line of text.split('\n')) {
    const entry = objectLine(line)
    if (!entry || typeof entry.id !== 'string') continue
    if (typeof entry.thread_name === 'string' && entry.thread_name !== '') {
      titles.set(entry.id, entry.thread_name)
    }
  }
  return titles
}

/**
 * How long after the first line of a session file that starts with a copy of
 * the conversation it was forked from Codex may still be writing that copy,
 * in milliseconds: a message it writes later is one sent in the fork.
 */
const FORK_COPY_MS = 1000

/**
 * Whether a line of a Codex session file records a message the user sent,
 * as earlier versions of Codex name it (`user_message`) or later ones do (a
 * completed `UserMessage` item).
 */
function codexUserMessage(record: Record<string, unknown>): boolean {
  if (record.type !== 'event_msg') return false
  const payload = record.payload
  if (typeof payload !== 'object' || payload === null) return false
  const { type, item } = payload as { type?: unknown; item?: unknown }
  if (type === 'user_message') return true
  return (
    type === 'item_completed' &&
    typeof item === 'object' &&
    item !== null &&
    (item as { type?: unknown }).type === 'UserMessage'
  )
}

/**
 * Whether a Codex session file records a message sent in its conversation.
 * The file of a conversation forked from another starts with the first line
 * of the fork alone, in later versions of Codex, and in earlier ones with a
 * copy of the conversation it was forked from, the first line of each
 * conversation the copy holds after its own: a message in the copy was not
 * sent in the fork, which Codex writes in one go as it forks.
 */
async function codexMessageSent(file: string): Promise<boolean> {
  const input = createReadStream(file)
  const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY })
  try {
    let index = 0
    let startedAt = Number.NaN
    let copy = false
    for await (const line of lines) {
      const at = index
      index += 1
      if (at === 0) {
        startedAt = milliseconds(objectLine(line)?.timestamp)
        continue
      }
      if (at > 1 && !line.includes('user_message') && !line.includes('UserMessage')) continue
      const record = objectLine(line)
      if (record === null) continue
      if (at === 1 && record.type === 'session_meta') copy = true
      if (!codexUserMessage(record)) continue
      if (!copy) return true
      const writtenAt = milliseconds(record.timestamp)
      if (Number.isNaN(startedAt) || Number.isNaN(writtenAt)) return true
      if (writtenAt - startedAt > FORK_COPY_MS) return true
    }
    return false
  } finally {
    lines.close()
    input.destroy()
  }
}

/**
 * The conversations Codex recorded in a folder, from the session files it
 * writes there: each starts with the folder and id of its conversation.
 * Only those in which a message was sent are conversations here: a file of
 * one that never got a message, as Codex's shared background server leaves,
 * or of one forked from another with no message since, is none. `null` when
 * the files cannot be read.
 */
async function codexConversations(
  home: string,
  folder: string,
): Promise<AgentConversation[] | null> {
  const root = path.join(home, '.codex', 'sessions')
  let entries
  try {
    entries = await fs.readdir(root, { recursive: true, withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    return null
  }
  const found = new Map<string, number>()
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
    const file = path.join(entry.parentPath, entry.name)
    let line: string
    try {
      line = await firstLine(file)
    } catch {
      return null
    }
    const record = objectLine(line)
    if (!record || record.type !== 'session_meta') continue
    const payload = record.payload
    if (typeof payload !== 'object' || payload === null) continue
    const meta = payload as Record<string, unknown>
    const cwd = meta.cwd
    const id = typeof meta.id === 'string' ? meta.id : meta.session_id
    if (typeof cwd !== 'string' || typeof id !== 'string' || !sameFolder(cwd, folder)) continue
    try {
      if (!(await codexMessageSent(file))) continue
    } catch {
      return null
    }
    const at = milliseconds(meta.timestamp)
    const known = found.get(id)
    const createdAt = Number.isNaN(at) ? 0 : at
    if (known === undefined || createdAt < known) found.set(id, createdAt)
  }
  const titles = await codexTitles(home)
  return [...found.entries()]
    .map(([id, createdAt]) => ({ id, title: titles.get(id) ?? null, createdAt }))
    .toSorted((a, b) => a.createdAt - b.createdAt)
}

/** The conversations OpenCode recorded in a folder, as its session list gives them. */
async function openCodeConversations(
  folder: string,
  env: Env,
): Promise<AgentConversation[] | null> {
  const found = await findCommand('opencode', env)
  if (!found) return null
  let program
  try {
    program = await commandProgram(found, env)
    const { stdout } = await execFileAsync(
      program.file,
      [...program.args, 'session', 'list', '--format', 'json'],
      { cwd: folder, env, timeout: LIST_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
    )
    const value: unknown = JSON.parse(stdout)
    if (!Array.isArray(value)) return null
    const conversations: AgentConversation[] = []
    for (const entry of value) {
      if (typeof entry !== 'object' || entry === null) continue
      const session = entry as Record<string, unknown>
      if (typeof session.id !== 'string') continue
      const directory = session.directory
      if (typeof directory === 'string' && !sameFolder(directory, folder)) continue
      const createdAt = milliseconds(session.created)
      conversations.push({
        id: session.id,
        title: typeof session.title === 'string' && session.title !== '' ? session.title : null,
        createdAt: Number.isNaN(createdAt) ? 0 : createdAt,
      })
    }
    return conversations.toSorted((a, b) => a.createdAt - b.createdAt)
  } catch {
    return null
  }
}

/**
 * The agent records Hoot reads on this computer: Claude Code's transcripts,
 * Codex's session files and OpenCode's session list.
 */
export function localChatConversations(options: {
  home: string
  getLoginEnvironment(): Promise<LoginEnvironment>
}): ChatConversations {
  return {
    async claudeConversation(folder, conversationId) {
      // Claude Code names the folder of a project's transcripts after the
      // working directory, every character that is not a letter or a digit
      // turned into `-`.
      const encoded = folder.replace(/[^A-Za-z0-9]/g, '-')
      const file = path.join(
        options.home,
        '.claude',
        'projects',
        encoded,
        `${conversationId}.jsonl`,
      )
      return claudeConversationHasMessage(file)
    },
    codexConversations(folder) {
      return codexConversations(options.home, folder)
    },
    async openCodeConversations(folder) {
      return openCodeConversations(folder, (await options.getLoginEnvironment()).env)
    },
  }
}

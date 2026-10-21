import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
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

/** The first line of a file, read without reading the rest. */
async function firstLine(file: string): Promise<string | null> {
  const handle = await fs.open(file, 'r')
  try {
    const buffer = Buffer.alloc(64 * 1024)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const end = buffer.subarray(0, bytesRead).indexOf(10)
    return buffer.subarray(0, end === -1 ? bytesRead : end).toString('utf8')
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
 * The conversations Codex recorded in a folder, from the session files it
 * writes there: each starts with the folder and id of its conversation. A
 * conversation starts with its first message, so a folder without one holds
 * none. `null` when the files cannot be read.
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
    let line: string | null
    try {
      line = await firstLine(file)
    } catch {
      return null
    }
    const record = line === null ? null : objectLine(line)
    if (!record || record.type !== 'session_meta') continue
    const payload = record.payload
    if (typeof payload !== 'object' || payload === null) continue
    const meta = payload as Record<string, unknown>
    const cwd = meta.cwd
    const id = typeof meta.id === 'string' ? meta.id : meta.session_id
    if (typeof cwd !== 'string' || typeof id !== 'string' || !sameFolder(cwd, folder)) continue
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
      try {
        return (await fs.stat(file)).isFile()
      } catch {
        return false
      }
    },
    codexConversations(folder) {
      return codexConversations(options.home, folder)
    },
    async openCodeConversations(folder) {
      return openCodeConversations(folder, (await options.getLoginEnvironment()).env)
    },
  }
}

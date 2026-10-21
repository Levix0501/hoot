import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { onPath, writeNodeCommand } from '../tools/test-support'
import { localChatConversations } from './conversations'

describe('localChatConversations', () => {
  let home: string
  let folder: string

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-conversations-'))
    folder = path.join(home, '.hoot', 'chats', 'codex-one')
    fs.mkdirSync(folder, { recursive: true })
  })

  afterEach(() => fs.rmSync(home, { recursive: true, force: true }))

  const conversations = (env: Record<string, string> = {}) =>
    localChatConversations({
      home,
      getLoginEnvironment: async () => ({ env, error: null }),
    })

  /** A Codex session file for a conversation in a folder, whose first line is its metadata. */
  function rollout(id: string, cwd: string, title?: string, minute = 0): void {
    const directory = path.join(home, '.codex', 'sessions', '2026', '10', '21')
    fs.mkdirSync(directory, { recursive: true })
    const meta = {
      type: 'session_meta',
      payload: {
        id,
        session_id: id,
        cwd,
        timestamp: `2026-10-21T10:${String(minute).padStart(2, '0')}:00.000Z`,
      },
    }
    fs.writeFileSync(
      path.join(directory, `rollout-2026-10-21T10-00-00-${id}.jsonl`),
      `${JSON.stringify(meta)}\n{"type":"event_msg"}\n`,
    )
    if (title !== undefined) {
      const index = path.join(home, '.codex', 'session_index.jsonl')
      fs.appendFileSync(
        index,
        `${JSON.stringify({ id, thread_name: title, updated_at: '2026-10-21T10:00:00Z' })}\n`,
      )
    }
  }

  it('finds the Codex conversations a folder holds, with the titles Codex recorded', async () => {
    rollout('thread-one', folder, 'First work', 1)
    rollout('thread-two', folder, 'Second work', 2)
    rollout('thread-other', path.join(home, 'elsewhere'), 'Other', 3)
    expect(await conversations().codexConversations(folder)).toEqual([
      { id: 'thread-one', title: 'First work', createdAt: Date.parse('2026-10-21T10:01:00.000Z') },
      {
        id: 'thread-two',
        title: 'Second work',
        createdAt: Date.parse('2026-10-21T10:02:00.000Z'),
      },
    ])
  })

  it('gives no Codex conversations, rather than an error, when Codex wrote none', async () => {
    expect(await conversations().codexConversations(folder)).toEqual([])
  })

  it('finds a Claude Code transcript in the folder Claude Code names after the working directory', async () => {
    const id = 'b2b7c1f0-0000-4000-8000-000000000000'
    const encoded = folder.replace(/[^A-Za-z0-9]/g, '-')
    const transcripts = path.join(home, '.claude', 'projects', encoded)
    fs.mkdirSync(transcripts, { recursive: true })
    fs.writeFileSync(path.join(transcripts, `${id}.jsonl`), '{}\n')
    expect(await conversations().claudeConversation(folder, id)).toBe(true)
    expect(await conversations().claudeConversation(folder, 'another')).toBe(false)
  })

  it('reads the conversations OpenCode lists for a folder', async () => {
    const bin = path.join(home, 'bin')
    const sessions = [
      { id: 'ses_one', title: 'One', created: 1_000, directory: folder },
      { id: 'ses_two', title: '', created: 2_000, directory: folder },
      { id: 'ses_other', title: 'Other', created: 3_000, directory: path.join(home, 'else') },
    ]
    await writeNodeCommand(
      path.join(bin, 'opencode'),
      `console.log(${JSON.stringify(JSON.stringify(sessions))})`,
    )
    expect(
      await conversations({ PATH: onPath(bin, '/usr/bin') }).openCodeConversations(folder),
    ).toEqual([
      { id: 'ses_one', title: 'One', createdAt: 1_000 },
      { id: 'ses_two', title: null, createdAt: 2_000 },
    ])
  })

  it('says nothing about OpenCode when it cannot be run', async () => {
    expect(
      await conversations({ PATH: onPath('/usr/bin') }).openCodeConversations(folder),
    ).toBeNull()
  })
})

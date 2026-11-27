import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { onPath, writeNodeCommand } from '../tools/test-support'
import { localChatConversations } from './conversations'

/** A line of a Codex session file that records a message the user sent, as Codex 0.148 and later write it. */
const userMessage = (text: string, timestamp = '2026-10-21T10:00:00.000Z') =>
  JSON.stringify({
    timestamp,
    type: 'event_msg',
    payload: {
      type: 'item_completed',
      item: { type: 'UserMessage', content: [{ type: 'text', text }] },
    },
  })

/** A time on the day of the session files of these tests, at a second after 10:05. */
const at = (seconds: number) => `2026-10-21T10:05:${String(seconds).padStart(2, '0')}.000Z`

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

  /** A Codex session file for a conversation in a folder, whose first line is its metadata, with a message. */
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
      `${JSON.stringify(meta)}\n{"type":"event_msg","payload":{"type":"task_started"}}\n${userMessage('Fix it')}\n`,
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

  it('leaves out a Codex conversation whose file records no message, as one that never got one', async () => {
    rollout('thread-one', folder, 'First work', 1)
    const directory = path.join(home, '.codex', 'sessions', '2026', '10', '21')
    const meta = (id: string, extra: object = {}) =>
      JSON.stringify({
        timestamp: '2026-10-21T10:05:00.000Z',
        type: 'session_meta',
        payload: { id, cwd: folder, timestamp: '2026-10-21T10:05:00.000Z', ...extra },
      })
    const write = (name: string, lines: string[]) =>
      fs.writeFileSync(path.join(directory, name), lines.map((line) => `${line}\n`).join(''))
    // Codex's shared background server leaves the first line alone.
    write('rollout-empty.jsonl', [meta('thread-empty')])
    fs.writeFileSync(path.join(directory, 'rollout-empty-crlf.jsonl'), `${meta('thread-crlf')}\r\n`)
    // Lines that are no message, as Codex writes for a conversation forked
    // from another before a message is sent in it.
    write('rollout-fork.jsonl', [
      meta('thread-fork', { forked_from_id: 'thread-one' }),
      '{"type":"event_msg","payload":{"type":"thread_settings_applied"}}',
    ])
    // A first line longer than one read, with a message after it.
    write('rollout-long.jsonl', [
      meta('thread-long', { instructions: 'x'.repeat(200_000) }),
      userMessage('Fix it'),
    ])
    // A message as Codex before 0.148 writes it.
    write('rollout-earlier.jsonl', [
      meta('thread-earlier'),
      '{"type":"event_msg","payload":{"type":"user_message","message":"Fix it"}}',
    ])
    expect(
      (await conversations().codexConversations(folder))
        ?.map((conversation) => conversation.id)
        .toSorted(),
    ).toEqual(['thread-earlier', 'thread-long', 'thread-one'])
  })

  it('counts no message of the copy an earlier Codex makes of a conversation it forks from, only one sent since', async () => {
    const directory = path.join(home, '.codex', 'sessions', '2026', '10', '21')
    fs.mkdirSync(directory, { recursive: true })
    const meta = (id: string, timestamp: string, extra: object = {}) =>
      JSON.stringify({
        timestamp: at(0),
        type: 'session_meta',
        payload: { id, cwd: folder, timestamp, ...extra },
      })
    const copy = (id: string) => [
      meta(id, at(0), { forked_from_id: 'thread-one' }),
      meta('thread-one', '2026-10-21T10:01:00.000Z'),
      JSON.stringify({ timestamp: at(0), type: 'turn_context', payload: {} }),
      JSON.stringify({
        timestamp: at(0),
        type: 'event_msg',
        payload: { type: 'user_message', message: 'Fix it' },
      }),
    ]
    const write = (name: string, lines: string[]) =>
      fs.writeFileSync(path.join(directory, name), lines.map((line) => `${line}\n`).join(''))
    write('rollout-copy.jsonl', copy('thread-copy'))
    write('rollout-copy-then-message.jsonl', [
      ...copy('thread-copy-message'),
      JSON.stringify({
        timestamp: at(9),
        type: 'event_msg',
        payload: { type: 'user_message', message: 'And now this' },
      }),
    ])
    expect(
      (await conversations().codexConversations(folder))?.map((conversation) => conversation.id),
    ).toEqual(['thread-copy-message'])
  })

  it('gives no Codex conversations, rather than an error, when Codex wrote none', async () => {
    expect(await conversations().codexConversations(folder)).toEqual([])
  })

  it('finds a Claude Code transcript in the folder Claude Code names after the working directory', async () => {
    const id = 'b2b7c1f0-0000-4000-8000-000000000000'
    const encoded = folder.replace(/[^A-Za-z0-9]/g, '-')
    const transcripts = path.join(home, '.claude', 'projects', encoded)
    fs.mkdirSync(transcripts, { recursive: true })
    fs.writeFileSync(
      path.join(transcripts, `${id}.jsonl`),
      `${JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'Fix the login bug' },
      })}\n`,
    )
    expect(await conversations().claudeConversation(folder, id)).toBe(true)
    expect(await conversations().claudeConversation(folder, 'another')).toBe(false)
  })

  it('counts only a message the user sent, not Claude Code’s commands, metadata or tool results', async () => {
    const encoded = folder.replace(/[^A-Za-z0-9]/g, '-')
    const transcripts = path.join(home, '.claude', 'projects', encoded)
    fs.mkdirSync(transcripts, { recursive: true })
    const transcript = (id: string, records: unknown[]) =>
      fs.writeFileSync(
        path.join(transcripts, `${id}.jsonl`),
        records.map((record) => `${JSON.stringify(record)}\n`).join(''),
      )
    transcript('empty', [{ type: 'mode' }, { type: 'file-history-snapshot' }])
    transcript('command', [
      {
        type: 'user',
        isMeta: true,
        message: {
          role: 'user',
          content: '<local-command-caveat>Not a request.</local-command-caveat>',
        },
      },
      {
        type: 'user',
        message: { role: 'user', content: '<command-name>/clear</command-name>' },
      },
    ])
    transcript('tool-result', [
      {
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }],
        },
      },
    ])
    transcript('message', [
      {
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: 'Ship it' }] },
      },
    ])
    expect(await conversations().claudeConversation(folder, 'empty')).toBe(false)
    expect(await conversations().claudeConversation(folder, 'command')).toBe(false)
    expect(await conversations().claudeConversation(folder, 'tool-result')).toBe(false)
    expect(await conversations().claudeConversation(folder, 'message')).toBe(true)
  })

  it('reads the conversations OpenCode lists for a folder', async () => {
    const bin = path.join(home, 'bin')
    const sessions = [
      { id: 'ses_one', title: 'One', updated: 1_500, created: 1_000, directory: folder },
      { id: 'ses_two', title: '', updated: 2_500, created: 2_000, directory: folder },
      {
        id: 'ses_other',
        title: 'Other',
        updated: 3_500,
        created: 3_000,
        directory: path.join(home, 'else'),
      },
      // A fork no message was sent in, which OpenCode lists with the
      // messages of the conversation it was forked from.
      { id: 'ses_fork', title: 'One (fork #1)', updated: 4_000, created: 4_000, directory: folder },
      // One whose list gives no time it was changed, as an earlier one may.
      { id: 'ses_three', title: 'Three', created: 5_000, directory: folder },
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
      { id: 'ses_three', title: 'Three', createdAt: 5_000 },
    ])
  })

  it('says nothing about OpenCode when it cannot be run', async () => {
    expect(
      await conversations({ PATH: onPath('/usr/bin') }).openCodeConversations(folder),
    ).toBeNull()
  })

  /** Where Antigravity CLI keeps its records in the test's home folder. */
  const antigravity = () => path.join(home, '.gemini', 'antigravity-cli')

  /**
   * Antigravity CLI's summaries of its conversations, as 1.5.18 keeps them,
   * with the columns Hoot reads, kept open by `writer` as a running
   * Antigravity CLI keeps them, in its log, until it is closed.
   */
  function summaries(
    rows: Array<{
      id: string
      folders: string[]
      title?: string
      parent?: string
      depth?: number
      messaged?: string
    }>,
  ): DatabaseSync {
    fs.mkdirSync(antigravity(), { recursive: true })
    const writer = new DatabaseSync(path.join(antigravity(), 'conversation_summaries.db'))
    writer.exec('PRAGMA journal_mode = WAL')
    writer.exec(
      'CREATE TABLE `conversation_summaries` (`conversation_id` text, `title` text NOT NULL DEFAULT "", ' +
        '`step_count` integer NOT NULL DEFAULT 0, `workspace_uris` text NOT NULL, ' +
        '`parent_conversation_id` text NOT NULL DEFAULT "", `nesting_depth` integer NOT NULL DEFAULT 0, ' +
        '`last_user_input_time` datetime NOT NULL, PRIMARY KEY (`conversation_id`))',
    )
    const insert = writer.prepare(
      'INSERT INTO conversation_summaries (conversation_id, title, step_count, workspace_uris, ' +
        'parent_conversation_id, nesting_depth, last_user_input_time) VALUES (?, ?, 2, ?, ?, ?, ?)',
    )
    for (const row of rows) {
      insert.run(
        row.id,
        row.title ?? '',
        JSON.stringify(row.folders.map((each) => pathToFileURL(each).href)),
        row.parent ?? '',
        row.depth ?? 0,
        row.messaged ?? '2026-11-27 08:46:07.833792+00:00',
      )
    }
    return writer
  }

  /** The transcript of an Antigravity CLI conversation, whose first step is the first message. */
  function antigravityTranscript(id: string, createdAt: string): void {
    const logs = path.join(antigravity(), 'brain', id, '.system_generated', 'logs')
    fs.mkdirSync(logs, { recursive: true })
    const step = {
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      created_at: createdAt,
    }
    fs.writeFileSync(path.join(logs, 'transcript.jsonl'), `${JSON.stringify(step)}\n`)
  }

  it('finds the Antigravity CLI conversations a folder is in the workspace of, but no subagent’s', async () => {
    // As Hoot runs it: with the folder of its hooks in the workspace too.
    const hooks = path.join(home, 'Hoot Resources', 'antigravity-hooks')
    const writer = summaries([
      { id: 'main', folders: [hooks, folder], title: 'Addition of 44 and 44' },
      { id: 'earlier', folders: [hooks, folder] },
      { id: 'unknown-start', folders: [folder], title: 'Old' },
      // A subagent's, which keeps the zero time of Go for no message of the user's.
      {
        id: 'subagent',
        folders: [hooks, folder],
        parent: 'main',
        depth: 1,
        messaged: '0001-01-01 00:00:00+00:00',
      },
      { id: 'elsewhere', folders: [path.join(home, 'project')], title: 'Elsewhere' },
    ])
    antigravityTranscript('main', '2026-11-27T08:46:07Z')
    antigravityTranscript('earlier', '2026-11-27T08:40:00.250Z')
    antigravityTranscript('subagent', '2026-11-27T08:46:10Z')
    try {
      // Read while Antigravity CLI holds them, as it runs.
      expect(await conversations().antigravityConversations(folder)).toEqual([
        { id: 'unknown-start', title: 'Old', createdAt: 0 },
        { id: 'earlier', title: null, createdAt: Date.parse('2026-11-27T08:40:00.250Z') },
        // Kept to the second: the end of that second.
        {
          id: 'main',
          title: 'Addition of 44 and 44',
          createdAt: Date.parse('2026-11-27T08:46:07.999Z'),
        },
      ])
    } finally {
      writer.close()
    }
    expect(
      (await conversations().antigravityConversations(folder))?.map(
        (conversation) => conversation.id,
      ),
    ).toEqual(['unknown-start', 'earlier', 'main'])
  })

  it('gives no Antigravity CLI conversations when it keeps none, and none it cannot read', async () => {
    expect(await conversations().antigravityConversations(folder)).toEqual([])
    fs.mkdirSync(antigravity(), { recursive: true })
    fs.writeFileSync(path.join(antigravity(), 'conversation_summaries.db'), 'not a database')
    expect(await conversations().antigravityConversations(folder)).toBeNull()
  })
})

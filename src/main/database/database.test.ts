import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  databaseFile,
  migrate,
  observeTransactions,
  openDatabase,
  transaction,
  userVersion,
} from './database'
import { MIGRATIONS } from './migrations'

let directory: string
let file: string

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-database-'))
  file = databaseFile(directory)
})

afterEach(() => {
  // A test that made a folder unreadable gives it back first.
  for (const entry of [directory, path.dirname(file)]) {
    if (fs.existsSync(entry)) fs.chmodSync(entry, 0o755)
  }
  fs.rmSync(directory, { recursive: true, force: true })
})

/** The tables and indexes of a database file, with their SQL. */
function schema(at: string): Array<Record<string, unknown>> {
  const db = new DatabaseSync(at, { readOnly: true })
  try {
    return db.prepare('SELECT type, name, sql FROM sqlite_schema ORDER BY name').all()
  } finally {
    db.close()
  }
}

/** Opens the file the way a user's SQLite tool would, and runs some SQL in it. */
function withFile(at: string, sql: string): void {
  const db = new DatabaseSync(at)
  try {
    db.exec(sql)
  } finally {
    db.close()
  }
}

function versionOf(at: string): number {
  const db = new DatabaseSync(at, { readOnly: true })
  try {
    return userVersion(db)
  } finally {
    db.close()
  }
}

describe('databaseFile', () => {
  it('is hoot.db in the data folder of the user data directory', () => {
    // The user data directory of the installed Hoot, on this platform.
    const [userData, database] =
      process.platform === 'win32'
        ? [
            'C:\\Users\\me\\AppData\\Roaming\\Hoot',
            'C:\\Users\\me\\AppData\\Roaming\\Hoot\\data\\hoot.db',
          ]
        : [
            '/Users/me/Library/Application Support/Hoot',
            '/Users/me/Library/Application Support/Hoot/data/hoot.db',
          ]
    expect(databaseFile(userData)).toBe(database)
  })
})

/**
 * Windows keeps no permissions on folders that chmod could take away: it only
 * makes files read-only.
 */
const noFolderPermissions = process.platform === 'win32'

describe('openDatabase', () => {
  it('creates the data folder and the file, with the latest version of the tables', () => {
    expect(fs.existsSync(path.dirname(file))).toBe(false)
    const db = openDatabase(file)
    expect(userVersion(db)).toBe(MIGRATIONS.length)
    db.close()
    expect(fs.statSync(file).isFile()).toBe(true)
    expect(versionOf(file)).toBeGreaterThanOrEqual(1)
    const names = schema(file).map((entry) => entry.name)
    expect(names).toEqual(expect.arrayContaining(['issues', 'projects']))
  })

  it('keeps what is in the file when it is opened again', () => {
    let db = openDatabase(file)
    db.exec("INSERT INTO projects (root, list_position) VALUES ('/work/alpha', 1)")
    db.close()
    db = openDatabase(file)
    expect(db.prepare('SELECT root FROM projects').all()).toEqual([{ root: '/work/alpha' }])
    expect(userVersion(db)).toBe(MIGRATIONS.length)
    db.close()
  })

  it('applies the migrations after the recorded version, in order, and records each', () => {
    const migrations = ['CREATE TABLE one (a)', 'CREATE TABLE two (b)', 'CREATE TABLE three (c)']
    let db = openDatabase(file, migrations.slice(0, 1))
    expect(userVersion(db)).toBe(1)
    db.close()
    db = openDatabase(file, migrations)
    expect(userVersion(db)).toBe(3)
    db.close()
    expect(schema(file).map((entry) => entry.name)).toEqual(['one', 'three', 'two'])
  })

  it('refuses a file of a newer version, without changing a byte of it', () => {
    openDatabase(file).close()
    withFile(file, `PRAGMA user_version = ${MIGRATIONS.length + 1}`)
    const before = fs.readFileSync(file)
    expect(() => openDatabase(file)).toThrow(/newer version of Hoot/)
    expect(fs.readFileSync(file).equals(before)).toBe(true)
    expect(fs.readdirSync(path.dirname(file))).toEqual(['hoot.db'])
    expect(versionOf(file)).toBe(MIGRATIONS.length + 1)
  })

  it('rolls back every migration of a failed upgrade, leaving the file as it was', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    // A table with the name of one the first migration makes, but other columns.
    withFile(file, "CREATE TABLE issues (note TEXT); INSERT INTO issues VALUES ('kept')")
    const before = schema(file)
    expect(() => openDatabase(file)).toThrow(/already exists/)
    expect(versionOf(file)).toBe(0)
    expect(schema(file)).toEqual(before)
    const db = new DatabaseSync(file, { readOnly: true })
    expect(db.prepare('SELECT note FROM issues').all()).toEqual([{ note: 'kept' }])
    db.close()
  })

  it('refuses a file that is not a database, without changing a byte of it', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const content = Buffer.from('not a database'.repeat(300).slice(0, 4096))
    fs.writeFileSync(file, content)
    expect(() => openDatabase(file)).toThrow(/not a database/)
    expect(fs.readFileSync(file).equals(content)).toBe(true)
    expect(fs.readdirSync(path.dirname(file))).toEqual(['hoot.db'])
  })

  it('refuses a file it can read but not write', () => {
    openDatabase(file).close()
    const before = fs.readFileSync(file)
    fs.chmodSync(file, 0o444)
    expect(() => openDatabase(file)).toThrow(/readonly/)
    expect(fs.readFileSync(file).equals(before)).toBe(true)
  })

  it.skipIf(noFolderPermissions)('refuses a file in a folder it cannot write to', () => {
    openDatabase(file).close()
    fs.chmodSync(path.dirname(file), 0o555)
    expect(() => openDatabase(file)).toThrow(/readonly/)
  })

  it.skipIf(noFolderPermissions)(
    'refuses a file in a folder it cannot open, without changing it',
    () => {
      openDatabase(file).close()
      const before = fs.readFileSync(file)
      fs.chmodSync(path.dirname(file), 0o000)
      expect(() => openDatabase(file)).toThrow(/unable to open/)
      fs.chmodSync(path.dirname(file), 0o755)
      expect(fs.readFileSync(file).equals(before)).toBe(true)
    },
  )

  it.skipIf(noFolderPermissions)(
    'refuses a user data directory where it cannot create the data folder',
    () => {
      fs.chmodSync(directory, 0o555)
      expect(() => openDatabase(file)).toThrow(/EACCES/)
    },
  )
})

/** Inserts an issue, numbered as SQLite numbers rows, and returns its number. */
function insertIssue(
  db: DatabaseSync,
  columns: {
    projectId?: number | null
    status?: string
    priority?: number
    completedAt?: number | null
  },
): number {
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO issues (project_id, title, description, status, priority, created_at,
        completed_at) VALUES (?, 'T', '', ?, ?, 0, ?)`,
    )
    .run(
      columns.projectId ?? null,
      columns.status ?? 'backlog',
      columns.priority ?? 0,
      columns.completedAt ?? null,
    )
  return Number(lastInsertRowid)
}

describe('the tables', () => {
  it('number issues from 1, never giving a number again, also once its issue is deleted', () => {
    let db = openDatabase(file)
    db.exec("INSERT INTO projects (id, root, list_position) VALUES (1, '/work/g', 1)")
    expect(insertIssue(db, { projectId: 1 })).toBe(1)
    expect(insertIssue(db, {})).toBe(2)
    db.exec('DELETE FROM issues WHERE id = 2')
    expect(insertIssue(db, {})).toBe(3)
    db.exec('DELETE FROM issues')
    db.close()
    db = openDatabase(file)
    expect(insertIssue(db, { projectId: 1 })).toBe(4)
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    db.close()
  })

  it('refuse an issue of a project that was never added', () => {
    const db = openDatabase(file)
    expect(() => insertIssue(db, { projectId: 7 })).toThrow(/FOREIGN KEY constraint/)
    db.close()
  })

  it('refuse a status or priority Hoot does not know, and a completion time that does not fit the status', () => {
    const db = openDatabase(file)
    const insert = (status: string, priority: number, completedAt: number | null) =>
      insertIssue(db, { status, priority, completedAt })
    expect(() => insert('open', 0, null)).toThrow(/CHECK constraint/)
    expect(() => insert('todo', 5, null)).toThrow(/CHECK constraint/)
    expect(() => insert('todo', 0, 10)).toThrow(/CHECK constraint/)
    expect(() => insert('done', 0, null)).toThrow(/CHECK constraint/)
    expect(insert('done', 4, 10)).toBe(1)
    db.close()
  })
})

describe('the upgrade to sub-issues', () => {
  it('keeps what a database of the version before holds, every issue a top-level issue', () => {
    let db = openDatabase(file, MIGRATIONS.slice(0, 2))
    db.exec(`
      INSERT INTO projects (id, root, list_position) VALUES (1, '/work/gamma', 1), (2, '/work/hotel', NULL);
      INSERT INTO issues (project_id, title, description, status, priority, created_at, completed_at)
        VALUES (1, 'X', 'Desc', 'todo', 2, 100, NULL), (NULL, 'Y', '', 'done', 0, 200, 300),
          (2, 'Z', '', 'backlog', 4, 400, NULL);
      INSERT INTO workflow_records (issue_id, kind, step, outcome, reporter, summary, at)
        VALUES (1, 'step-started', 'scope', NULL, NULL, NULL, 500);
    `)
    const tables = ['projects', 'issues', 'workflow_records']
    const before = tables.map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY id`).all())
    db.close()
    db = openDatabase(file, MIGRATIONS.slice(0, 3))
    expect(userVersion(db)).toBe(3)
    expect(tables.map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY id`).all())).toEqual(
      before,
    )
    expect(db.prepare('SELECT * FROM sub_issues').all()).toEqual([])
    db.close()
  })

  it('refuses an issue as its own parent, or two parents for one issue', () => {
    const db = openDatabase(file)
    const first = insertIssue(db, {})
    const second = insertIssue(db, {})
    const link = db.prepare('INSERT INTO sub_issues (issue_id, parent_id) VALUES (?, ?)')
    expect(() => link.run(first, first)).toThrow(/CHECK constraint/)
    link.run(second, first)
    expect(() => link.run(second, first)).toThrow(/UNIQUE constraint/)
    expect(() => link.run(first, 99)).toThrow(/FOREIGN KEY constraint/)
    db.close()
  })
})

describe('the upgrade to dependencies', () => {
  it('keeps what a database of the version before holds, without any dependency', () => {
    let db = openDatabase(file, MIGRATIONS.slice(0, 3))
    db.exec(`
      INSERT INTO projects (id, root, list_position) VALUES (1, '/work/gamma', 1), (2, '/work/hotel', NULL);
      INSERT INTO issues (project_id, title, description, status, priority, created_at, completed_at)
        VALUES (1, 'X', 'Desc', 'todo', 2, 100, NULL), (NULL, 'Y', '', 'done', 0, 200, 300),
          (2, 'Z', '', 'backlog', 4, 400, NULL), (1, 'W', '', 'todo', 0, 500, NULL);
      INSERT INTO sub_issues (issue_id, parent_id) VALUES (2, 1), (4, 1), (3, 2);
      INSERT INTO workflow_records (issue_id, kind, step, outcome, reporter, summary, at)
        VALUES (1, 'step-started', 'scope', NULL, NULL, NULL, 500),
          (1, 'step-reported', 'scope', 'no-split', 'agent', 'One piece', 600);
    `)
    const tables = ['projects', 'issues', 'sub_issues', 'workflow_records']
    const before = tables.map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY id`).all())
    db.close()
    db = openDatabase(file, MIGRATIONS.slice(0, 4))
    expect(userVersion(db)).toBe(4)
    expect(tables.map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY id`).all())).toEqual(
      before,
    )
    expect(db.prepare('SELECT * FROM issue_dependencies').all()).toEqual([])
    db.close()
  })

  it('refuses an issue blocked by itself, by an issue twice, or by none, and drops the dependencies of a deleted issue', () => {
    const db = openDatabase(file)
    const [first, second, third] = [insertIssue(db, {}), insertIssue(db, {}), insertIssue(db, {})]
    const depend = db.prepare(
      'INSERT INTO issue_dependencies (issue_id, blocked_by_id) VALUES (?, ?)',
    )
    expect(() => depend.run(first, first)).toThrow(/CHECK constraint/)
    depend.run(first, second)
    expect(() => depend.run(first, second)).toThrow(/UNIQUE constraint/)
    expect(() => depend.run(first, 99)).toThrow(/FOREIGN KEY constraint/)
    depend.run(second, first)
    depend.run(third, second)
    depend.run(first, third)
    db.exec(`DELETE FROM issues WHERE id = ${second}`)
    expect(db.prepare('SELECT issue_id, blocked_by_id FROM issue_dependencies').all()).toEqual([
      { issue_id: first, blocked_by_id: third },
    ])
    db.close()
  })
})

/**
 * The columns an upgrade from before version 9 adds to a chat, as they are
 * for one whose agent reported no conversation, in no run Hoot did not see end.
 */
const REPORT_COLUMNS = {
  conversation_reported: 0,
  unreported_run_started_at: null,
}

describe('the upgrade to labels', () => {
  it('drops the records of the workflows and keeps everything else, no issue with a label', () => {
    let db = openDatabase(file, MIGRATIONS.slice(0, 4))
    db.exec(`
      INSERT INTO projects (id, root, list_position) VALUES (1, '/work/gamma', 1), (2, '/work/hotel', NULL);
      INSERT INTO issues (project_id, title, description, status, priority, created_at, completed_at)
        VALUES (1, 'E1', 'Desc', 'todo', 2, 100, NULL), (1, 'E2', '', 'done', 0, 200, 300),
          (2, 'E3', '', 'backlog', 4, 400, NULL);
      INSERT INTO sub_issues (issue_id, parent_id) VALUES (2, 1);
      INSERT INTO issue_dependencies (issue_id, blocked_by_id) VALUES (3, 1);
      INSERT INTO workflow_records (issue_id, kind, step, outcome, reporter, summary, at)
        VALUES (1, 'step-started', 'scope', NULL, NULL, NULL, 500),
          (1, 'step-reported', 'scope', 'no-split', 'agent', 'One piece', 600),
          (1, 'step-started', 'design', NULL, NULL, NULL, 600);
    `)
    const tables = ['projects', 'issues', 'sub_issues', 'issue_dependencies']
    const before = tables.map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY id`).all())
    db.close()
    db = openDatabase(file)
    expect(userVersion(db)).toBe(MIGRATIONS.length)
    expect(tables.map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY id`).all())).toEqual(
      before,
    )
    expect(
      db.prepare("SELECT name FROM sqlite_schema WHERE name LIKE 'workflow_records%'").all(),
    ).toEqual([])
    for (const table of ['label_groups', 'labels', 'issue_labels', 'label_events']) {
      expect(db.prepare(`SELECT * FROM ${table}`).all()).toEqual([])
    }
    db.close()
  })

  it('upgrades a database of the first release, at version 1, too', () => {
    let db = openDatabase(file, MIGRATIONS.slice(0, 1))
    db.exec(`
      INSERT INTO projects (id, root, list_position) VALUES (1, '/work/gamma', 1);
      INSERT INTO issues (project_id, title, description, status, priority, created_at, completed_at)
        VALUES (1, 'X', 'Desc', 'todo', 2, 100, NULL);
    `)
    db.close()
    db = openDatabase(file)
    expect(userVersion(db)).toBe(MIGRATIONS.length)
    expect(db.prepare('SELECT title FROM issues').all()).toEqual([{ title: 'X' }])
    db.close()
  })

  it('keeps the chats and saved sessions of an earlier version, none of them deleted', () => {
    let db = openDatabase(file, MIGRATIONS.slice(0, 7))
    db.exec(`
      INSERT INTO chats (id, tool_id, folder, conversation_id, title, custom_name, has_messages,
          created_at, opened_at, project_root, worktree_path)
        VALUES ('chat', 'codex', '/home/.hoot/chats/codex-1', 'thread', 'T', NULL, 1, 1, 2, NULL, NULL),
          ('saved', 'claude', '/work/wt', 'c', '', 'Mine', 1, 3, 4, '/work/project', '/work/wt');
    `)
    const before = db.prepare('SELECT * FROM chats ORDER BY id').all()
    db.close()
    db = openDatabase(file)
    expect(userVersion(db)).toBe(MIGRATIONS.length)
    expect(db.prepare('SELECT * FROM chats ORDER BY id').all()).toEqual(
      before.map((row) => ({ ...row, deleted_at: null, ...REPORT_COLUMNS })),
    )
    db.close()
  })

  it('keeps the chats of an earlier version, with no conversation an agent reported', () => {
    let db = openDatabase(file, MIGRATIONS.slice(0, 8))
    db.exec(`
      INSERT INTO chats (id, tool_id, folder, conversation_id, title, custom_name, has_messages,
          created_at, opened_at, project_root, worktree_path, deleted_at)
        VALUES ('chat', 'codex', '/home/.hoot/chats/codex-1', 'thread', 'T', NULL, 1, 1, 2, NULL,
          NULL, 5);
    `)
    const before = db.prepare('SELECT * FROM chats').all()
    db.close()
    db = openDatabase(file)
    expect(userVersion(db)).toBe(MIGRATIONS.length)
    expect(db.prepare('SELECT * FROM chats').all()).toEqual(
      before.map((row) => ({ ...row, ...REPORT_COLUMNS })),
    )
    expect(() => db.exec("UPDATE chats SET conversation_reported = 2 WHERE id = 'chat'")).toThrow(
      /CHECK constraint/,
    )
    db.close()
  })

  it('keeps the chats of the version before, with no run Hoot did not see end', () => {
    let db = openDatabase(file, MIGRATIONS.slice(0, 9))
    db.exec(`
      INSERT INTO chats (id, tool_id, folder, conversation_id, title, custom_name, has_messages,
          created_at, opened_at, project_root, worktree_path, deleted_at, conversation_reported)
        VALUES ('saved', 'codex', '/work/wt', 'thread', 'T', NULL, 1, 1, 2, '/work/project',
          '/work/wt', NULL, 1);
    `)
    const before = db.prepare('SELECT * FROM chats').all()
    db.close()
    db = openDatabase(file)
    expect(userVersion(db)).toBe(MIGRATIONS.length)
    expect(db.prepare('SELECT * FROM chats').all()).toEqual(
      before.map((row) => ({ ...row, unreported_run_started_at: null })),
    )
    db.close()
  })

  it('refuses names taken whatever their case, colors that are not hexadecimal, and an issue with a label twice', () => {
    const db = openDatabase(file)
    const issue = insertIssue(db, {})
    const label = db.prepare(
      'INSERT INTO labels (name, name_key, color, description, group_id) VALUES (?, ?, ?, ?, ?)',
    )
    label.run('Bug', 'bug', 'ff8800', '', null)
    expect(() => label.run('bug', 'bug', 'ff8800', '', null)).toThrow(/UNIQUE constraint/)
    expect(() => label.run('x', 'x', 'red', '', null)).toThrow(/CHECK constraint/)
    expect(() => label.run('y', 'y', 'FF8800', '', null)).toThrow(/CHECK constraint/)
    expect(() => label.run('z', 'z', 'ff8800', '', 99)).toThrow(/FOREIGN KEY constraint/)
    const carry = db.prepare('INSERT INTO issue_labels (issue_id, label_id) VALUES (?, ?)')
    carry.run(issue, 1)
    expect(() => carry.run(issue, 1)).toThrow(/UNIQUE constraint|PRIMARY KEY/)
    // A group deleted leaves its labels without one; a label deleted, its issues without it.
    db.exec(`
      INSERT INTO label_groups (name, name_key) VALUES ('Kind', 'kind');
      UPDATE labels SET group_id = 1;
      DELETE FROM label_groups;
    `)
    expect(db.prepare('SELECT group_id FROM labels').all()).toEqual([{ group_id: null }])
    db.exec('DELETE FROM labels')
    expect(db.prepare('SELECT * FROM issue_labels').all()).toEqual([])
    db.close()
  })
})

describe('migrate', () => {
  it('does nothing to a database at the latest version', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db, ['CREATE TABLE one (a)'])
    migrate(db, ['CREATE TABLE one (a)'])
    expect(userVersion(db)).toBe(1)
    db.close()
  })
})

describe('transaction', () => {
  it('commits what the body did, and rolls all of it back when the body throws', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE t (x)')
    expect(transaction(db, () => db.prepare('INSERT INTO t VALUES (1)').run().changes)).toBe(1)
    expect(() =>
      transaction(db, () => {
        db.exec('INSERT INTO t VALUES (2)')
        throw new Error('stop')
      }),
    ).toThrow('stop')
    expect(db.isTransaction).toBe(false)
    expect(db.prepare('SELECT x FROM t').all()).toEqual([{ x: 1 }])
    db.close()
  })

  it('runs inside another in a savepoint, whose changes alone a throw rolls back', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE t (x)')
    transaction(db, () => {
      db.exec('INSERT INTO t VALUES (1)')
      expect(() =>
        transaction(db, () => {
          db.exec('INSERT INTO t VALUES (2)')
          throw new Error('inner')
        }),
      ).toThrow('inner')
      transaction(db, () => db.exec('INSERT INTO t VALUES (3)'))
    })
    expect(db.prepare('SELECT x FROM t').all()).toEqual([{ x: 1 }, { x: 3 }])
    expect(() =>
      transaction(db, () => {
        transaction(db, () => db.exec('INSERT INTO t VALUES (4)'))
        throw new Error('outer')
      }),
    ).toThrow('outer')
    expect(db.prepare('SELECT x FROM t').all()).toEqual([{ x: 1 }, { x: 3 }])
    db.close()
  })

  it('tells its observers, once for the outermost, before its changes, before it commits and once it ended', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE t (x)')
    const told: string[] = []
    const stop = observeTransactions(db, {
      begin: () => told.push('begin'),
      beforeCommit: () => {
        told.push('before commit')
        db.exec('INSERT INTO t VALUES (9)')
      },
      end: (committed) => told.push(committed ? 'committed' : 'rolled back'),
    })
    transaction(db, () => transaction(db, () => db.exec('INSERT INTO t VALUES (1)')))
    expect(() =>
      transaction(db, () => {
        throw new Error('stop')
      }),
    ).toThrow('stop')
    expect(told).toEqual(['begin', 'before commit', 'committed', 'begin', 'rolled back'])
    expect(db.prepare('SELECT x FROM t').all()).toEqual([{ x: 1 }, { x: 9 }])
    stop()
    transaction(db, () => db.exec('INSERT INTO t VALUES (2)'))
    expect(told).toHaveLength(5)
    db.close()
  })
})

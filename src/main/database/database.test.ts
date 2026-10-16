import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { databaseFile, migrate, openDatabase, transaction, userVersion } from './database'
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
    expect(databaseFile('/Users/me/Library/Application Support/Hoot')).toBe(
      '/Users/me/Library/Application Support/Hoot/data/hoot.db',
    )
  })
})

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

  it('refuses a file in a folder it cannot write to', () => {
    openDatabase(file).close()
    fs.chmodSync(path.dirname(file), 0o555)
    expect(() => openDatabase(file)).toThrow(/readonly/)
  })

  it('refuses a file in a folder it cannot open, without changing it', () => {
    openDatabase(file).close()
    const before = fs.readFileSync(file)
    fs.chmodSync(path.dirname(file), 0o000)
    expect(() => openDatabase(file)).toThrow(/unable to open/)
    fs.chmodSync(path.dirname(file), 0o755)
    expect(fs.readFileSync(file).equals(before)).toBe(true)
  })

  it('refuses a user data directory where it cannot create the data folder', () => {
    fs.chmodSync(directory, 0o555)
    expect(() => openDatabase(file)).toThrow(/EACCES/)
  })
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
    db = openDatabase(file)
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
})

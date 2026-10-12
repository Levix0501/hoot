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

  it('refuses a file of a newer version, leaving it as it was', () => {
    openDatabase(file).close()
    withFile(file, `PRAGMA user_version = ${MIGRATIONS.length + 1}`)
    const before = schema(file)
    expect(() => openDatabase(file)).toThrow(/newer version of Hoot/)
    expect(versionOf(file)).toBe(MIGRATIONS.length + 1)
    expect(schema(file)).toEqual(before)
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

describe('migration 2', () => {
  it('makes open issues to do and closed ones done, numbered in each project in the order they were created', () => {
    const v1 = openDatabase(file, MIGRATIONS.slice(0, 1))
    v1.exec(`
      INSERT INTO projects (id, root, list_position) VALUES (1, '/work/g', 1), (2, '/work/h', NULL);
      INSERT INTO issues (id, project_id, title, description, state, created_at, closed_at) VALUES
        (1, 1, 'G open', 'Body', 'open', 100, NULL),
        (2, 2, 'H closed', '', 'closed', 200, 250),
        (3, 1, 'G deleted', '', 'open', 300, NULL),
        (4, 1, 'G closed then reopened', '', 'open', 400, 450),
        (5, 1, 'G closed', '', 'closed', 500, 550);
      DELETE FROM issues WHERE id = 3;
    `)
    v1.close()

    const db = openDatabase(file)
    expect(userVersion(db)).toBe(2)
    expect(db.prepare('SELECT * FROM issues ORDER BY id').all()).toEqual([
      {
        id: 1,
        project_id: 1,
        number: 1,
        title: 'G open',
        description: 'Body',
        status: 'todo',
        priority: 0,
        created_at: 100,
        completed_at: null,
      },
      {
        id: 2,
        project_id: 2,
        number: 1,
        title: 'H closed',
        description: '',
        status: 'done',
        priority: 0,
        created_at: 200,
        completed_at: 250,
      },
      {
        id: 4,
        project_id: 1,
        number: 2,
        title: 'G closed then reopened',
        description: '',
        status: 'todo',
        priority: 0,
        created_at: 400,
        completed_at: null,
      },
      {
        id: 5,
        project_id: 1,
        number: 3,
        title: 'G closed',
        description: '',
        status: 'done',
        priority: 0,
        created_at: 500,
        completed_at: 550,
      },
    ])
    expect(db.prepare('SELECT id, next_issue_number FROM projects ORDER BY id').all()).toEqual([
      { id: 1, next_issue_number: 4 },
      { id: 2, next_issue_number: 2 },
    ])
    // The ids of issues deleted before are not given again.
    db.exec(`INSERT INTO issues (project_id, number, title, description, status, priority,
      created_at) VALUES (1, 4, 'New', '', 'backlog', 0, 600)`)
    expect(db.prepare("SELECT id FROM issues WHERE title = 'New'").get()).toEqual({ id: 6 })
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    db.close()
  })

  it('refuses a status or priority Hoot does not know, and a completion time that does not fit the status', () => {
    const db = openDatabase(file)
    db.exec("INSERT INTO projects (id, root, list_position) VALUES (1, '/work/g', 1)")
    let number = 0
    const insert = (status: string, priority: number, completedAt: number | null) =>
      db
        .prepare(
          `INSERT INTO issues (project_id, number, title, description, status, priority,
            created_at, completed_at) VALUES (1, ?, 'T', '', ?, ?, 0, ?)`,
        )
        .run(++number, status, priority, completedAt)
    expect(() => insert('open', 0, null)).toThrow(/CHECK constraint/)
    expect(() => insert('todo', 5, null)).toThrow(/CHECK constraint/)
    expect(() => insert('todo', 0, 10)).toThrow(/CHECK constraint/)
    expect(() => insert('done', 0, null)).toThrow(/CHECK constraint/)
    expect(insert('done', 4, 10).changes).toBe(1)
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

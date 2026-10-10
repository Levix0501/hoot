import { DatabaseSync } from 'node:sqlite'
import { databaseFile, openDatabase } from '../../src/main/database/database'
import { IssueStore } from '../../src/main/issues/issue-store'
import { ProjectStore } from '../../src/main/projects/project-store'

export { databaseFile }

/** A row of the projects table, as Hoot keeps it. */
export interface StoredProject {
  id: number
  root: string
  list_position: number | null
}

/** A row of the issues table, as Hoot keeps it. */
export interface StoredIssue {
  id: number
  project_id: number
  title: string
  description: string
  state: string
  created_at: number
  closed_at: number | null
}

/** An issue to have in a project before Hoot starts. */
export interface SeedIssue {
  /** The root of its project, which is in the list. */
  root: string
  title: string
  description?: string
  closed?: boolean
}

/**
 * Puts projects in the list, and issues in them, before Hoot starts, as if
 * they had been added and created in it: with Hoot's own code, so that the
 * database is the one it makes. The issues are created a second apart, in
 * the order given, the last a second ago; a closed one is closed right after
 * it is created.
 */
export function addProjectsBeforeLaunch(
  userData: string,
  roots: readonly string[],
  issues: readonly SeedIssue[] = [],
): void {
  const db = openDatabase(databaseFile(userData))
  try {
    const projects = new ProjectStore(db)
    for (const root of roots) projects.add(root)
    let time = Date.now() - issues.length * 1_000
    const store = new IssueStore(db, () => time)
    for (const issue of issues) {
      const project = projects.find(issue.root)
      if (!project) throw new Error(`${issue.root} is not in the list`)
      const created = store.create({
        projectId: project.id,
        title: issue.title,
        description: issue.description ?? '',
      })
      if (issue.closed) store.setState(created!.id, 'closed')
      time += 1_000
    }
  } finally {
    db.close()
  }
}

/**
 * Reads a database file the way a SQLite tool does, opened read-only, while
 * Hoot runs or after it has quit.
 */
export function readDatabase<T>(file: string, read: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(file, { readOnly: true, timeout: 5_000 })
  try {
    return read(db)
  } finally {
    db.close()
  }
}

/** Runs SQL in a database file, as a user would with a SQLite tool. */
export function changeDatabase(file: string, sql: string): void {
  const db = new DatabaseSync(file, { timeout: 5_000 })
  try {
    db.exec(sql)
  } finally {
    db.close()
  }
}

export function userVersionOf(file: string): number {
  return readDatabase(file, (db) => Number(db.prepare('PRAGMA user_version').get()?.user_version))
}

/** The projects table of a user data directory's database, by id. */
export function storedProjects(userData: string): StoredProject[] {
  return readDatabase(databaseFile(userData), (db) =>
    db
      .prepare('SELECT id, root, list_position FROM projects ORDER BY id')
      .all()
      .map((row) => ({ ...row }) as unknown as StoredProject),
  )
}

/** The issues table of a user data directory's database, by id. */
export function storedIssues(userData: string): StoredIssue[] {
  return readDatabase(databaseFile(userData), (db) =>
    db
      .prepare(
        'SELECT id, project_id, title, description, state, created_at, closed_at FROM issues ORDER BY id',
      )
      .all()
      .map((row) => ({ ...row }) as unknown as StoredIssue),
  )
}

/** Every table and index of a database file, with their SQL, and every row of every table. */
export function databaseContents(file: string): {
  userVersion: number
  schema: Array<Record<string, unknown>>
  rows: Record<string, Array<Record<string, unknown>>>
} {
  return readDatabase(file, (db) => {
    const schema = db
      .prepare('SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name')
      .all()
      .map((row) => ({ ...row }))
    const rows: Record<string, Array<Record<string, unknown>>> = {}
    for (const { name } of schema.filter((entry) => entry.type === 'table')) {
      const table = String(name).replaceAll('"', '""')
      rows[String(name)] = db
        .prepare(`SELECT * FROM "${table}" ORDER BY rowid`)
        .all()
        .map((row) => ({ ...row }))
    }
    return {
      userVersion: Number(db.prepare('PRAGMA user_version').get()?.user_version),
      schema,
      rows,
    }
  })
}

/** The columns of a table, and which of them refer to which column of another table. */
export function tableShape(
  file: string,
  table: string,
): { columns: string[]; references: Array<{ from: string; table: string; to: string }> } {
  return readDatabase(file, (db) => ({
    columns: db
      .prepare('SELECT name FROM pragma_table_info(?) ORDER BY cid')
      .all(table)
      .map((row) => String(row.name)),
    references: db
      .prepare('SELECT "from", "table", "to" FROM pragma_foreign_key_list(?)')
      .all(table)
      .map((row) => ({ from: String(row.from), table: String(row.table), to: String(row.to) })),
  }))
}

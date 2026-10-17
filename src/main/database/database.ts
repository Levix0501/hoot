import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS } from './migrations'

/**
 * How long a statement waits for another connection, such as a tool reading
 * the file, to release it.
 */
const BUSY_TIMEOUT_MS = 5_000

/** Where Hoot keeps its database in a user data directory. */
export function databaseFile(userData: string): string {
  return path.join(userData, 'data', 'hoot.db')
}

/**
 * Opens the database, creating the file and its directory when they do not
 * exist, and brings its tables up to the latest version. Throws when the file
 * cannot be used: when it is not a database, cannot be created, read or
 * written, is of a newer version than the latest in `migrations`, or cannot
 * be brought up to it. The file is then left as it was: the changes of a
 * failed upgrade are rolled back together.
 */
export function openDatabase(
  file: string,
  migrations: readonly string[] = MIGRATIONS,
): DatabaseSync {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file, { timeout: BUSY_TIMEOUT_MS })
  try {
    migrate(db, migrations)
    expectWritable(db)
  } catch (error) {
    db.close()
    throw error
  }
  return db
}

/** The version of the database's tables: how many migrations it has had. */
export function userVersion(db: DatabaseSync): number {
  return Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0)
}

/**
 * Applies, in order and in one transaction, the migrations after the
 * database's version, and records the new version.
 */
export function migrate(db: DatabaseSync, migrations: readonly string[]): void {
  const version = userVersion(db)
  if (version > migrations.length) {
    throw new Error(
      `The database is at version ${version}, and this version of Hoot knows versions up to ` +
        `${migrations.length}. A newer version of Hoot may have written it.`,
    )
  }
  if (version === migrations.length) return
  transaction(db, () => {
    for (let index = version; index < migrations.length; index++) {
      db.exec(migrations[index]!)
      db.exec(`PRAGMA user_version = ${index + 1}`)
    }
  })
}

/**
 * What runs with every write transaction of a database: before its changes,
 * after them and before it commits, which may change more, and once it has
 * committed or been rolled back.
 */
export interface TransactionObserver {
  begin(): void
  beforeCommit(): void
  end(committed: boolean): void
}

const observers = new WeakMap<DatabaseSync, TransactionObserver[]>()

/** Runs `observer` with every write transaction of `db` from now on, until the returned function stops it. */
export function observeTransactions(db: DatabaseSync, observer: TransactionObserver): () => void {
  observers.set(db, [...(observers.get(db) ?? []), observer])
  return () =>
    observers.set(
      db,
      (observers.get(db) ?? []).filter((entry) => entry !== observer),
    )
}

/** How deep the transactions run inside others are, which names their savepoints. */
let savepoints = 0

/**
 * Runs `body` in a write transaction, which is rolled back when it throws.
 * Inside another transaction, it runs in a savepoint of that one instead,
 * whose changes alone are rolled back when it throws, and which commits with
 * that one.
 */
export function transaction<T>(db: DatabaseSync, body: () => T): T {
  if (db.isTransaction) {
    const name = `nested_${++savepoints}`
    db.exec(`SAVEPOINT ${name}`)
    try {
      const result = body()
      db.exec(`RELEASE ${name}`)
      return result
    } catch (error) {
      db.exec(`ROLLBACK TO ${name}`)
      db.exec(`RELEASE ${name}`)
      throw error
    } finally {
      savepoints--
    }
  }
  const watching = observers.get(db) ?? []
  db.exec('BEGIN IMMEDIATE')
  let result: T
  try {
    for (const observer of watching) observer.begin()
    result = body()
    for (const observer of watching) observer.beforeCommit()
    db.exec('COMMIT')
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK')
    ended(watching, false)
    throw error
  }
  ended(watching, true)
  return result
}

/** Tells the observers that a transaction has ended; one that fails leaves the others to be told. */
function ended(watching: readonly TransactionObserver[], committed: boolean): void {
  for (const observer of watching) {
    try {
      observer.end(committed)
    } catch (error) {
      console.error('An observer of a transaction failed once it ended:', error)
    }
  }
}

/**
 * Throws when the database can be read but not written, as when its file or
 * directory is read-only: SQLite then opens it read-only without saying so.
 * Writes the version the database has, and rolls that back.
 */
function expectWritable(db: DatabaseSync): void {
  const version = userVersion(db)
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(`PRAGMA user_version = ${version}`)
  } finally {
    if (db.isTransaction) db.exec('ROLLBACK')
  }
}

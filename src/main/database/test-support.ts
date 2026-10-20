import type { DatabaseSync } from 'node:sqlite'
import { openDatabase } from './database'

/**
 * Opens a test's database the way Hoot opens its own, then keeps its writes
 * from waiting on the disk: the rollback journal stays in memory and nothing
 * is synced. A test's database need not outlive a crash, and on the Windows
 * runners of CI each synced write is slow enough that a test that writes a
 * few hundred times ran out of its time.
 */
export function openTestDatabase(file: string): DatabaseSync {
  const db = openDatabase(file)
  db.exec('PRAGMA journal_mode = MEMORY')
  db.exec('PRAGMA synchronous = OFF')
  return db
}

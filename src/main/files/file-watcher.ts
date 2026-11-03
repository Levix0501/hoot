import { EventEmitter } from 'node:events'
import { unwatchFile, watchFile, type Stats } from 'node:fs'
import { entryLocation } from './folder-files'

/** How often a watched entry is looked at, in milliseconds. */
const LOOK_INTERVAL_MS = 1_000

interface Watch {
  location: string
  listener: (current: Stats, previous: Stats) => void
}

/**
 * Follows the entries of one folder the file panel has open: its open files
 * and its expanded folders, whose entries change when one is added, removed
 * or renamed. `changed` reports an entry, by its path from the folder, once
 * it changed, appeared or went away, however that happened: by an agent in a
 * session, or outside Hoot.
 *
 * Each entry is looked at once a second with `fs.watchFile`, which polls the
 * entry's status and keeps no handle on it open: on Windows an open handle
 * would keep a worktree's folder from being renamed or deleted.
 */
export class FileWatcher extends EventEmitter<{ changed: [folder: string, entry: string] }> {
  private folder: string | null = null
  private readonly watches = new Map<string, Watch>()

  constructor(private readonly intervalMs = LOOK_INTERVAL_MS) {
    super()
  }

  /**
   * Follows `entries` of `folder`, in place of what was followed before, or
   * nothing for a `folder` of `null`.
   */
  watch(folder: string | null, entries: readonly string[]): void {
    if (folder !== this.folder) {
      this.unwatchAll()
      this.folder = folder
    }
    if (folder === null) return
    const wanted = new Set(entries)
    for (const [entry, watch] of this.watches) {
      if (wanted.has(entry)) continue
      unwatchFile(watch.location, watch.listener)
      this.watches.delete(entry)
    }
    for (const entry of wanted) {
      if (this.watches.has(entry)) continue
      const location = entryLocation(folder, entry)
      if (location === null) continue
      const listener = (current: Stats, previous: Stats) => {
        // Also called when the entry was only read.
        if (
          current.mtimeMs === previous.mtimeMs &&
          current.size === previous.size &&
          current.ino === previous.ino
        ) {
          return
        }
        this.emit('changed', folder, entry)
      }
      // It never keeps Hoot running by itself.
      watchFile(location, { interval: this.intervalMs, persistent: false }, listener)
      this.watches.set(entry, { location, listener })
    }
  }

  /** Stops following anything, as Hoot quits. */
  dispose(): void {
    this.unwatchAll()
    this.folder = null
  }

  private unwatchAll(): void {
    for (const watch of this.watches.values()) unwatchFile(watch.location, watch.listener)
    this.watches.clear()
  }
}

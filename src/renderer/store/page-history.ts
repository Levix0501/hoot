/**
 * The sessions the window has shown, one after another, for going back and
 * forward between them the way a browser does between pages. It lasts until
 * Hoot quits.
 */
export interface SessionHistory {
  /** Session ids, in the order they were shown. */
  readonly entries: readonly string[]
  /** Where the current entry is in `entries`; -1 when there is none. */
  readonly index: number
}

export const emptyHistory: SessionHistory = { entries: [], index: -1 }

/**
 * Records that the window shows a session other than by going back or
 * forward: the entries after the current one go (all of them when there is no
 * current entry), and the session is added as the new current entry unless
 * the current entry is that session already.
 */
export function visit(history: SessionHistory, id: string): SessionHistory {
  const kept = history.entries.slice(0, history.index + 1)
  if (kept.at(-1) === id) return { entries: kept, index: kept.length - 1 }
  return { entries: [...kept, id], index: kept.length }
}

/**
 * Removes the entries of sessions that closed. When the current entry goes,
 * the one before it becomes current (or none, without one before it). Entries
 * of the same session that end up next to each other become one.
 */
export function forget(history: SessionHistory, closed: ReadonlySet<string>): SessionHistory {
  const entries: string[] = []
  let index = -1
  history.entries.forEach((id, position) => {
    if (!closed.has(id) && entries.at(-1) !== id) entries.push(id)
    if (position === history.index) index = entries.length - 1
  })
  return { entries, index }
}

/**
 * The history after going back (`-1`) or forward (`1`) one entry, or `null`
 * when there is no entry that way.
 */
export function step(history: SessionHistory, offset: -1 | 1): SessionHistory | null {
  if (history.index === -1) return null
  const index = history.index + offset
  return index >= 0 && index < history.entries.length ? { ...history, index } : null
}

export function canStep(history: SessionHistory, offset: -1 | 1): boolean {
  return step(history, offset) !== null
}

/** The session of the current entry. */
export function currentEntry(history: SessionHistory): string | null {
  return history.entries[history.index] ?? null
}

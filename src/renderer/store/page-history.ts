/**
 * What the main area shows: a session, or one of a project's Issues pages
 * (its issue list, its new issue page, or one issue).
 */
export type Page =
  | { kind: 'session'; sessionId: string }
  | { kind: 'issue-list'; projectId: number }
  | { kind: 'new-issue'; projectId: number }
  | { kind: 'issue'; projectId: number; issueId: number }

/** One of a project's Issues pages. */
export type IssuesPage = Exclude<Page, { kind: 'session' }>

export function sessionPage(sessionId: string): Page {
  return { kind: 'session', sessionId }
}

export function isIssuesPage(page: Page | null): page is IssuesPage {
  return page !== null && page.kind !== 'session'
}

/** Whether two pages are the same page. */
export function samePage(a: Page | null, b: Page | null): boolean {
  if (a === null || b === null) return a === b
  switch (a.kind) {
    case 'session':
      return b.kind === 'session' && b.sessionId === a.sessionId
    case 'issue-list':
    case 'new-issue':
      return b.kind === a.kind && b.projectId === a.projectId
    case 'issue':
      return b.kind === 'issue' && b.issueId === a.issueId
  }
}

/**
 * The pages the window has shown, one after another, for going back and
 * forward between them the way a browser does. It lasts until Hoot quits.
 */
export interface PageHistory {
  /** The pages, in the order they were shown. */
  readonly entries: readonly Page[]
  /** Where the current entry is in `entries`; -1 when there is none. */
  readonly index: number
}

export const emptyHistory: PageHistory = { entries: [], index: -1 }

/**
 * Records that the window shows a page other than by going back or forward:
 * the entries after the current one go (all of them when there is no current
 * entry), and the page is added as the new current entry unless the current
 * entry is that page already.
 */
export function visit(history: PageHistory, page: Page): PageHistory {
  const kept = history.entries.slice(0, history.index + 1)
  if (samePage(kept.at(-1) ?? null, page)) return { entries: kept, index: kept.length - 1 }
  return { entries: [...kept, page], index: kept.length }
}

/**
 * Removes the entries of pages that are gone, such as a closed session's.
 * When the current entry goes, the one before it becomes current (or none,
 * without one before it). Entries of the same page that end up next to each
 * other become one.
 */
export function forget(history: PageHistory, gone: (page: Page) => boolean): PageHistory {
  const entries: Page[] = []
  let index = -1
  history.entries.forEach((page, position) => {
    if (!gone(page) && !samePage(entries.at(-1) ?? null, page)) entries.push(page)
    if (position === history.index) index = entries.length - 1
  })
  return { entries, index }
}

/**
 * The history after going back (`-1`) or forward (`1`) one entry, or `null`
 * when there is no entry that way.
 */
export function step(history: PageHistory, offset: -1 | 1): PageHistory | null {
  if (history.index === -1) return null
  const index = history.index + offset
  return index >= 0 && index < history.entries.length ? { ...history, index } : null
}

export function canStep(history: PageHistory, offset: -1 | 1): boolean {
  return step(history, offset) !== null
}

/** The page of the current entry. */
export function currentEntry(history: PageHistory): Page | null {
  return history.entries[history.index] ?? null
}

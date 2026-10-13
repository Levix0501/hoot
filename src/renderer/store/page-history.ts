/**
 * What the window shows: in its main area a session or an Issues page (the
 * issue list, whatever projects its filter shows, or one issue), or in place
 * of the sidebar and the main area the settings.
 */
export type Page =
  | { kind: 'session'; sessionId: string }
  | { kind: 'issue-list' }
  | { kind: 'issue'; issueId: number }
  | { kind: 'settings' }

/** One of the Issues pages: the issue list, or an issue's page. */
export type IssuesPage = Extract<Page, { kind: 'issue-list' | 'issue' }>

export function sessionPage(sessionId: string): Page {
  return { kind: 'session', sessionId }
}

/** The issue list, one page whichever projects its filter shows. */
export const issueListPage: Page = { kind: 'issue-list' }

export function issuePage(issueId: number): Page {
  return { kind: 'issue', issueId }
}

export const settingsPage: Page = { kind: 'settings' }

export function isIssuesPage(page: Page | null): page is IssuesPage {
  return page?.kind === 'issue-list' || page?.kind === 'issue'
}

export function isSettingsPage(page: Page | null): boolean {
  return page?.kind === 'settings'
}

/** Whether two pages are the same page. */
export function samePage(a: Page | null, b: Page | null): boolean {
  if (a === null || b === null) return a === b
  switch (a.kind) {
    case 'session':
      return b.kind === 'session' && b.sessionId === a.sessionId
    case 'issue-list':
      return b.kind === 'issue-list'
    case 'issue':
      return b.kind === 'issue' && b.issueId === a.issueId
    case 'settings':
      return b.kind === 'settings'
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

import { describe, expect, it } from 'vitest'
import {
  canStep,
  currentEntry,
  emptyHistory,
  forget,
  isIssuesPage,
  isSettingsPage,
  samePage,
  sessionPage,
  settingsPage,
  step,
  visit,
  type Page,
  type PageHistory,
} from './page-history'

/** Session pages by session id, the Issues pages of projects 1 and 2, and the settings. */
const page = {
  s1: sessionPage('s1'),
  s2: sessionPage('s2'),
  s3: sessionPage('s3'),
  list1: { kind: 'issue-list', projectId: 1 },
  issue10: { kind: 'issue', projectId: 1, issueId: 10 },
  issue11: { kind: 'issue', projectId: 1, issueId: 11 },
  list2: { kind: 'issue-list', projectId: 2 },
  issue20: { kind: 'issue', projectId: 2, issueId: 20 },
  settings: settingsPage,
} satisfies Record<string, Page>

type Name = keyof typeof page

const history = (names: Name[], index: number): PageHistory => ({
  entries: names.map((name) => page[name]),
  index,
})

const sessions = (...ids: string[]) => {
  const closed = new Set(ids)
  return (gone: Page) => gone.kind === 'session' && closed.has(gone.sessionId)
}

const ofProject2 = (gone: Page) => isIssuesPage(gone) && gone.projectId === 2

/** Steps back or forward, failing when there is no entry that way. */
function go(from: PageHistory, offset: -1 | 1): PageHistory {
  const to = step(from, offset)
  if (!to) throw new Error(`cannot step ${offset} from ${JSON.stringify(from)}`)
  return to
}

describe('samePage', () => {
  it('compares pages by what they show', () => {
    expect(samePage(page.s1, sessionPage('s1'))).toBe(true)
    expect(samePage(page.s1, page.s2)).toBe(false)
    expect(samePage(page.list1, { kind: 'issue-list', projectId: 1 })).toBe(true)
    expect(samePage(page.list1, page.issue10)).toBe(false)
    expect(samePage(page.list1, page.list2)).toBe(false)
    expect(samePage(page.issue10, { kind: 'issue', projectId: 1, issueId: 10 })).toBe(true)
    expect(samePage(page.issue10, page.issue11)).toBe(false)
    expect(samePage(null, null)).toBe(true)
    expect(samePage(page.s1, null)).toBe(false)
    expect([page.s1, page.list1, page.issue10].map(isIssuesPage)).toEqual([false, true, true])
  })

  it('takes the settings for one page, which is neither a session nor an Issues page', () => {
    expect(samePage(page.settings, { kind: 'settings' })).toBe(true)
    expect(
      [page.s1, page.list1, page.issue10].map((other) => samePage(page.settings, other)),
    ).toEqual([false, false, false])
    expect(samePage(page.s1, page.settings)).toBe(false)
    expect(isIssuesPage(page.settings)).toBe(false)
    expect([page.settings, page.s1, page.list1, null].map(isSettingsPage)).toEqual([
      true,
      false,
      false,
      false,
    ])
  })
})

describe('visit', () => {
  it('adds each newly shown page as the current entry', () => {
    let shown = visit(emptyHistory, page.s1)
    shown = visit(shown, page.list1)
    shown = visit(shown, page.issue10)
    expect(shown).toEqual(history(['s1', 'list1', 'issue10'], 2))
  })

  it('drops the entries after the current one', () => {
    expect(visit(history(['s1', 's2', 's3'], 1), page.s1)).toEqual(history(['s1', 's2', 's1'], 2))
    expect(visit(history(['s1', 'list1', 'issue10'], 0), page.issue10)).toEqual(
      history(['s1', 'issue10'], 1),
    )
  })

  it('adds nothing when the current entry is the page already', () => {
    expect(visit(history(['s1', 'list1', 's3'], 1), { kind: 'issue-list', projectId: 1 })).toEqual(
      history(['s1', 'list1'], 1),
    )
  })

  it('starts over when there is no current entry', () => {
    expect(visit(history(['s2'], -1), page.list2)).toEqual(history(['list2'], 0))
  })
})

describe('step', () => {
  it('moves the current entry back and forward without changing the entries', () => {
    const shown = history(['s1', 'list1', 'issue10'], 2)
    expect(step(shown, -1)).toEqual(history(['s1', 'list1', 'issue10'], 1))
    expect(step(go(shown, -1), 1)).toEqual(shown)
    expect(currentEntry(go(go(shown, -1), -1))).toEqual(page.s1)
  })

  it('does nothing past either end, or without a current entry', () => {
    expect(step(history(['s1', 's2'], 0), -1)).toBeNull()
    expect(step(history(['s1', 's2'], 1), 1)).toBeNull()
    expect(step(emptyHistory, -1)).toBeNull()
    expect(step(history(['s1'], -1), 1)).toBeNull()
    expect(canStep(history(['s1', 's2'], 0), 1)).toBe(true)
    expect(canStep(history(['s1', 's2'], 0), -1)).toBe(false)
    expect(currentEntry(emptyHistory)).toBeNull()
  })
})

describe('forget', () => {
  it('removes the entries of pages that are gone, keeping the current one', () => {
    expect(forget(history(['s1', 's3', 's2'], 0), sessions('s2'))).toEqual(history(['s1', 's3'], 0))
    expect(forget(history(['s2', 's1', 's2', 's3'], 3), sessions('s2'))).toEqual(
      history(['s1', 's3'], 1),
    )
  })

  it('makes the entry before a removed current entry current, or none', () => {
    expect(forget(history(['s1', 's3'], 1), sessions('s3'))).toEqual(history(['s1'], 0))
    expect(forget(history(['s1', 's2', 's3'], 0), sessions('s1'))).toEqual(
      history(['s2', 's3'], -1),
    )
    expect(forget(history(['s1'], 0), sessions('s1'))).toEqual(emptyHistory)
  })

  it('merges entries of the same page that end up next to each other', () => {
    expect(forget(history(['s1', 's2', 's1', 's3'], 2), sessions('s2'))).toEqual(
      history(['s1', 's3'], 0),
    )
    expect(forget(history(['s1', 's2', 's1', 's2', 's1'], 4), sessions('s2'))).toEqual(
      history(['s1'], 0),
    )
    expect(forget(history(['s3', 's1', 's2', 's1'], 1), sessions('s2'))).toEqual(
      history(['s3', 's1'], 1),
    )
  })

  it('removes the pages of a project, merging what ends up next to each other', () => {
    expect(forget(history(['s1', 'list2', 'issue20'], 2), ofProject2)).toEqual(history(['s1'], 0))
    expect(forget(history(['list1', 'list2', 'list1', 'issue20'], 2), ofProject2)).toEqual(
      history(['list1'], 0),
    )
  })
})

describe('the settings among the pages', () => {
  it('are recorded as any page shown, once while they are shown', () => {
    let shown = visit(visit(emptyHistory, page.s1), page.settings)
    expect(shown).toEqual(history(['s1', 'settings'], 1))
    expect(visit(shown, page.settings)).toEqual(shown)
    // Back to s1, then the settings again: the way forward is dropped as for any page.
    shown = visit(visit(go(shown, -1), page.list1), page.settings)
    expect(shown).toEqual(history(['s1', 'list1', 'settings'], 2))
    expect(currentEntry(go(shown, -1))).toEqual(page.list1)
    expect(currentEntry(go(go(shown, -1), 1))).toEqual(page.settings)
  })

  it('stay when other pages are gone, which leaves nothing before them', () => {
    const shown = forget(history(['s1', 'list2', 'settings', 's2'], 2), (gone) =>
      gone.kind === 'session' ? gone.sessionId === 's1' : ofProject2(gone),
    )
    expect(shown).toEqual(history(['settings', 's2'], 0))
    expect(canStep(shown, -1)).toBe(false)
  })

  it('leave no way forward once they are forgotten without a page before them', () => {
    const shown = forget(history(['settings', 's2', 'settings'], 0), isSettingsPage)
    expect(shown).toEqual(history(['s2'], -1))
    expect([canStep(shown, -1), canStep(shown, 1), currentEntry(shown)]).toEqual([
      false,
      false,
      null,
    ])
    expect(forget(history(['settings'], 0), isSettingsPage)).toEqual(emptyHistory)
  })
})

describe('going back and forward among pages', () => {
  it('follows the sessions shown, closed and shown again', () => {
    // Three sessions, each shown as it starts.
    let shown = visit(visit(visit(emptyHistory, page.s1), page.s2), page.s3)
    expect([canStep(shown, -1), canStep(shown, 1)]).toEqual([true, false])
    // Back twice, then forward twice.
    shown = go(go(shown, -1), -1)
    expect(currentEntry(shown)).toEqual(page.s1)
    expect(step(shown, -1)).toBeNull()
    shown = go(go(shown, 1), 1)
    expect(currentEntry(shown)).toEqual(page.s3)
    // Back to s2, then s1 is shown from the sidebar: the way forward is gone.
    shown = visit(go(shown, -1), page.s1)
    expect(canStep(shown, 1)).toBe(false)
    shown = go(go(shown, -1), -1)
    expect([currentEntry(shown), shown.entries]).toEqual([page.s1, [page.s1, page.s2, page.s1]])
    // ⌘3 shows s3, then ⌘⇧[ the session before it in the sidebar.
    shown = visit(visit(shown, page.s3), page.s2)
    expect(currentEntry(go(shown, -1))).toEqual(page.s3)
    shown = go(go(shown, -1), -1)
    expect(currentEntry(shown)).toEqual(page.s1)
    // s2 closes while s1 is shown.
    shown = forget(shown, sessions('s2'))
    expect(shown).toEqual(history(['s1', 's3'], 0))
    // s3 closes while it is shown; Hoot then shows s1.
    shown = visit(forget(go(shown, 1), sessions('s3')), page.s1)
    expect(shown).toEqual(history(['s1'], 0))
    expect([canStep(shown, -1), canStep(shown, 1)]).toEqual([false, false])
  })

  it('leaves the list once when the issue shown between two visits of it is deleted', () => {
    let shown = visit(visit(visit(visit(emptyHistory, page.list1), page.issue11), page.list1), {
      kind: 'issue',
      projectId: 1,
      issueId: 11,
    })
    shown = forget(shown, (gone) => gone.kind === 'issue' && gone.issueId === 11)
    shown = visit(shown, page.list1)
    expect(shown).toEqual(history(['list1'], 0))
    expect([canStep(shown, -1), canStep(shown, 1)]).toEqual([false, false])
  })
})

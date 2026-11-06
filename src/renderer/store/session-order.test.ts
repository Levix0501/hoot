import { describe, expect, it } from 'vitest'
import {
  CHAT_TABS,
  currentAfterClosing,
  inTabOrder,
  relativeSession,
  sidebarOrder,
  tabKey,
  tabStrip,
  withoutTabs,
} from './session-order'

const project = (root: string) => ({ id: root.charCodeAt(1), root, name: root.slice(1) })

describe('sidebarOrder', () => {
  it('groups sessions by project in list order, then by start order', () => {
    const sessions = [
      { id: 'h1', projectRoot: '/H', worktreePath: null },
      { id: 'g1', projectRoot: '/G', worktreePath: null },
      { id: 'h2', projectRoot: '/H', worktreePath: null },
      { id: 'g2', projectRoot: '/G', worktreePath: null },
    ]
    expect(
      sidebarOrder([project('/G'), project('/H')], sessions).map((session) => session.id),
    ).toEqual(['g1', 'g2', 'h1', 'h2'])
    expect(
      sidebarOrder([project('/H'), project('/G')], sessions).map((session) => session.id),
    ).toEqual(['h1', 'h2', 'g1', 'g2'])
  })
})

describe('sidebarOrder with worktrees', () => {
  it('puts the sessions of the main worktree first, then those of each worktree in row order', () => {
    const sessions = [
      { id: 's1', projectRoot: '/G', worktreePath: null },
      { id: 's2', projectRoot: '/G', worktreePath: null },
      { id: 's3', projectRoot: '/G', worktreePath: '/W/G/b-tree' },
      { id: 's4', projectRoot: '/G', worktreePath: '/W/G/a-tree' },
      { id: 's5', projectRoot: '/O', worktreePath: null },
      { id: 's6', projectRoot: '/G', worktreePath: '/W/G/a-tree' },
    ]
    const rows: Record<string, string[]> = { '/G': ['/W/G/a-tree', '/W/G/b-tree'] }
    expect(
      sidebarOrder([project('/G'), project('/O')], sessions, (root) => rows[root] ?? []).map(
        (session) => session.id,
      ),
    ).toEqual(['s1', 's2', 's4', 's6', 's3', 's5'])
  })

  it('keeps sessions of a worktree without a row with their project', () => {
    const sessions = [
      { id: 'w1', projectRoot: '/G', worktreePath: '/W/G/gone' },
      { id: 'm1', projectRoot: '/G', worktreePath: null },
      { id: 'h1', projectRoot: '/H', worktreePath: null },
    ]
    expect(
      sidebarOrder([project('/G'), project('/H')], sessions).map((session) => session.id),
    ).toEqual(['m1', 'w1', 'h1'])
  })
})

describe('currentAfterClosing', () => {
  // Two rows of tabs, `a` and `b`, in switch order.
  const order = [
    { id: 'a1', strip: 'a' },
    { id: 'a2', strip: 'a' },
    { id: 'a3', strip: 'a' },
    { id: 'b1', strip: 'b' },
  ]
  const after = (current: string, closing: readonly string[]) =>
    currentAfterClosing(order, current, new Set(closing), (session) => session.strip)

  it('keeps the current session when another one closes', () => {
    expect(after('a1', ['a2'])).toBe('a1')
    expect(currentAfterClosing(order, null, new Set(['a1']), (session) => session.strip)).toBeNull()
  })

  it('moves to the next tab of its row, or to the previous one after the last', () => {
    expect(after('a2', ['a2'])).toBe('a3')
    expect(after('a3', ['a3'])).toBe('a2')
  })

  it('moves to the next tab of its row past those that close too, before leaving the row', () => {
    expect(after('a1', ['a1', 'a2'])).toBe('a3')
    expect(after('a3', ['a2', 'a3'])).toBe('a1')
  })

  it('moves to another row once its own has no tab left: the next session, else the previous one', () => {
    expect(after('a1', ['a1', 'a2', 'a3'])).toBe('b1')
    expect(after('b1', ['b1'])).toBe('a3')
    expect(after('b1', ['a3', 'b1'])).toBe('a2')
  })

  it('shows none once every session closes', () => {
    expect(after('a1', ['a1', 'a2', 'a3', 'b1'])).toBeNull()
  })
})

describe('relativeSession', () => {
  const order = ['s1', 's2', 's3']

  it('moves forward and back, wrapping around at the ends', () => {
    expect(relativeSession(order, 's1', 1)).toBe('s2')
    expect(relativeSession(order, 's3', 1)).toBe('s1')
    expect(relativeSession(order, 's1', -1)).toBe('s3')
    expect(relativeSession(order, 's2', -1)).toBe('s1')
    expect(relativeSession(['s1'], 's1', 1)).toBe('s1')
  })

  it('does nothing without sessions', () => {
    expect(relativeSession([], null, 1)).toBeNull()
    expect(relativeSession([], null, -1)).toBeNull()
  })
})

describe('tabStrip', () => {
  it("is the root of a session's worktree, its project's for the project's own folder, and the chats' for a chat", () => {
    expect(tabStrip({ projectRoot: '/G', worktreePath: '/W/G/a-tree', chatId: null })).toBe(
      '/W/G/a-tree',
    )
    expect(tabStrip({ projectRoot: '/G', worktreePath: null, chatId: null })).toBe('/G')
    expect(tabStrip({ projectRoot: '/C/c1', worktreePath: null, chatId: 'c1' })).toBe(CHAT_TABS)
  })
})

describe('tabKey', () => {
  it("is a saved session's or a chat's id for its session, and a session's own id otherwise", () => {
    expect(tabKey({ id: 's1', savedSessionId: 'v1', chatId: null })).toBe('v1')
    expect(tabKey({ id: 's2', savedSessionId: null, chatId: 'c1' })).toBe('c1')
    expect(tabKey({ id: 's3', savedSessionId: null, chatId: null })).toBe('s3')
  })
})

describe('withoutTabs', () => {
  it('drops the closed tabs from the orders, and the orders left empty', () => {
    const orders = { '/G': ['a', 'b', 'c'], [CHAT_TABS]: ['c1'] }
    expect(withoutTabs(orders, new Set(['b', 'c1']))).toEqual({ '/G': ['a', 'c'] })
  })

  it('gives back the same orders when they have none of the closed tabs', () => {
    const orders = { '/G': ['a', 'b'] }
    expect(withoutTabs(orders, new Set(['z']))).toBe(orders)
    expect(withoutTabs(orders, new Set())).toBe(orders)
  })
})

describe('inTabOrder', () => {
  const tabs = [
    { key: 'a', createdAt: 1 },
    { key: 'c', createdAt: 3 },
    { key: 'b', createdAt: 2 },
    { key: 'd', createdAt: 4 },
  ]
  const keys = (order: readonly string[]) =>
    inTabOrder(tabs, (tab) => tab.key, order).map((tab) => tab.key)

  it('puts the tabs in the order they were made when none was dragged', () => {
    expect(keys([])).toEqual(['a', 'b', 'c', 'd'])
  })

  it('puts the tabs in the order given, and the others after them in the order they were made', () => {
    expect(keys(['c', 'a'])).toEqual(['c', 'a', 'b', 'd'])
    expect(keys(['gone', 'd', 'b', 'c', 'a'])).toEqual(['d', 'b', 'c', 'a'])
  })
})

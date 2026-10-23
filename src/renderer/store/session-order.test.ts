import { describe, expect, it } from 'vitest'
import {
  currentAfterClosing,
  orderedChatSessions,
  relativeSession,
  sessionsInSwitchOrder,
  sidebarOrder,
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
  const order = ['s1', 's2', 's3']

  it('keeps the current session when another one closes', () => {
    expect(currentAfterClosing(order, 's1', new Set(['s2']))).toBe('s1')
  })

  it('moves to the next session, or to the previous one after the last', () => {
    expect(currentAfterClosing(order, 's2', new Set(['s2']))).toBe('s3')
    expect(currentAfterClosing(order, 's3', new Set(['s3']))).toBe('s2')
    expect(currentAfterClosing(['s1'], 's1', new Set(['s1']))).toBeNull()
  })

  it('skips sessions that close at the same time', () => {
    expect(currentAfterClosing(['s0', 's1', 's2', 's3'], 's1', new Set(['s1', 's2']))).toBe('s3')
    expect(currentAfterClosing(['s0', 's1', 's2'], 's1', new Set(['s1', 's2']))).toBe('s0')
    expect(currentAfterClosing(order, 's1', new Set(order))).toBeNull()
  })
})

describe('sessionsInSwitchOrder', () => {
  it('leaves out a saved session that is not running, and keeps the others', () => {
    const sessions = [
      { id: 'plain-ended', savedSessionId: null },
      { id: 'saved-running', savedSessionId: 'a' },
      { id: 'saved-ended', savedSessionId: 'b' },
    ]
    const running = (session: (typeof sessions)[number]) => session.id === 'saved-running'
    expect(sessionsInSwitchOrder(sessions, running).map((session) => session.id)).toEqual([
      'plain-ended',
      'saved-running',
    ])
  })
})

describe('orderedChatSessions', () => {
  it('puts the running chats in the order of the Chats group, and a closing one at its place', () => {
    const chats = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }]
    const sessions = [
      { id: 's1', chatId: 'c3' },
      { id: 's2', chatId: 'c1' },
      { id: 's3', chatId: 'c2' },
    ]
    expect(
      orderedChatSessions(chats, sessions, (session) => session.id !== 's3').map(
        (session) => session.id,
      ),
    ).toEqual(['s2', 's1'])
    expect(
      orderedChatSessions(chats, sessions, () => false, new Set(['s3'])).map(
        (session) => session.id,
      ),
    ).toEqual(['s3'])
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

import { describe, expect, it } from 'vitest'
import { currentAfterClosing, relativeSession, sidebarOrder } from './session-order'

const project = (root: string) => ({ root, name: root.slice(1) })

describe('sidebarOrder', () => {
  it('groups sessions by project in list order, then by start order', () => {
    const sessions = [
      { id: 'h1', projectRoot: '/H' },
      { id: 'g1', projectRoot: '/G' },
      { id: 'h2', projectRoot: '/H' },
      { id: 'g2', projectRoot: '/G' },
    ]
    expect(
      sidebarOrder([project('/G'), project('/H')], sessions).map((session) => session.id),
    ).toEqual(['g1', 'g2', 'h1', 'h2'])
    expect(
      sidebarOrder([project('/H'), project('/G')], sessions).map((session) => session.id),
    ).toEqual(['h1', 'h2', 'g1', 'g2'])
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

import { describe, expect, it } from 'vitest'
import {
  canStep,
  currentEntry,
  emptyHistory,
  forget,
  step,
  visit,
  type SessionHistory,
} from './session-history'

const history = (entries: string[], index: number): SessionHistory => ({ entries, index })

/** Steps back or forward, failing when there is no entry that way. */
function go(from: SessionHistory, offset: -1 | 1): SessionHistory {
  const to = step(from, offset)
  if (!to) throw new Error(`cannot step ${offset} from ${JSON.stringify(from)}`)
  return to
}

describe('visit', () => {
  it('adds each newly shown session as the current entry', () => {
    let shown = visit(emptyHistory, 's1')
    shown = visit(shown, 's2')
    shown = visit(shown, 's3')
    expect(shown).toEqual(history(['s1', 's2', 's3'], 2))
  })

  it('drops the entries after the current one', () => {
    expect(visit(history(['s1', 's2', 's3'], 1), 's1')).toEqual(history(['s1', 's2', 's1'], 2))
    expect(visit(history(['s1', 's2', 's3'], 0), 's3')).toEqual(history(['s1', 's3'], 1))
  })

  it('adds nothing when the current entry is the session already', () => {
    expect(visit(history(['s1', 's2', 's3'], 1), 's2')).toEqual(history(['s1', 's2'], 1))
  })

  it('starts over when there is no current entry', () => {
    expect(visit(history(['s2'], -1), 's3')).toEqual(history(['s3'], 0))
  })
})

describe('step', () => {
  it('moves the current entry back and forward without changing the entries', () => {
    const shown = history(['s1', 's2', 's3'], 2)
    expect(step(shown, -1)).toEqual(history(['s1', 's2', 's3'], 1))
    expect(step(go(shown, -1), 1)).toEqual(shown)
    expect(currentEntry(go(go(shown, -1), -1))).toBe('s1')
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
  it('removes the entries of closed sessions, keeping the current one', () => {
    expect(forget(history(['s1', 's3', 's2'], 0), new Set(['s2']))).toEqual(
      history(['s1', 's3'], 0),
    )
    expect(forget(history(['s2', 's1', 's2', 's3'], 3), new Set(['s2']))).toEqual(
      history(['s1', 's3'], 1),
    )
  })

  it('makes the entry before a removed current entry current, or none', () => {
    expect(forget(history(['s1', 's3'], 1), new Set(['s3']))).toEqual(history(['s1'], 0))
    expect(forget(history(['s1', 's2', 's3'], 0), new Set(['s1']))).toEqual(
      history(['s2', 's3'], -1),
    )
    expect(forget(history(['s1'], 0), new Set(['s1']))).toEqual(emptyHistory)
  })

  it('merges entries of the same session that end up next to each other', () => {
    expect(forget(history(['s1', 's2', 's1', 's3'], 2), new Set(['s2']))).toEqual(
      history(['s1', 's3'], 0),
    )
    expect(forget(history(['s1', 's2', 's1', 's2', 's1'], 4), new Set(['s2']))).toEqual(
      history(['s1'], 0),
    )
    expect(forget(history(['s3', 's1', 's2', 's1'], 1), new Set(['s2']))).toEqual(
      history(['s3', 's1'], 1),
    )
  })
})

describe('going back and forward among sessions', () => {
  it('follows the sessions shown, closed and shown again', () => {
    // Three sessions, each shown as it starts.
    let shown = visit(visit(visit(emptyHistory, 's1'), 's2'), 's3')
    expect([canStep(shown, -1), canStep(shown, 1)]).toEqual([true, false])
    // Back twice, then forward twice.
    shown = go(go(shown, -1), -1)
    expect(currentEntry(shown)).toBe('s1')
    expect(step(shown, -1)).toBeNull()
    shown = go(go(shown, 1), 1)
    expect(currentEntry(shown)).toBe('s3')
    // Back to s2, then s1 is shown from the sidebar: the way forward is gone.
    shown = visit(go(shown, -1), 's1')
    expect(canStep(shown, 1)).toBe(false)
    shown = go(go(shown, -1), -1)
    expect([currentEntry(shown), shown.entries]).toEqual(['s1', ['s1', 's2', 's1']])
    // ⌘3 shows s3, then ⌘⇧[ the session before it in the sidebar.
    shown = visit(visit(shown, 's3'), 's2')
    expect(currentEntry(go(shown, -1))).toBe('s3')
    shown = go(go(shown, -1), -1)
    expect(currentEntry(shown)).toBe('s1')
    // s2 closes while s1 is shown.
    shown = forget(shown, new Set(['s2']))
    expect(shown).toEqual(history(['s1', 's3'], 0))
    // s3 closes while it is shown; Hoot then shows s1.
    shown = visit(forget(go(shown, 1), new Set(['s3'])), 's1')
    expect(shown).toEqual(history(['s1'], 0))
    expect([canStep(shown, -1), canStep(shown, 1)]).toEqual([false, false])
  })
})

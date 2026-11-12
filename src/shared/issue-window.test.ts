import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ISSUE_WINDOW_POSITION,
  issueWindowPositionOf,
  issueWindowPositionWithin,
} from './issue-window'

describe('issueWindowPositionOf', () => {
  it('keeps a box at the bottom right to the bottom right corner', () => {
    expect(
      issueWindowPositionOf({ left: 1260, top: 852, right: 1384, bottom: 884 }, 1400, 900),
    ).toEqual({ side: 'right', x: 16, edge: 'bottom', y: 16 })
  })

  it('keeps a box at the top left to the top left corner', () => {
    expect(
      issueWindowPositionOf({ left: 380, top: 180, right: 720, bottom: 660 }, 1400, 900),
    ).toEqual({ side: 'left', x: 380, edge: 'top', y: 180 })
  })

  it('goes by the center of the box, in whole pixels', () => {
    expect(
      issueWindowPositionOf({ left: 650.4, top: 100.6, right: 900.4, bottom: 140.6 }, 1400, 900),
    ).toEqual({ side: 'right', x: 500, edge: 'top', y: 101 })
  })

  it('never gives a distance below zero, for a box past an edge', () => {
    expect(
      issueWindowPositionOf({ left: 1300, top: 880, right: 1420, bottom: 920 }, 1400, 900),
    ).toEqual({ side: 'right', x: 0, edge: 'bottom', y: 0 })
  })
})

describe('issueWindowPositionWithin', () => {
  it('takes a position as it was saved', () => {
    expect(issueWindowPositionWithin({ side: 'left', x: 40, edge: 'top', y: 60 })).toEqual({
      side: 'left',
      x: 40,
      edge: 'top',
      y: 60,
    })
  })

  it('rounds the distances', () => {
    expect(issueWindowPositionWithin({ side: 'right', x: 15.6, edge: 'bottom', y: 0.2 })).toEqual({
      side: 'right',
      x: 16,
      edge: 'bottom',
      y: 0,
    })
  })

  it.each([
    undefined,
    null,
    'bottom right',
    {},
    { side: 'middle', x: 16, edge: 'bottom', y: 16 },
    { side: 'right', x: 16, edge: 'center', y: 16 },
    { side: 'right', x: -1, edge: 'bottom', y: 16 },
    { side: 'right', x: 16, edge: 'bottom', y: Number.NaN },
    { side: 'right', x: '16', edge: 'bottom', y: 16 },
    { side: 'right', x: 1e9, edge: 'bottom', y: 16 },
  ])('gives the default for %j', (value) => {
    expect(issueWindowPositionWithin(value)).toEqual(DEFAULT_ISSUE_WINDOW_POSITION)
  })
})

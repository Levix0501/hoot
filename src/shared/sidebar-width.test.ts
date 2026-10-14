import { describe, expect, it } from 'vitest'
import { SIDEBAR_WIDTH, draggedSidebarWidth, sidebarWidthWithin } from './sidebar-width'

describe('sidebarWidthWithin', () => {
  it('keeps a width within the limits, in whole pixels', () => {
    expect(sidebarWidthWithin(300)).toBe(300)
    expect(sidebarWidthWithin(300.4)).toBe(300)
    expect(sidebarWidthWithin(300.6)).toBe(301)
  })

  it('brings a width within 240 to 520', () => {
    expect(sidebarWidthWithin(100)).toBe(240)
    expect(sidebarWidthWithin(-5)).toBe(240)
    expect(sidebarWidthWithin(900)).toBe(520)
  })

  it('leaves the main area 240 pixels of a narrow window, but never goes below 240', () => {
    expect(sidebarWidthWithin(520, 720)).toBe(480)
    expect(sidebarWidthWithin(300, 720)).toBe(300)
    expect(sidebarWidthWithin(520, 1200)).toBe(520)
    expect(sidebarWidthWithin(300, 400)).toBe(240)
  })

  it('takes the default width for a value that is not a number', () => {
    for (const value of [undefined, null, '300', Number.NaN, Infinity, -Infinity, {}]) {
      expect(sidebarWidthWithin(value)).toBe(SIDEBAR_WIDTH.default)
    }
  })
})

describe('draggedSidebarWidth', () => {
  it('moves the edge as far as the pointer moves', () => {
    expect(draggedSidebarWidth(275, 275, 325, 1200)).toBe(325)
    expect(draggedSidebarWidth(275, 270, 250, 1200)).toBe(255)
  })

  it('stops at the limits', () => {
    expect(draggedSidebarWidth(275, 275, 200, 1200)).toBe(240)
    expect(draggedSidebarWidth(275, 275, 700, 1200)).toBe(520)
    expect(draggedSidebarWidth(275, 275, 700, 720)).toBe(480)
  })

  it('collapses the sidebar narrower than 120, half its narrowest width, and not at 120', () => {
    expect(draggedSidebarWidth(275, 275, 119, 1200)).toBeNull()
    expect(draggedSidebarWidth(275, 275, -40, 1200)).toBeNull()
    expect(draggedSidebarWidth(275, 275, 120, 1200)).toBe(240)
  })
})

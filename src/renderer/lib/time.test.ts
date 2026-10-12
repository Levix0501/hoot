import { describe, expect, it } from 'vitest'
import { dateTime, shortDate, timeAgo } from './time'

const now = new Date(2026, 9, 10, 22, 42, 30).getTime()
const ago = (milliseconds: number) => timeAgo(now - milliseconds, now)

describe('timeAgo', () => {
  it('says how long ago, in the largest whole unit', () => {
    expect(ago(0)).toBe('just now')
    expect(ago(59_999)).toBe('just now')
    expect(ago(60_000)).toBe('1 minute ago')
    expect(ago(5 * 60_000 + 59_000)).toBe('5 minutes ago')
    expect(ago(60 * 60_000)).toBe('1 hour ago')
    expect(ago(23 * 60 * 60_000)).toBe('23 hours ago')
    expect(ago(24 * 60 * 60_000)).toBe('1 day ago')
    expect(ago(29 * 24 * 60 * 60_000)).toBe('29 days ago')
  })

  it('gives the date after a month, and treats a moment after now as now', () => {
    expect(timeAgo(new Date(2026, 6, 4, 9).getTime(), now)).toBe('on Jul 4, 2026')
    expect(timeAgo(now + 5_000, now)).toBe('just now')
  })
})

describe('dateTime', () => {
  it('gives the date and the time of day on the 24-hour clock, in plain characters', () => {
    expect(dateTime(now)).toBe('Oct 10, 2026, 22:42')
    expect(dateTime(new Date(2026, 0, 2, 9, 5).getTime())).toBe('Jan 2, 2026, 09:05')
  })
})

describe('shortDate', () => {
  it('gives the month and day in the year of now, and the year as well in another', () => {
    expect(shortDate(new Date(2026, 0, 2, 9).getTime(), now)).toBe('Jan 2')
    expect(shortDate(now, now)).toBe('Oct 10')
    expect(shortDate(new Date(2025, 11, 31, 23).getTime(), now)).toBe('Dec 31, 2025')
  })
})

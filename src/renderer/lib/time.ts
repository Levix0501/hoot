const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const dateFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' })
const dateTimeFormat = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  hourCycle: 'h23',
})

function count(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? '' : 's'} ago`
}

/**
 * How long before `now` a moment was, the way GitHub says it: "just now",
 * "5 minutes ago", "3 hours ago", "2 days ago", or the date after a month.
 */
export function timeAgo(time: number, now: number): string {
  const elapsed = Math.max(0, now - time)
  if (elapsed < MINUTE) return 'just now'
  if (elapsed < HOUR) return count(Math.floor(elapsed / MINUTE), 'minute')
  if (elapsed < DAY) return count(Math.floor(elapsed / HOUR), 'hour')
  if (elapsed < 30 * DAY) return count(Math.floor(elapsed / DAY), 'day')
  return `on ${dateFormat.format(time)}`
}

/** A moment's date and time of day, in the 24-hour clock: "Oct 10, 2026, 22:42". */
export function dateTime(time: number): string {
  return dateTimeFormat.format(time)
}

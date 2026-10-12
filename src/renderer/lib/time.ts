const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const dateFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' })
const monthDayFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const dateTimeFormat = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  hourCycle: 'h23',
})
/** "5 minutes ago", and "1 day ago" rather than "yesterday". */
const relativeTimeFormat = new Intl.RelativeTimeFormat('en-US', { numeric: 'always' })

/**
 * How long before `now` a moment was, the way GitHub says it: "just now",
 * "5 minutes ago", "3 hours ago", "2 days ago", or the date after a month.
 */
export function timeAgo(time: number, now: number): string {
  const elapsed = Math.max(0, now - time)
  if (elapsed < MINUTE) return 'just now'
  if (elapsed < HOUR) return relativeTimeFormat.format(-Math.floor(elapsed / MINUTE), 'minute')
  if (elapsed < DAY) return relativeTimeFormat.format(-Math.floor(elapsed / HOUR), 'hour')
  if (elapsed < 30 * DAY) return relativeTimeFormat.format(-Math.floor(elapsed / DAY), 'day')
  return `on ${dateFormat.format(time)}`
}

/** A moment's date and time of day, in the 24-hour clock: "Oct 10, 2026, 22:42". */
export function dateTime(time: number): string {
  return dateTimeFormat.format(time)
}

/** A moment's date, the way Linear's lists give it: "Oct 12" in the year of `now`, "Oct 12, 2025" in another. */
export function shortDate(time: number, now: number): string {
  return new Date(time).getFullYear() === new Date(now).getFullYear()
    ? monthDayFormat.format(time)
    : dateFormat.format(time)
}

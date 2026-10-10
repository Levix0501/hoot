import { useEffect, useState } from 'react'
import { dateTime, timeAgo } from '../../lib/time'

/** The time now, updated every half minute so that what was "just now" ages. */
export function useNow(): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

/** When something happened, said as how long ago, with its date and time on hover. */
export function RelativeTime({
  time,
  now,
  ...props
}: { time: number; now: number } & React.ComponentProps<'time'>) {
  return (
    <time dateTime={new Date(time).toISOString()} title={dateTime(time)} {...props}>
      {timeAgo(time, now)}
    </time>
  )
}

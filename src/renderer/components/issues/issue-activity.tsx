import { CircleCheckIcon, CirclePlusIcon, CircleXIcon } from 'lucide-react'
import type { Issue } from '../../../shared/issues'
import { activityEntries, type ActivityEntry } from '../../lib/issue-activity'
import { cn } from '../../lib/utils'
import { labelEventsOf, useAppStore } from '../../store/app-store'
import { LabelDot } from './labels'
import { RelativeTime, useNow } from './relative-time'

/** One entry of the activity: an icon, what happened, and when. */
function Entry({ entry, now }: { entry: ActivityEntry; now: number }) {
  const time = <RelativeTime time={entry.at} now={now} />
  switch (entry.kind) {
    case 'created':
      return (
        <li className="flex items-center gap-2">
          <CirclePlusIcon className="size-3.5 shrink-0" />
          <span>
            Created the issue ·{' '}
            <RelativeTime time={entry.at} now={now} data-testid="issue-created" />
          </span>
        </li>
      )
    case 'completed':
      return (
        <li className="flex items-center gap-2" data-testid="issue-completed">
          {entry.status === 'done' ? (
            <CircleCheckIcon className="size-3.5 shrink-0" />
          ) : (
            <CircleXIcon className="size-3.5 shrink-0" />
          )}
          <span>
            {entry.status === 'done' ? 'Completed the issue' : 'Canceled the issue'} · {time}
          </span>
        </li>
      )
    case 'label': {
      const { event } = entry
      return (
        <li
          className="flex items-center gap-2"
          data-testid="issue-label-entry"
          data-kind={event.kind}
          data-label={event.label}
          data-actor={event.actor}
        >
          <span className="flex size-3.5 shrink-0 items-center justify-center">
            <LabelDot color={event.color} />
          </span>
          <span className="min-w-0">
            {event.kind === 'added' ? 'Added label' : 'Removed label'}{' '}
            <span className="text-foreground">{event.label}</span> ·{' '}
            {event.actor === 'user' ? 'by you' : 'by agent'} · {time}
          </span>
        </li>
      )
    }
  }
}

/**
 * What happened to an issue that Hoot knows of, in the order it happened:
 * when it was created; each label it was given or had taken off, by you or
 * by an agent, as the label was written then; and when it was done or
 * canceled, if it is.
 */
export function IssueActivity({ issue, className }: { issue: Issue; className?: string }) {
  const now = useNow()
  const events = useAppStore((state) => labelEventsOf(state, issue.id))
  const entries = activityEntries(issue, events)
  return (
    <section className={cn('border-t pt-5', className)} data-testid="issue-activity">
      <h2 className="mb-3 text-sm font-medium">Activity</h2>
      <ol className="grid gap-2.5 text-xs text-muted-foreground">
        {entries.map((entry) => (
          <Entry
            key={entry.kind === 'label' ? `label-${entry.event.id}` : entry.kind}
            entry={entry}
            now={now}
          />
        ))}
      </ol>
    </section>
  )
}

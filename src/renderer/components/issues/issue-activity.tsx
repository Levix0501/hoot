import {
  CircleArrowRightIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CirclePlusIcon,
  CircleXIcon,
  RotateCcwIcon,
} from 'lucide-react'
import { ISSUE_WORKFLOW } from '../../../shared/built-in-workflow'
import type { Issue } from '../../../shared/issues'
import { activityEntries, type ActivityEntry } from '../../lib/issue-workflow'
import { cn } from '../../lib/utils'
import { issueRecordsOf, useAppStore } from '../../store/app-store'
import { RelativeTime, useNow } from './relative-time'
import { StepSummary } from './step-summary'

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
    case 'reported':
      return (
        <li className="grid gap-2" data-testid="issue-step-entry" data-kind="reported">
          <div className="flex items-center gap-2">
            <CircleArrowRightIcon className="size-3.5 shrink-0" />
            <span>
              {entry.step} · {entry.outcome} · {entry.reporter === 'user' && 'by you · '}
              {time}
            </span>
          </div>
          {entry.summary !== null && <StepSummary markdown={entry.summary} className="ml-5.5" />}
        </li>
      )
    case 'started-over':
      return (
        <li
          className="flex items-center gap-2"
          data-testid="issue-step-entry"
          data-kind="started-over"
        >
          <RotateCcwIcon className="size-3.5 shrink-0" />
          <span>Started over · {time}</span>
        </li>
      )
    case 'in-progress':
      return (
        <li
          className="flex items-center gap-2"
          data-testid="issue-step-entry"
          data-kind="in-progress"
        >
          <CircleDashedIcon className="size-3.5 shrink-0" />
          <span>
            {entry.step} · in progress · {time}
          </span>
        </li>
      )
  }
}

/**
 * What happened to an issue that Hoot knows of, in the order it happened:
 * when it was created; each outcome of a step of its workflow reported, with
 * the agent's summary below it, and each time the workflow started over; the
 * step it is at, since that started; and when it was done or canceled, if it
 * is.
 */
export function IssueActivity({ issue, className }: { issue: Issue; className?: string }) {
  const now = useNow()
  const records = useAppStore((state) => issueRecordsOf(state, issue.id))
  const entries = activityEntries(issue, records, ISSUE_WORKFLOW)
  return (
    <section className={cn('border-t pt-5', className)} data-testid="issue-activity">
      <h2 className="mb-3 text-sm font-medium">Activity</h2>
      <ol className="grid gap-2.5 text-xs text-muted-foreground">
        {entries.map((entry) => (
          <Entry key={'id' in entry ? entry.id : entry.kind} entry={entry} now={now} />
        ))}
      </ol>
    </section>
  )
}

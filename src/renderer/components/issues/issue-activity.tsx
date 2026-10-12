import { CircleCheckIcon, CirclePlusIcon, CircleXIcon } from 'lucide-react'
import type { Issue } from '../../../shared/issues'
import { cn } from '../../lib/utils'
import { RelativeTime, useNow } from './relative-time'

/**
 * What happened to an issue that Hoot knows of: when it was created, and
 * when it was done or canceled, if it is.
 */
export function IssueActivity({ issue, className }: { issue: Issue; className?: string }) {
  const now = useNow()
  return (
    <section className={cn('border-t pt-5', className)} data-testid="issue-activity">
      <h2 className="mb-3 text-sm font-medium">Activity</h2>
      <ol className="grid gap-2.5 text-xs text-muted-foreground">
        <li className="flex items-center gap-2">
          <CirclePlusIcon className="size-3.5 shrink-0" />
          <span>
            Created the issue ·{' '}
            <RelativeTime time={issue.createdAt} now={now} data-testid="issue-created" />
          </span>
        </li>
        {issue.completedAt !== null && (
          <li className="flex items-center gap-2" data-testid="issue-completed">
            {issue.status === 'done' ? (
              <CircleCheckIcon className="size-3.5 shrink-0" />
            ) : (
              <CircleXIcon className="size-3.5 shrink-0" />
            )}
            <span>
              {issue.status === 'done' ? 'Completed the issue' : 'Canceled the issue'} ·{' '}
              <RelativeTime time={issue.completedAt} now={now} />
            </span>
          </li>
        )}
      </ol>
    </section>
  )
}

import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleIcon,
  CircleXIcon,
  ContrastIcon,
  EllipsisIcon,
  SignalHighIcon,
  SignalLowIcon,
  SignalMediumIcon,
  SquareExclamationPointIcon,
  type LucideIcon,
} from 'lucide-react'
import type { IssuePriority, IssueStatus } from '../../../shared/issues'
import { cn } from '../../lib/utils'

const STATUS_ICONS: Record<IssueStatus, { Icon: LucideIcon; color: string }> = {
  backlog: { Icon: CircleDashedIcon, color: 'text-muted-foreground' },
  todo: { Icon: CircleIcon, color: 'text-muted-foreground' },
  in_progress: { Icon: ContrastIcon, color: 'text-amber-500' },
  done: { Icon: CircleCheckIcon, color: 'text-indigo-500 dark:text-indigo-400' },
  canceled: { Icon: CircleXIcon, color: 'text-muted-foreground' },
}

const PRIORITY_ICONS: Record<IssuePriority, { Icon: LucideIcon; color: string }> = {
  0: { Icon: EllipsisIcon, color: 'text-muted-foreground' },
  1: { Icon: SquareExclamationPointIcon, color: 'text-orange-500' },
  2: { Icon: SignalHighIcon, color: 'text-foreground/80' },
  3: { Icon: SignalMediumIcon, color: 'text-foreground/80' },
  4: { Icon: SignalLowIcon, color: 'text-foreground/80' },
}

/** The icon of a status, in its color, as Linear draws them. */
export function StatusIcon({ status, className }: { status: IssueStatus; className?: string }) {
  const { Icon, color } = STATUS_ICONS[status]
  return (
    <Icon
      aria-hidden
      className={cn('size-4 shrink-0', color, className)}
      data-slot="status-icon"
      data-status={status}
    />
  )
}

/** The icon of a priority: bars for low to high, a warning for urgent, dots for none. */
export function PriorityIcon({
  priority,
  className,
}: {
  priority: IssuePriority
  className?: string
}) {
  const { Icon, color } = PRIORITY_ICONS[priority]
  return (
    <Icon
      aria-hidden
      className={cn('size-4 shrink-0', color, className)}
      data-slot="priority-icon"
      data-priority={priority}
    />
  )
}

import { ChevronDownIcon, PlusIcon } from 'lucide-react'
import type { IssueGroup as Group, IssueStatus } from '../../../shared/issues'
import { statusLabel } from '../../lib/issue-properties'
import { useAppStore } from '../../store/app-store'
import { Button } from '../ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { StatusIcon } from './issue-icons'
import { IssueRow } from './issue-row'

/**
 * The issues of one status in a list, under a header that collapses them
 * and adds an issue with the status, as Linear's lists group issues.
 */
export function IssueGroup({
  group,
  collapsed,
  identifierWidth,
  now,
  onHover,
  onAdd,
}: {
  group: Group
  collapsed: boolean
  identifierWidth: number
  now: number
  onHover(issueId: number): void
  /** Opens the new issue dialog for an issue with a status. */
  onAdd(status: IssueStatus): void
}) {
  const setIssueGroupOpen = useAppStore((state) => state.setIssueGroupOpen)
  const label = statusLabel(group.status)

  return (
    <Collapsible
      open={!collapsed}
      onOpenChange={(open) => setIssueGroupOpen(group.status, open)}
      data-testid="issue-group"
      data-status={group.status}
    >
      <div className="flex h-9 items-center gap-1 rounded-lg bg-muted/60 pr-1 pl-1.5">
        <CollapsibleTrigger
          className="group/toggle flex h-7 items-center gap-2 rounded-md px-1.5 text-[0.8rem] font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg:not([class*='size-'])]:size-3.5"
          data-testid="issue-group-toggle"
        >
          <ChevronDownIcon className="-rotate-90 text-muted-foreground transition-transform group-data-panel-open/toggle:rotate-0" />
          <StatusIcon status={group.status} />
          <span>{label}</span>
          <span className="text-muted-foreground tabular-nums" data-testid="issue-group-count">
            {group.issues.length}
          </span>
        </CollapsibleTrigger>
        <div className="flex-1" />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Add issue to ${label}`}
                onClick={() => onAdd(group.status)}
                data-testid="issue-group-add"
              />
            }
          >
            <PlusIcon />
          </TooltipTrigger>
          <TooltipContent side="left">Add issue…</TooltipContent>
        </Tooltip>
      </div>
      <CollapsibleContent>
        <ul className="py-0.5" aria-label={label}>
          {group.issues.map((issue) => (
            <IssueRow
              key={issue.id}
              issue={issue}
              identifierWidth={identifierWidth}
              now={now}
              onHover={onHover}
            />
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}

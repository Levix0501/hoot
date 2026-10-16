import { ChevronDownIcon, PlusIcon } from 'lucide-react'
import { useImperativeHandle, useRef, useState, type Ref } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { issueIdentifier, type Issue, type IssueStatus } from '../../../shared/issues'
import { progressFill, subIssueProgress, type SubIssueProgress } from '../../../shared/sub-issues'
import { cn } from '../../lib/utils'
import { shownParentOf, shownSubIssuesOf, useAppStore } from '../../store/app-store'
import { Button } from '../ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible'
import { Kbd } from '../ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { StatusIcon } from './issue-icons'
import { SubIssueCard, type SubIssueCardHandle } from './sub-issue-card'

/** The radius of the pie inside a progress circle, which its stroke fills from the center. */
const PIE_RADIUS = 2
const PIE_LENGTH = 2 * Math.PI * PIE_RADIUS

/**
 * A circle that fills as sub-issues get done, as Linear's: clockwise from the
 * top, a done sub-issue counting whole and one in progress a quarter, of
 * those not canceled; empty without any.
 */
export function SubIssueProgressRing({
  progress,
  className,
}: {
  progress: SubIssueProgress
  className?: string
}) {
  const fill = progressFill(progress)
  return (
    <svg
      viewBox="0 0 14 14"
      aria-hidden
      className={cn('size-3.5 shrink-0', className)}
      data-testid="sub-issue-progress-ring"
      data-fill={fill}
    >
      <circle
        cx="7"
        cy="7"
        r="6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-muted-foreground/60"
      />
      {fill > 0 && (
        <circle
          cx="7"
          cy="7"
          r={PIE_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={PIE_RADIUS * 2}
          strokeDasharray={`${fill * PIE_LENGTH} ${PIE_LENGTH}`}
          transform="rotate(-90 7 7)"
          className="text-indigo-500 dark:text-indigo-400"
        />
      )}
    </svg>
  )
}

/** The progress of sub-issues: its circle and how many of those not canceled are done, as 1/3. */
function Progress({ statuses, testId }: { statuses: readonly IssueStatus[]; testId: string }) {
  const progress = subIssueProgress(statuses)
  return (
    <span
      className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground tabular-nums"
      data-testid={testId}
      data-completed={progress.completed}
      data-total={progress.total}
    >
      <SubIssueProgressRing progress={progress} />
      <span data-testid={`${testId}-count`}>
        {progress.completed}/{progress.total}
      </span>
    </span>
  )
}

/**
 * The line under a sub-issue's title, as Linear's: Sub-issue of, the
 * parent's status, identifier and title, which show the parent, and the
 * parent's progress. None for an issue without a parent Hoot shows.
 */
export function ParentLine({ issue }: { issue: Issue }) {
  const parent = useAppStore((state) => shownParentOf(state, issue.id))
  const statuses = useAppStore(
    useShallow((state) =>
      parent ? shownSubIssuesOf(state, parent.id).map((subIssue) => subIssue.status) : [],
    ),
  )
  const showIssue = useAppStore((state) => state.showIssue)
  if (!parent) return null
  return (
    <div
      className="mt-2 flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
      data-testid="issue-parent"
    >
      <span className="shrink-0">Sub-issue of</span>
      <button
        type="button"
        className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        onClick={() => showIssue(parent.id)}
        data-testid="issue-parent-link"
        data-issue-id={parent.id}
      >
        <StatusIcon status={parent.status} className="size-3.5" />
        <span className="shrink-0 tabular-nums" data-testid="issue-parent-identifier">
          {issueIdentifier(parent.id)}
        </span>
        <span
          className="min-w-0 truncate font-medium text-foreground"
          data-user-text=""
          data-testid="issue-parent-title"
        >
          {parent.title}
        </span>
      </button>
      <span className="rounded-full border px-1.5 py-0.5">
        <Progress statuses={statuses} testId="issue-parent-progress" />
      </span>
    </div>
  )
}

export interface SubIssuesHandle {
  /** Opens the card for a new sub-issue, or puts the focus in it when it is open. */
  openCard(): void
}

/**
 * An issue's sub-issues, under its description, as Linear shows them: a
 * header with Sub-issues, which collapses and expands the rows, the progress
 * and a + for a new sub-issue; then a row for each sub-issue Hoot shows, in
 * the order they last became its sub-issues, with its status and title, and
 * its project when that is not the issue's. Without any, only Add
 * sub-issues. Clicking a row shows its issue.
 */
export function SubIssuesSection({
  issue,
  className,
  ref,
}: {
  issue: Issue
  className?: string
  ref?: Ref<SubIssuesHandle>
}) {
  const subIssues = useAppStore(useShallow((state) => shownSubIssuesOf(state, issue.id)))
  const projects = useAppStore((state) => state.projects)
  const showIssue = useAppStore((state) => state.showIssue)
  const [expanded, setExpanded] = useState(true)
  const [cardOpen, setCardOpen] = useState(false)
  const card = useRef<SubIssueCardHandle>(null)

  const openCard = () => {
    setExpanded(true)
    if (cardOpen) card.current?.focus()
    else setCardOpen(true)
  }
  useImperativeHandle(ref, () => ({ openCard }))

  const addButton = (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Add sub-issue"
            onClick={openCard}
            data-testid="sub-issues-add"
          />
        }
      >
        <PlusIcon />
      </TooltipTrigger>
      <TooltipContent side="top">
        Add sub-issue
        <Kbd>⌘⇧O</Kbd>
      </TooltipContent>
    </Tooltip>
  )

  return (
    <section
      aria-label="Sub-issues"
      className={cn('grid gap-1', className)}
      data-testid="sub-issues"
      data-count={subIssues.length}
    >
      {subIssues.length === 0 ? (
        !cardOpen && (
          <Button
            variant="ghost"
            size="sm"
            // Its icon in line with the description's text.
            className="-ml-2.5 justify-self-start text-muted-foreground"
            onClick={openCard}
            data-testid="sub-issues-add-first"
          >
            <PlusIcon />
            Add sub-issues
          </Button>
        )
      ) : (
        <Collapsible open={expanded} onOpenChange={setExpanded}>
          <div className="flex h-9 items-center gap-1" data-testid="sub-issues-header">
            <CollapsibleTrigger
              className="group/toggle -ml-1.5 flex h-7 items-center gap-1.5 rounded-md px-1.5 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
              data-testid="sub-issues-toggle"
            >
              <ChevronDownIcon className="size-3.5 -rotate-90 text-muted-foreground transition-transform group-data-panel-open/toggle:rotate-0" />
              Sub-issues
            </CollapsibleTrigger>
            <Progress
              statuses={subIssues.map((subIssue) => subIssue.status)}
              testId="sub-issues-progress"
            />
            <div className="flex-1" />
            {addButton}
          </div>
          <CollapsibleContent>
            <ul className="-mx-2 grid" data-testid="sub-issue-rows">
              {subIssues.map((subIssue) => {
                const otherProject = subIssue.projectId !== issue.projectId
                const project = projects.find((candidate) => candidate.id === subIssue.projectId)
                return (
                  <li key={subIssue.id}>
                    <button
                      type="button"
                      className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[13px] outline-none hover:bg-muted/50 focus-visible:bg-muted focus-visible:ring-1 focus-visible:ring-ring/50"
                      onClick={() => showIssue(subIssue.id)}
                      data-testid="sub-issue-row"
                      data-issue-id={subIssue.id}
                      data-status={subIssue.status}
                    >
                      <StatusIcon status={subIssue.status} />
                      <span
                        className="min-w-0 flex-1 truncate font-medium"
                        data-user-text=""
                        data-testid="sub-issue-row-title"
                      >
                        {subIssue.title}
                      </span>
                      {otherProject && (
                        <span
                          className="max-w-[30%] shrink-0 truncate text-xs text-muted-foreground"
                          title={project?.root}
                          data-path={project ? '' : undefined}
                          data-testid="sub-issue-row-project"
                        >
                          {project ? project.name : 'No project'}
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
      {cardOpen && <SubIssueCard ref={card} parent={issue} onClose={() => setCardOpen(false)} />}
    </section>
  )
}

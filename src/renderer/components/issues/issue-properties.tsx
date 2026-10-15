import {
  ChevronDownIcon,
  CircleArrowRightIcon,
  FolderIcon,
  RotateCcwIcon,
  WorkflowIcon,
} from 'lucide-react'
import { ISSUE_WORKFLOW } from '../../../shared/built-in-workflow'
import type { Issue } from '../../../shared/issues'
import { firstStep, workflowProgress, workflowStep } from '../../../shared/workflows'
import { priorityLabel, statusLabel } from '../../lib/issue-properties'
import { progressLabel } from '../../lib/issue-workflow'
import { cn } from '../../lib/utils'
import {
  focusAfterOverlay,
  isIssueStarting,
  issueRecordsOf,
  useAppStore,
} from '../../store/app-store'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { PriorityIcon, StatusIcon } from './issue-icons'
import { PriorityPicker, ProjectPicker, StatusPicker } from './property-picker'

/**
 * The buttons of the properties: a row of them under the title on a narrow
 * page, a column beside it on a wide one, as in Linear.
 */
const PROPERTY_BUTTON =
  'justify-start @max-2xl/issue:rounded-full @max-2xl/issue:border-border @2xl/issue:w-full'

/**
 * Where the issue is in its workflow: Not started, the step it is at, or
 * Finished. Once it has started, it opens a menu that reports an outcome of
 * the step it is at, as the user picks it, or starts the workflow over; both
 * apply at once. It does not open while the issue is being started, whose
 * session starts at the step the issue was at when its start button was
 * clicked.
 */
function StepProperty({ issue }: { issue: Issue }) {
  const reportStep = useAppStore((state) => state.reportStep)
  const startOverWorkflow = useAppStore((state) => state.startOverWorkflow)
  const progress = workflowProgress(useAppStore((state) => issueRecordsOf(state, issue.id)))
  const starting = useAppStore((state) => isIssueStarting(state, issue.id))
  const label = progressLabel(progress, ISSUE_WORKFLOW)
  const content = (
    <>
      <WorkflowIcon className="text-muted-foreground" />
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-left',
          progress.kind === 'not-started' && 'text-muted-foreground',
        )}
        data-testid="issue-step-label"
      >
        {label}
      </span>
    </>
  )
  const buttonProps = {
    variant: 'ghost',
    size: 'sm',
    'aria-label': `Step: ${label}`,
    'data-testid': 'issue-step',
    'data-progress': progress.kind,
  } as const
  // As the other properties that open something show.
  const chevron = <ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground" />
  if (progress.kind === 'not-started' || starting) {
    // Nothing to report or start over yet, or not while the issue is being
    // started; it looks as it does otherwise, as the other properties do.
    return (
      <Button {...buttonProps} className={cn(PROPERTY_BUTTON, 'disabled:opacity-100')} disabled>
        {content}
        {progress.kind !== 'not-started' && chevron}
      </Button>
    )
  }
  const step = progress.kind === 'at-step' ? workflowStep(ISSUE_WORKFLOW, progress.step) : undefined
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button {...buttonProps} className={PROPERTY_BUTTON} />}>
        {content}
        {chevron}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-auto min-w-(--anchor-width) [app-region:no-drag]"
        finalFocus={focusAfterOverlay}
        data-testid="issue-step-menu"
      >
        {progress.kind === 'at-step' &&
          step?.outcomes.map((outcome) => (
            <DropdownMenuItem
              key={outcome.name}
              onClick={() => void reportStep(issue.id, progress.run, outcome.name)}
              data-testid="issue-step-report"
              data-outcome={outcome.name}
            >
              <CircleArrowRightIcon />
              Report {outcome.label}
            </DropdownMenuItem>
          ))}
        {step !== undefined && <DropdownMenuSeparator />}
        <DropdownMenuItem
          onClick={() => void startOverWorkflow(issue.id)}
          data-testid="issue-step-start-over"
        >
          <RotateCcwIcon />
          Start over from {firstStep(ISSUE_WORKFLOW).name}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * An issue's status, priority and project, each a button that opens its
 * picker, and the step of its workflow it is at. The status and priority
 * pickers also open with S and P, through `open` and `onOpenChange`.
 */
export function IssueProperties({
  issue,
  statusOpen,
  onStatusOpenChange,
  priorityOpen,
  onPriorityOpenChange,
  className,
}: {
  issue: Issue
  statusOpen: boolean
  onStatusOpenChange(open: boolean): void
  priorityOpen: boolean
  onPriorityOpenChange(open: boolean): void
  className?: string
}) {
  const updateIssue = useAppStore((state) => state.updateIssue)
  const project = useAppStore((state) =>
    state.projects.find((candidate) => candidate.id === issue.projectId),
  )
  return (
    <section
      aria-label="Properties"
      className={cn(
        'flex flex-wrap items-center gap-1.5 @2xl/issue:flex-col @2xl/issue:items-stretch @2xl/issue:gap-0.5',
        className,
      )}
      data-testid="issue-properties"
    >
      <h2 className="hidden px-2.5 pb-1.5 text-xs font-medium text-muted-foreground @2xl/issue:block">
        Properties
      </h2>
      <StatusPicker
        value={issue.status}
        onChange={(status) => updateIssue(issue.id, { status })}
        open={statusOpen}
        onOpenChange={onStatusOpenChange}
        triggerProps={{
          render: (
            <Button
              variant="ghost"
              size="sm"
              className={PROPERTY_BUTTON}
              aria-label={`Status: ${statusLabel(issue.status)}`}
              data-testid="issue-status"
              data-status={issue.status}
            />
          ),
        }}
      >
        <StatusIcon status={issue.status} />
        <span className="flex-1 text-left">{statusLabel(issue.status)}</span>
      </StatusPicker>
      <PriorityPicker
        value={issue.priority}
        onChange={(priority) => updateIssue(issue.id, { priority })}
        open={priorityOpen}
        onOpenChange={onPriorityOpenChange}
        triggerProps={{
          render: (
            <Button
              variant="ghost"
              size="sm"
              className={PROPERTY_BUTTON}
              aria-label={`Priority: ${priorityLabel(issue.priority)}`}
              data-testid="issue-priority"
              data-priority={issue.priority}
            />
          ),
        }}
      >
        <PriorityIcon priority={issue.priority} />
        <span className={cn('flex-1 text-left', issue.priority === 0 && 'text-muted-foreground')}>
          {issue.priority === 0 ? 'Set priority' : priorityLabel(issue.priority)}
        </span>
      </PriorityPicker>
      <ProjectPicker
        value={issue.projectId}
        onChange={(projectId) => updateIssue(issue.id, { projectId })}
        triggerProps={{
          render: (
            <Button
              variant="ghost"
              size="sm"
              className={PROPERTY_BUTTON}
              aria-label={`Project: ${project?.name ?? 'No project'}`}
              data-testid="issue-project"
              data-project-id={issue.projectId ?? undefined}
            />
          ),
        }}
      >
        <FolderIcon className="text-muted-foreground" />
        <span
          className={cn('min-w-0 flex-1 truncate text-left', !project && 'text-muted-foreground')}
          data-path={project ? '' : undefined}
          data-testid="issue-project-name"
        >
          {project ? project.name : 'Add to project'}
        </span>
      </ProjectPicker>
      <StepProperty issue={issue} />
    </section>
  )
}

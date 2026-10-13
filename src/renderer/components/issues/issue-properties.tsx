import { FolderIcon } from 'lucide-react'
import type { Issue } from '../../../shared/issues'
import { priorityLabel, statusLabel } from '../../lib/issue-properties'
import { cn } from '../../lib/utils'
import { useAppStore } from '../../store/app-store'
import { Button } from '../ui/button'
import { PriorityIcon, StatusIcon } from './issue-icons'
import { PriorityPicker, ProjectPicker, StatusPicker } from './property-picker'

/**
 * The buttons of the properties: a row of them under the title on a narrow
 * page, a column beside it on a wide one, as in Linear.
 */
const PROPERTY_BUTTON =
  'justify-start @max-2xl/issue:rounded-full @max-2xl/issue:border-border @2xl/issue:w-full'

/**
 * An issue's status, priority and project, each a button that opens its
 * picker. The status and priority pickers also open with S and P, through
 * `open` and `onOpenChange`.
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
    </section>
  )
}

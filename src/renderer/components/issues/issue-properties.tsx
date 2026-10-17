import { FolderIcon, XIcon } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import type { Dependency } from '../../../shared/dependencies'
import { issueIdentifier, type Issue } from '../../../shared/issues'
import { priorityLabel, statusLabel } from '../../lib/issue-properties'
import { cn } from '../../lib/utils'
import { shownBlockedByOf, shownBlockingOf, useAppStore, waitCountsOf } from '../../store/app-store'
import { Button } from '../ui/button'
import { PriorityIcon, StatusIcon } from './issue-icons'
import { IssueLabels } from './labels'
import { PriorityPicker, ProjectPicker, StatusPicker } from './property-picker'

/**
 * The buttons of the properties: a row of them under the title on a narrow
 * page, a column beside it on a wide one, as in Linear.
 */
const PROPERTY_BUTTON =
  'justify-start @max-2xl/issue:rounded-full @max-2xl/issue:border-border @2xl/issue:w-full'

/**
 * The issues an issue is blocked by, or those it blocks, as Linear lists them
 * among the properties: under a heading, a row for each, with its status and
 * title, and its project when that is not the issue's (No project for none).
 * Click a row to show its issue; hover it for the ✕ that removes the
 * dependency at once. Nothing without any.
 */
function DependencySection({
  issue,
  kind,
  issues,
}: {
  issue: Issue
  kind: 'blocked-by' | 'blocking'
  issues: readonly Issue[]
}) {
  const projects = useAppStore((state) => state.projects)
  const showIssue = useAppStore((state) => state.showIssue)
  const changeDependencies = useAppStore((state) => state.changeDependencies)
  if (issues.length === 0) return null
  const heading = kind === 'blocked-by' ? 'Blocked by' : 'Blocking'
  const remove = (related: Issue) => {
    const dependency: Dependency =
      kind === 'blocked-by'
        ? { issueId: issue.id, blockedById: related.id }
        : { issueId: related.id, blockedById: issue.id }
    void changeDependencies({ remove: [dependency] }, 'Could not remove the dependency.')
  }
  return (
    <section
      aria-label={heading}
      className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)] gap-0.5 pt-3"
      data-testid={`issue-${kind}`}
      data-count={issues.length}
    >
      <h2 className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">{heading}</h2>
      <ul className="grid grid-cols-[minmax(0,1fr)]">
        {issues.map((related) => {
          const otherProject = related.projectId !== issue.projectId
          const project = projects.find((candidate) => candidate.id === related.projectId)
          return (
            <li key={related.id} className="group/dependency relative">
              <button
                type="button"
                className="flex h-8 w-full items-center gap-2 rounded-md pr-8 pl-2.5 text-left text-[13px] outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-1 focus-visible:ring-ring/50"
                onClick={() => showIssue(related.id)}
                title={`${issueIdentifier(related.id)} ${related.title}`}
                data-testid="issue-dependency-row"
                data-issue-id={related.id}
                data-status={related.status}
              >
                <StatusIcon status={related.status} />
                <span
                  className="min-w-0 flex-1 truncate"
                  data-user-text=""
                  data-testid="issue-dependency-title"
                >
                  {related.title}
                </span>
                {otherProject && (
                  <span
                    className="max-w-[40%] shrink-0 truncate text-xs text-muted-foreground"
                    data-path={project ? '' : undefined}
                    data-testid="issue-dependency-project"
                  >
                    {project ? project.name : 'No project'}
                  </span>
                )}
              </button>
              {/* Beside the row's button, which it cannot be inside: clicking it does not show the issue. */}
              <Button
                variant="ghost"
                size="icon-xs"
                className="absolute top-1/2 right-1 -translate-y-1/2 opacity-0 group-hover/dependency:opacity-100 focus-visible:opacity-100"
                aria-label={`Remove ${issueIdentifier(related.id)} from ${heading}`}
                onClick={() => remove(related)}
                data-testid="issue-dependency-remove"
              >
                <XIcon />
              </Button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/**
 * An issue's status, priority and project, each a button that opens its
 * picker; its labels; then the issues it is blocked by and those it blocks. The status shows a red badge while the
 * issue waits on an issue. The status and priority pickers also open with S
 * and P, through `open` and `onOpenChange`.
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
  const blockedBy = useAppStore(useShallow((state) => shownBlockedByOf(state, issue.id)))
  const blocking = useAppStore(useShallow((state) => shownBlockingOf(state, issue.id)))
  const waiting = useAppStore((state) => waitCountsOf(state, issue.id).waitedOn > 0)
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
              aria-label={`Status: ${statusLabel(issue.status)}${waiting ? ', blocked' : ''}`}
              data-testid="issue-status"
              data-status={issue.status}
              data-blocked={waiting || undefined}
            />
          ),
        }}
      >
        <span className="relative flex shrink-0">
          <StatusIcon status={issue.status} />
          {waiting && (
            <span
              aria-hidden
              className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full bg-red-500 ring-[1.5px] ring-background"
              data-testid="issue-status-blocked-badge"
            />
          )}
        </span>
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
      <IssueLabels issue={issue} />
      <DependencySection issue={issue} kind="blocked-by" issues={blockedBy} />
      <DependencySection issue={issue} kind="blocking" issues={blocking} />
    </section>
  )
}

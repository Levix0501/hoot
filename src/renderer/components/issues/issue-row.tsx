import { CopyIcon, DeleteIcon, LinkIcon, Trash2Icon } from 'lucide-react'
import { useMemo, useState, type ComponentType, type KeyboardEvent } from 'react'
import { issueIdentifier, type Issue } from '../../../shared/issues'
import {
  optionOfDigit,
  PRIORITY_OPTIONS,
  STATUS_OPTIONS,
  type PropertyOption,
} from '../../lib/issue-properties'
import { projectOptions } from '../../lib/project-choices'
import { dateTime, shortDate } from '../../lib/time'
import { focusAfterOverlay, useAppStore } from '../../store/app-store'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '../ui/context-menu'
import { PriorityIcon, StatusIcon } from './issue-icons'
import { PriorityOptionIcon, ProjectOptionIcon, StatusOptionIcon } from './property-picker'

/**
 * A submenu of a property's values, the issue's marked; a digit typed in it
 * picks the value with that digit, if any.
 */
function PropertySubmenu<T extends string | number | null>({
  label,
  Icon,
  options,
  value,
  onChange,
  close,
}: {
  label: string
  Icon: ComponentType<{ value: T }>
  options: ReadonlyArray<PropertyOption<T>>
  value: T
  onChange(value: T): void
  close(): void
}) {
  const pick = (next: T) => {
    if (next !== value) onChange(next)
  }
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger data-testid={`issue-menu-${label.toLowerCase()}`}>
        <Icon value={value} />
        {label}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent
        className="shadow-lg [app-region:no-drag]"
        onKeyDown={(event: KeyboardEvent) => {
          if (event.metaKey || event.ctrlKey || event.altKey) return
          const option = optionOfDigit(options, event.key)
          if (option === null) return
          event.preventDefault()
          pick(option.value)
          close()
        }}
      >
        <ContextMenuRadioGroup value={value} onValueChange={(next: T) => pick(next)}>
          {options.map((option) => (
            <ContextMenuRadioItem
              key={String(option.value)}
              value={option.value}
              closeOnClick
              data-value={String(option.value)}
            >
              <Icon value={option.value} />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.shortcut !== undefined && (
                <ContextMenuShortcut>{option.shortcut}</ContextMenuShortcut>
              )}
            </ContextMenuRadioItem>
          ))}
        </ContextMenuRadioGroup>
      </ContextMenuSubContent>
    </ContextMenuSub>
  )
}

/**
 * An issue in the list, as Linear shows it: its priority, its identifier, its
 * status, its title, its project if any, and when it was created. Click it to
 * show its page; right-click it to change its status, priority or project,
 * copy it or delete it.
 */
export function IssueRow({
  issue,
  identifierWidth,
  now,
  onHover,
}: {
  issue: Issue
  /** How wide the identifiers of the list are, in characters, so that they line up. */
  identifierWidth: number
  now: number
  /** Called with the issue when the pointer moves onto the row. */
  onHover(issueId: number): void
}) {
  const projects = useAppStore((state) => state.projects)
  const project = projects.find(({ id }) => id === issue.projectId)
  const projectChoices = useMemo(() => projectOptions(projects), [projects])
  const showIssue = useAppStore((state) => state.showIssue)
  const updateIssue = useAppStore((state) => state.updateIssue)
  const copyIssueIdentifier = useAppStore((state) => state.copyIssueIdentifier)
  const copyIssueTitle = useAppStore((state) => state.copyIssueTitle)
  const requestDeleteIssue = useAppStore((state) => state.requestDeleteIssue)
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <ContextMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <ContextMenuTrigger render={<li />} onMouseEnter={() => onHover(issue.id)}>
        <button
          type="button"
          className="flex h-11 w-full items-center gap-2.5 rounded-lg px-3 text-left text-[13px] outline-none hover:bg-muted/50 focus-visible:bg-muted focus-visible:ring-1 focus-visible:ring-ring/50 data-popup-open:bg-muted"
          onClick={() => showIssue(issue.id)}
          data-popup-open={menuOpen || undefined}
          data-testid="issue-row"
          data-issue-id={issue.id}
          data-status={issue.status}
          data-priority={issue.priority}
        >
          <PriorityIcon priority={issue.priority} />
          <span
            className="shrink-0 text-muted-foreground tabular-nums"
            style={{ width: `${identifierWidth}ch` }}
            data-testid="issue-row-identifier"
          >
            {issueIdentifier(issue.id)}
          </span>
          <StatusIcon status={issue.status} />
          <span
            className="min-w-0 flex-1 truncate font-medium"
            data-user-text=""
            data-testid="issue-row-title"
          >
            {issue.title}
          </span>
          {project && (
            <span
              className="max-w-[30%] shrink-0 truncate text-xs text-muted-foreground"
              title={project.root}
              data-path=""
              data-testid="issue-row-project"
            >
              {project.name}
            </span>
          )}
          <time
            className="shrink-0 text-xs text-muted-foreground"
            dateTime={new Date(issue.createdAt).toISOString()}
            title={`Created ${dateTime(issue.createdAt)}`}
            data-testid="issue-row-created"
          >
            {shortDate(issue.createdAt, now)}
          </time>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-48 [app-region:no-drag]" finalFocus={focusAfterOverlay}>
        <PropertySubmenu
          label="Status"
          Icon={StatusOptionIcon}
          options={STATUS_OPTIONS}
          value={issue.status}
          onChange={(status) => updateIssue(issue.id, { status })}
          close={() => setMenuOpen(false)}
        />
        <PropertySubmenu
          label="Priority"
          Icon={PriorityOptionIcon}
          options={PRIORITY_OPTIONS}
          value={issue.priority}
          onChange={(priority) => updateIssue(issue.id, { priority })}
          close={() => setMenuOpen(false)}
        />
        <PropertySubmenu
          label="Project"
          Icon={ProjectOptionIcon}
          options={projectChoices}
          value={issue.projectId}
          onChange={(projectId) => updateIssue(issue.id, { projectId })}
          close={() => setMenuOpen(false)}
        />
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={() => copyIssueIdentifier(issue.id)}
          data-testid="issue-menu-copy-id"
        >
          <LinkIcon />
          Copy ID
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => copyIssueTitle(issue.id)}
          data-testid="issue-menu-copy-title"
        >
          <CopyIcon />
          Copy title
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onClick={() => requestDeleteIssue(issue.id)}
          data-testid="issue-menu-delete"
        >
          <Trash2Icon />
          Delete…
          <ContextMenuShortcut className="flex items-center">
            ⌘<DeleteIcon className="size-3.5" />
          </ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

import {
  ArrowDownIcon,
  ArrowUpIcon,
  CopyIcon,
  DeleteIcon,
  EllipsisIcon,
  LinkIcon,
  Trash2Icon,
} from 'lucide-react'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { isIssueOpen, issueTitle, type Issue } from '../../../shared/issues'
import { issuePageOrder, isOnList } from '../../lib/project-choices'
import { focusAfterOverlay, useAppStore } from '../../store/app-store'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { Kbd } from '../ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { DescriptionEditor, type DescriptionEditorHandle } from './description-editor'
import { IssueActivity } from './issue-activity'
import { IssueProperties } from './issue-properties'
import { IssueStartButton } from './issue-start-button'
import { IssuesBreadcrumb, IssuesTopRow } from './issues-top-row'
import { TitleField } from './title-field'
import { useIssueShortcuts } from './use-issue-shortcuts'

/** The issue's menu in the title row: copying it, and deleting it. */
function IssueMenu({ issue }: { issue: Issue }) {
  const copyIssueIdentifier = useAppStore((state) => state.copyIssueIdentifier)
  const copyIssueTitle = useAppStore((state) => state.copyIssueTitle)
  const requestDeleteIssue = useAppStore((state) => state.requestDeleteIssue)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 [app-region:no-drag]"
            aria-label="Issue actions"
            data-testid="issue-menu-button"
          />
        }
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-auto min-w-48 [app-region:no-drag]"
        finalFocus={focusAfterOverlay}
      >
        <DropdownMenuItem
          onClick={() => copyIssueIdentifier(issue.id)}
          data-testid="issue-menu-copy-id"
        >
          <LinkIcon />
          Copy ID
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => copyIssueTitle(issue.id)}
          data-testid="issue-menu-copy-title"
        >
          <CopyIcon />
          Copy title
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => requestDeleteIssue(issue.id)}
          data-testid="issue-menu-delete"
        >
          <Trash2Icon />
          Delete…
          <DropdownMenuShortcut className="flex items-center">
            ⌘<DeleteIcon className="size-3.5" />
          </DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A button that shows the next or previous issue of the list, with its key in its tooltip. */
function StepButton({
  label,
  shortcut,
  disabled,
  onClick,
  children,
  testId,
}: {
  label: string
  shortcut: string
  disabled: boolean
  onClick(): void
  children: ReactNode
  testId: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            // While it cannot step, it is still what the pointer is on, like any other button.
            className="[app-region:no-drag] disabled:pointer-events-auto"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
            data-testid={testId}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label}
        <Kbd>{shortcut}</Kbd>
      </TooltipContent>
    </Tooltip>
  )
}

/** The title, typed where it shows. A blank title is not saved, and gives way to the saved one. */
function IssueTitle({ issue, onEnter }: { issue: Issue; onEnter(): void }) {
  const updateIssue = useAppStore((state) => state.updateIssue)
  // What is typed while the field has the focus; `null` shows the saved title.
  const [typed, setTyped] = useState<string | null>(null)
  return (
    <TitleField
      value={typed ?? issue.title}
      onFocus={() => setTyped(issue.title)}
      onBlur={() => setTyped(null)}
      onChange={(title) => {
        setTyped(title)
        if (issueTitle(title) !== '') updateIssue(issue.id, { title })
      }}
      onEnter={onEnter}
      onEscape={(field) => field.blur()}
      aria-label="Title"
      className="text-2xl leading-tight font-semibold md:text-2xl"
      data-user-text=""
      data-testid="issue-title"
    />
  )
}

/**
 * An issue's page, laid out as Linear's: the title, the description and the
 * activity, with the properties beside them on a wide page or under the
 * title on a narrow one. The title and the description are edited where
 * they show, and saved as they change. J and K show the next and previous
 * issue of the issue list, S and P change the status and priority, and Esc
 * goes back to the list.
 */
export function IssuePage({ issueId }: { issueId: number }) {
  const issue = useAppStore((state) => state.issues.find(({ id }) => id === issueId))
  const view = useAppStore((state) => state.issueView)
  const issues = useAppStore((state) => state.issues)
  const listed = useAppStore(
    useShallow((state) =>
      state.issues.filter((candidate) => isOnList(candidate, state.checkedProjects)),
    ),
  )
  const showIssue = useAppStore((state) => state.showIssue)
  const showIssueList = useAppStore((state) => state.showIssueList)
  const openNewIssue = useAppStore((state) => state.openNewIssue)
  const requestDeleteIssue = useAppStore((state) => state.requestDeleteIssue)
  const updateIssue = useAppStore((state) => state.updateIssue)
  const [statusOpen, setStatusOpen] = useState(false)
  const [priorityOpen, setPriorityOpen] = useState(false)
  const description = useRef<DescriptionEditorHandle>(null)

  // The issues in the order of the issue list as it is, or of every issue
  // when the list does not show this one.
  const order = useMemo(
    () => issuePageOrder(issueId, listed, issues, view),
    [issueId, listed, issues, view],
  )
  const position = order.findIndex(({ id }) => id === issueId)

  const step = (offset: 1 | -1) => {
    const next = order[position + offset]
    if (position !== -1 && next) showIssue(next.id)
  }

  useIssueShortcuts('issue', (shortcut) => {
    if (!issue) return false
    switch (shortcut.kind) {
      case 'new-issue':
        openNewIssue(issue.projectId)
        return true
      case 'move':
        step(shortcut.offset)
        return true
      case 'status':
        setStatusOpen(true)
        return true
      case 'priority':
        setPriorityOpen(true)
        return true
      case 'delete':
        requestDeleteIssue(issue.id)
        return true
      case 'back-to-list':
        showIssueList()
        return true
    }
  })

  if (!issue) return null

  return (
    <div
      className="flex min-h-0 flex-1 flex-col bg-background text-foreground"
      data-testid="issue-page"
      data-issue-id={issue.id}
    >
      <IssuesTopRow>
        <IssuesBreadcrumb issue={issue} />
        <IssueMenu issue={issue} />
        <div className="min-w-2 flex-1" />
        {position !== -1 && (
          <div className="flex shrink-0 items-center gap-0.5" data-testid="issue-stepper">
            <span
              className="px-1.5 text-xs text-muted-foreground tabular-nums"
              data-testid="issue-position"
            >
              {position + 1} / {order.length}
            </span>
            <StepButton
              label="Next issue"
              shortcut="J"
              disabled={position === order.length - 1}
              onClick={() => step(1)}
              testId="issue-next"
            >
              <ArrowDownIcon />
            </StepButton>
            <StepButton
              label="Previous issue"
              shortcut="K"
              disabled={position === 0}
              onClick={() => step(-1)}
              testId="issue-previous"
            >
              <ArrowUpIcon />
            </StepButton>
          </div>
        )}
      </IssuesTopRow>
      <div className="@container/issue min-h-0 flex-1 overflow-y-auto" data-testid="issue-scroll">
        <div className="mx-auto grid w-full max-w-6xl gap-x-12 gap-y-4 px-6 pt-1 pb-12 [grid-template-areas:'toolbar'_'title'_'properties'_'description'_'activity'] @2xl/issue:grid-cols-[minmax(0,1fr)_15rem] @2xl/issue:grid-rows-[auto_auto_auto_1fr] @2xl/issue:[grid-template-areas:'._toolbar'_'title_properties'_'description_properties'_'activity_properties']">
          <div
            className="flex min-h-7 justify-end gap-2 [grid-area:toolbar]"
            data-testid="issue-actions"
          >
            {isIssueOpen(issue) && <IssueStartButton issue={issue} tooltipSide="bottom" />}
          </div>
          <div className="[grid-area:title]">
            <IssueTitle issue={issue} onEnter={() => description.current?.focus()} />
          </div>
          <IssueProperties
            issue={issue}
            statusOpen={statusOpen}
            onStatusOpenChange={setStatusOpen}
            priorityOpen={priorityOpen}
            onPriorityOpenChange={setPriorityOpen}
            className="self-start [grid-area:properties]"
          />
          <DescriptionEditor
            ref={description}
            markdown={issue.description}
            onChange={(markdown) => updateIssue(issue.id, { description: markdown })}
            escapeBlurs
            className="[grid-area:description] [&_.tiptap]:min-h-24"
            testId="issue-description"
          />
          <IssueActivity issue={issue} className="mt-6 self-start [grid-area:activity]" />
        </div>
      </div>
    </div>
  )
}

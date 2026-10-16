import { FlagIcon, FolderIcon, OctagonMinusIcon, XIcon } from 'lucide-react'
import { useRef, useState, type Ref } from 'react'
import {
  issueIdentifier,
  issueTitle,
  oneLineTitle,
  type Issue,
  type IssuePriority,
  type IssueStatus,
} from '../../../shared/issues'
import { priorityLabel, statusLabel } from '../../lib/issue-properties'
import type { ProjectChoice } from '../../lib/project-choices'
import { cn } from '../../lib/utils'
import { focusAfterOverlay, useAppStore, type DependentIssueDialog } from '../../store/app-store'
import { Button } from '../ui/button'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTitle } from '../ui/dialog'
import { Kbd } from '../ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { DescriptionEditor, type DescriptionEditorHandle } from './description-editor'
import { PriorityIcon, StatusIcon } from './issue-icons'
import { PriorityPicker, ProjectPicker, StatusPicker } from './property-picker'
import { TitleField } from './title-field'

/** The small rounded buttons of the properties, under the description. */
const PROPERTY_CHIP = 'rounded-full'

/**
 * What the dialog holds for a new issue with a dependency on `issue`: the
 * title typed in the picker it opened from, an empty description, Backlog, no
 * priority, and the issue's project, which can all be changed.
 */
function DependentIssueForm({
  dialog,
  issue,
  titleRef,
}: {
  dialog: DependentIssueDialog
  issue: Issue
  titleRef: Ref<HTMLTextAreaElement>
}) {
  const projects = useAppStore((state) => state.projects)
  const createDependentIssue = useAppStore((state) => state.createDependentIssue)
  const [title, setTitle] = useState(() => oneLineTitle(dialog.title))
  const [status, setStatus] = useState<IssueStatus>('backlog')
  const [priority, setPriority] = useState<IssuePriority>(0)
  const [projectId, setProjectId] = useState<ProjectChoice>(issue.projectId)
  const [creating, setCreating] = useState(false)
  /** The description as typed so far, which the editor hands on as it goes. */
  const description = useRef('')
  const descriptionEditor = useRef<DescriptionEditorHandle>(null)
  // Unless it left the list meanwhile.
  const project = projects.find((candidate) => candidate.id === projectId)
  const canCreate = issueTitle(title) !== '' && !creating

  const create = async () => {
    // What was typed into the description a moment ago.
    descriptionEditor.current?.flush()
    if (!canCreate) return
    setCreating(true)
    try {
      await createDependentIssue({
        title,
        description: description.current,
        status,
        priority,
        projectId: project ? project.id : null,
      })
    } finally {
      setCreating(false)
    }
  }

  return (
    <div
      className="grid"
      // Before the description's editor, where ⌘ Enter would otherwise break the line.
      onKeyDownCapture={(event) => {
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Enter' && event.metaKey && !event.ctrlKey && !event.altKey) {
          event.preventDefault()
          event.stopPropagation()
          void create()
        }
      }}
    >
      <div className="flex items-center gap-1 px-4 pt-3">
        <DialogTitle className="min-w-0 text-sm font-normal" data-testid="dependent-issue-heading">
          New issue
        </DialogTitle>
        <div className="flex-1" />
        <DialogClose
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close"
              data-testid="dependent-issue-close"
            />
          }
        >
          <XIcon />
        </DialogClose>
      </div>
      <div className="grid max-h-[min(40vh,22rem)] min-h-0 content-start gap-2 overflow-y-auto px-4 pt-3 pb-3">
        <TitleField
          ref={titleRef}
          value={title}
          onChange={setTitle}
          onEnter={() => descriptionEditor.current?.focus()}
          placeholder="Issue title"
          aria-label="Title"
          className="text-lg font-semibold md:text-lg"
          data-user-text=""
          data-testid="dependent-issue-title"
        />
        <DescriptionEditor
          ref={descriptionEditor}
          markdown=""
          onChange={(markdown) => {
            description.current = markdown
          }}
          className="[&_.tiptap]:min-h-16"
          testId="dependent-issue-description"
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3">
        <StatusPicker
          value={status}
          onChange={setStatus}
          triggerProps={{
            render: (
              <Button
                variant="outline"
                size="xs"
                className={PROPERTY_CHIP}
                aria-label={`Status: ${statusLabel(status)}`}
                data-testid="dependent-issue-status"
                data-status={status}
              />
            ),
          }}
        >
          <StatusIcon status={status} className="size-3.5" />
          {statusLabel(status)}
        </StatusPicker>
        <PriorityPicker
          value={priority}
          onChange={setPriority}
          triggerProps={{
            render: (
              <Button
                variant="outline"
                size="xs"
                className={PROPERTY_CHIP}
                aria-label={`Priority: ${priorityLabel(priority)}`}
                data-testid="dependent-issue-priority"
                data-priority={priority}
              />
            ),
          }}
        >
          <PriorityIcon priority={priority} className="size-3.5" />
          {priority === 0 ? 'Priority' : priorityLabel(priority)}
        </PriorityPicker>
        <ProjectPicker
          value={project ? project.id : null}
          onChange={setProjectId}
          triggerProps={{
            render: (
              <Button
                variant="outline"
                size="xs"
                className={cn(PROPERTY_CHIP, 'max-w-48')}
                aria-label={`Project: ${project?.name ?? 'No project'}`}
                data-testid="dependent-issue-project"
                data-project-id={project?.id}
              />
            ),
          }}
        >
          <FolderIcon className="size-3.5 text-muted-foreground" />
          <span className="min-w-0 truncate" data-path={project ? '' : undefined}>
            {project ? project.name : 'No project'}
          </span>
        </ProjectPicker>
      </div>
      <div
        className="flex min-w-0 items-center gap-1.5 px-4 pb-3 text-xs text-muted-foreground"
        data-testid="dependent-issue-relation"
        data-kind={dialog.kind}
      >
        {dialog.kind === 'blocked-by' ? (
          <FlagIcon className="size-3.5 shrink-0 text-orange-500" />
        ) : (
          <OctagonMinusIcon className="size-3.5 shrink-0 text-red-500" />
        )}
        <span className="shrink-0" data-testid="dependent-issue-relation-label">
          {dialog.kind === 'blocked-by' ? 'Blocking' : 'Blocked by'}
        </span>
        <StatusIcon status={issue.status} className="size-3.5" />
        <span className="shrink-0 tabular-nums" data-testid="dependent-issue-relation-identifier">
          {issueIdentifier(issue.id)}
        </span>
        <span
          className="min-w-0 truncate font-medium text-foreground"
          data-user-text=""
          data-testid="dependent-issue-relation-title"
        >
          {issue.title}
        </span>
      </div>
      <DialogFooter className="m-0 flex-row items-center justify-end gap-4 px-4 py-3 sm:flex-row">
        <Tooltip>
          <TooltipTrigger render={<span className="flex" />}>
            {/* While it cannot create, it is still what the pointer is on, like any other button. */}
            <Button
              size="sm"
              className="disabled:pointer-events-auto"
              disabled={!canCreate}
              onClick={() => void create()}
              data-testid="dependent-issue-create"
            >
              Create
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="flex items-center gap-1">
            <Kbd>⌘</Kbd>
            <Kbd>Enter</Kbd>
            to create the issue
          </TooltipContent>
        </Tooltip>
      </DialogFooter>
    </div>
  )
}

/**
 * The dialog for a new issue with a dependency, as Linear's, opened from the
 * last item of the picker of Blocked by… or Blocking…: a title, a description,
 * a status, a priority and a project, and a line naming the issue the new
 * one is to block, or to be blocked by. Create (⌘ Enter) creates the issue
 * with that dependency, or neither, and closes the dialog; Esc closes it
 * without creating anything. Each time it opens it starts afresh, and the new
 * issue dialog's draft stays as it is.
 */
export function DependentIssueDialogView() {
  const dialog = useAppStore((state) => state.dependentIssueDialog)
  const issue = useAppStore((state) =>
    state.issues.find((candidate) => candidate.id === state.dependentIssueDialog?.issueId),
  )
  const closeDependentIssue = useAppStore((state) => state.closeDependentIssue)
  const open = dialog !== null && issue !== undefined
  const title = useRef<HTMLTextAreaElement>(null)
  // Kept while the dialog fades out after it closes; a form of its own each time it opens.
  const [shown, setShown] = useState<{
    dialog: DependentIssueDialog
    issue: Issue
    opening: number
  } | null>(null)
  if (open && (shown?.dialog !== dialog || shown.issue !== issue)) {
    const opening = shown?.dialog === dialog ? shown.opening : (shown?.opening ?? 0) + 1
    setShown({ dialog, issue, opening })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeDependentIssue()
      }}
    >
      <DialogContent
        showCloseButton={false}
        initialFocus={title}
        finalFocus={focusAfterOverlay}
        className="top-[max(3.5rem,12vh)] translate-y-0 gap-0 p-0 sm:max-w-2xl"
        data-testid="dependent-issue-dialog"
        data-kind={shown?.dialog.kind}
      >
        {shown && (
          <DependentIssueForm
            key={shown.opening}
            dialog={shown.dialog}
            issue={shown.issue}
            titleRef={title}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

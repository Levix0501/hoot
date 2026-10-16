import { FolderIcon } from 'lucide-react'
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import {
  issueTitle,
  type Issue,
  type IssuePriority,
  type IssueStatus,
} from '../../../shared/issues'
import { priorityLabel, statusLabel } from '../../lib/issue-properties'
import type { ProjectChoice } from '../../lib/project-choices'
import { cn } from '../../lib/utils'
import { useAppStore } from '../../store/app-store'
import { Button } from '../ui/button'
import { Kbd } from '../ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { DescriptionEditor, type DescriptionEditorHandle } from './description-editor'
import { PriorityIcon, StatusIcon } from './issue-icons'
import { PriorityPicker, ProjectPicker, StatusPicker } from './property-picker'
import { TitleField } from './title-field'

/** The small rounded buttons of the properties, under the description. */
const PROPERTY_CHIP = 'rounded-full'

export interface SubIssueCardHandle {
  /** Puts the keyboard focus in the title. */
  focus(): void
}

/**
 * Linear's card for a new sub-issue, in an issue's sub-issues section: a
 * title, a description, a status (Backlog), and the parent's priority and
 * project, which can be changed. Create (⌘ Enter) creates the sub-issue and
 * closes the card; ⌘⇧ Enter creates it and keeps the card for the next one,
 * with the same status, priority and project. Cancel or Esc closes it. What
 * is entered is the card's own: the new issue dialog's draft stays as it is.
 */
export function SubIssueCard({
  parent,
  onClose,
  ref,
}: {
  parent: Issue
  onClose(): void
  ref?: Ref<SubIssueCardHandle>
}) {
  const createSubIssue = useAppStore((state) => state.createSubIssue)
  const projects = useAppStore((state) => state.projects)
  const [title, setTitle] = useState('')
  const [status, setStatus] = useState<IssueStatus>('backlog')
  const [priority, setPriority] = useState<IssuePriority>(parent.priority)
  const [projectId, setProjectId] = useState<ProjectChoice>(parent.projectId)
  const [creating, setCreating] = useState(false)
  // A new editor for each sub-issue, since an editor only shows what it starts with.
  const [editorKey, setEditorKey] = useState(0)
  /** The description as typed so far, which the editor hands on as it goes. */
  const description = useRef('')
  const titleField = useRef<HTMLTextAreaElement>(null)
  const descriptionEditor = useRef<DescriptionEditorHandle>(null)
  // Unless it left the list meanwhile.
  const project = projects.find((candidate) => candidate.id === projectId)
  const canCreate = issueTitle(title) !== '' && !creating

  useEffect(() => titleField.current?.focus(), [])
  useImperativeHandle(ref, () => ({ focus: () => titleField.current?.focus() }))

  const create = async (more: boolean) => {
    // What was typed into the description a moment ago.
    descriptionEditor.current?.flush()
    if (!canCreate) return
    setCreating(true)
    try {
      const created = await createSubIssue(parent.id, {
        title,
        description: description.current,
        status,
        priority,
        projectId: project ? project.id : null,
      })
      if (created === null) return
      if (!more) {
        onClose()
        return
      }
      setTitle('')
      description.current = ''
      setEditorKey((key) => key + 1)
      titleField.current?.focus()
    } finally {
      setCreating(false)
    }
  }

  return (
    <div
      className="grid gap-2 rounded-lg border bg-card p-3 text-card-foreground shadow-xs"
      // Before the description's editor, where ⌘ Enter would otherwise break the line.
      onKeyDownCapture={(event) => {
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Enter' && event.metaKey && !event.ctrlKey && !event.altKey) {
          event.preventDefault()
          event.stopPropagation()
          void create(event.shiftKey)
        }
      }}
      onKeyDown={(event) => {
        // Esc in a picker's list closes the list alone, which is not in the card.
        if (event.key !== 'Escape' || event.nativeEvent.isComposing || event.defaultPrevented)
          return
        if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return
        // And keeps it from taking the page back to the list.
        event.preventDefault()
        onClose()
      }}
      data-testid="sub-issue-card"
    >
      <TitleField
        ref={titleField}
        value={title}
        onChange={setTitle}
        onEnter={() => descriptionEditor.current?.focus()}
        placeholder="Issue title"
        aria-label="Title"
        className="text-sm font-medium md:text-sm"
        data-user-text=""
        data-testid="sub-issue-card-title"
      />
      <DescriptionEditor
        key={editorKey}
        ref={descriptionEditor}
        markdown=""
        onChange={(markdown) => {
          description.current = markdown
        }}
        className="text-sm [&_.tiptap]:min-h-6"
        testId="sub-issue-card-description"
      />
      <div className="flex flex-wrap items-center gap-1.5">
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
                data-testid="sub-issue-card-status"
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
                data-testid="sub-issue-card-priority"
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
                data-testid="sub-issue-card-project"
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
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={onClose} data-testid="sub-issue-card-cancel">
          Cancel
        </Button>
        <Tooltip>
          <TooltipTrigger render={<span className="flex" />}>
            {/* While it cannot create, it is still what the pointer is on, like any other button. */}
            <Button
              size="sm"
              className="disabled:pointer-events-auto"
              disabled={!canCreate}
              onClick={() => void create(false)}
              data-testid="sub-issue-card-create"
            >
              Create
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="grid justify-items-start gap-1">
            <span className="flex items-center gap-1">
              <Kbd>⌘</Kbd>
              <Kbd>Enter</Kbd>
              to create the sub-issue
            </span>
            <span className="flex items-center gap-1">
              <Kbd>⌘</Kbd>
              <Kbd>⇧</Kbd>
              <Kbd>Enter</Kbd>
              to create it and another
            </span>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

import { FolderIcon, Maximize2Icon, Minimize2Icon, XIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import { issueTitle } from '../../../shared/issues'
import { priorityLabel, statusLabel } from '../../lib/issue-properties'
import { cn } from '../../lib/utils'
import { focusAfterOverlay, useAppStore } from '../../store/app-store'
import { Button } from '../ui/button'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTitle } from '../ui/dialog'
import { Kbd } from '../ui/kbd'
import { Label } from '../ui/label'
import { Switch } from '../ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { DescriptionEditor, type DescriptionEditorHandle } from './description-editor'
import { PriorityIcon, StatusIcon } from './issue-icons'
import { PriorityPicker, ProjectPicker, StatusPicker } from './property-picker'
import { TitleField } from './title-field'

/** The small rounded buttons of the properties, under the description. */
const PROPERTY_CHIP = 'rounded-full'

/**
 * Linear's new issue dialog: a title, a description, a status, a priority
 * and a project, or none. There is one draft, wherever the dialog opens: what
 * is entered stays when the dialog closes, until the issue is created. ⌘
 * Enter creates the issue and ⌘⌥ Enter creates it and shows it; with Create
 * more on, the dialog stays for the next issue.
 */
export function NewIssueDialog() {
  const open = useAppStore((state) => state.newIssueDialogOpen)
  const draft = useAppStore((state) => state.newIssueDraft)
  const project = useAppStore((state) =>
    state.projects.find(({ id }) => id === state.newIssueDraft.projectId),
  )
  const createMore = useAppStore((state) => state.createMore)
  const setCreateMore = useAppStore((state) => state.setCreateMore)
  const updateNewIssueDraft = useAppStore((state) => state.updateNewIssueDraft)
  const createIssue = useAppStore((state) => state.createIssue)
  const closeNewIssue = useAppStore((state) => state.closeNewIssue)
  const [expanded, setExpanded] = useState(false)
  const [creating, setCreating] = useState(false)
  // A new editor for each issue, since an editor only shows what it starts with.
  const [editorKey, setEditorKey] = useState(0)
  const title = useRef<HTMLTextAreaElement>(null)
  const description = useRef<DescriptionEditorHandle>(null)
  const canCreate = issueTitle(draft.title) !== '' && !creating

  const create = async (andShow: boolean) => {
    if (!canCreate) return
    // What was typed into the description a moment ago.
    description.current?.flush()
    setCreating(true)
    try {
      const created = await createIssue({ open: andShow })
      if (created !== null && useAppStore.getState().newIssueDialogOpen) {
        setEditorKey((key) => key + 1)
        title.current?.focus()
      }
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeNewIssue()
      }}
    >
      <DialogContent
        showCloseButton={false}
        initialFocus={title}
        finalFocus={focusAfterOverlay}
        className={cn(
          // Below the window's top row, whose blank parts drag the window.
          'top-[max(3.5rem,12vh)] translate-y-0 gap-0 p-0 sm:max-w-2xl',
          expanded && 'sm:max-w-4xl',
        )}
        // Before the description's editor, where ⌘ Enter would otherwise break the line.
        onKeyDownCapture={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Enter' && event.metaKey && !event.ctrlKey && !event.shiftKey) {
            event.preventDefault()
            event.stopPropagation()
            void create(event.altKey)
          }
        }}
        data-testid="new-issue-dialog"
      >
        <div className="flex items-center gap-1 px-4 pt-3">
          <DialogTitle className="min-w-0 text-sm font-normal" data-testid="new-issue-heading">
            New issue
          </DialogTitle>
          <div className="flex-1" />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={expanded ? 'Collapse' : 'Expand'}
                  onClick={() => setExpanded((value) => !value)}
                  data-testid="new-issue-expand"
                />
              }
            >
              {expanded ? <Minimize2Icon /> : <Maximize2Icon />}
            </TooltipTrigger>
            <TooltipContent side="bottom">{expanded ? 'Collapse' : 'Expand'}</TooltipContent>
          </Tooltip>
          <DialogClose
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Close"
                data-testid="new-issue-close"
              />
            }
          >
            <XIcon />
          </DialogClose>
        </div>
        <div
          className={cn(
            'grid min-h-0 content-start gap-2 overflow-y-auto px-4 pt-3 pb-3',
            expanded ? 'max-h-[60vh]' : 'max-h-[min(40vh,22rem)]',
          )}
        >
          <TitleField
            ref={title}
            value={draft.title}
            onChange={(value) => updateNewIssueDraft({ title: value })}
            onEnter={() => description.current?.focus()}
            placeholder="Issue title"
            aria-label="Title"
            className="text-lg font-semibold md:text-lg"
            data-user-text=""
            data-testid="new-issue-title"
          />
          <DescriptionEditor
            key={editorKey}
            ref={description}
            markdown={draft.description}
            onChange={(markdown) => updateNewIssueDraft({ description: markdown })}
            className={expanded ? '[&_.tiptap]:min-h-64' : '[&_.tiptap]:min-h-16'}
            testId="new-issue-description"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3">
          <StatusPicker
            value={draft.status}
            onChange={(status) => updateNewIssueDraft({ status })}
            triggerProps={{
              render: (
                <Button
                  variant="outline"
                  size="xs"
                  className={PROPERTY_CHIP}
                  aria-label={`Status: ${statusLabel(draft.status)}`}
                  data-testid="new-issue-status"
                  data-status={draft.status}
                />
              ),
            }}
          >
            <StatusIcon status={draft.status} className="size-3.5" />
            {statusLabel(draft.status)}
          </StatusPicker>
          <PriorityPicker
            value={draft.priority}
            onChange={(priority) => updateNewIssueDraft({ priority })}
            triggerProps={{
              render: (
                <Button
                  variant="outline"
                  size="xs"
                  className={PROPERTY_CHIP}
                  aria-label={`Priority: ${priorityLabel(draft.priority)}`}
                  data-testid="new-issue-priority"
                  data-priority={draft.priority}
                />
              ),
            }}
          >
            <PriorityIcon priority={draft.priority} className="size-3.5" />
            {draft.priority === 0 ? 'Priority' : priorityLabel(draft.priority)}
          </PriorityPicker>
          <ProjectPicker
            value={project ? project.id : null}
            onChange={(projectId) => updateNewIssueDraft({ projectId })}
            triggerProps={{
              render: (
                <Button
                  variant="outline"
                  size="xs"
                  className={cn(PROPERTY_CHIP, 'max-w-48')}
                  aria-label={`Project: ${project?.name ?? 'No project'}`}
                  data-testid="new-issue-project"
                  data-project-id={project?.id}
                />
              ),
            }}
          >
            <FolderIcon className="size-3.5 text-muted-foreground" />
            <span className="min-w-0 truncate" data-path={project ? '' : undefined}>
              {project ? project.name : 'Project'}
            </span>
          </ProjectPicker>
        </div>
        <DialogFooter className="m-0 flex-row items-center justify-end gap-4 px-4 py-3 sm:flex-row">
          <div className="flex items-center gap-2">
            <Switch
              id="new-issue-create-more"
              checked={createMore}
              onCheckedChange={setCreateMore}
              size="sm"
              data-testid="new-issue-create-more"
            />
            <Label htmlFor="new-issue-create-more" className="font-normal text-muted-foreground">
              Create more
            </Label>
          </div>
          <Tooltip>
            <TooltipTrigger render={<span className="flex" />}>
              {/* While it cannot create, it is still what the pointer is on, like any other button. */}
              <Button
                size="sm"
                className="disabled:pointer-events-auto"
                disabled={!canCreate}
                onClick={() => void create(false)}
                data-testid="new-issue-create"
              >
                Create issue
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="grid justify-items-start gap-1">
              <span className="flex items-center gap-1">
                <Kbd>⌘</Kbd>
                <Kbd>Enter</Kbd>
                to create the issue
              </span>
              <span className="flex items-center gap-1">
                <Kbd>⌘</Kbd>
                <Kbd>⌥</Kbd>
                <Kbd>Enter</Kbd>
                to create it and open it
              </span>
            </TooltipContent>
          </Tooltip>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

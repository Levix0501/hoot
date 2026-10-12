import { ChevronRightIcon, Maximize2Icon, Minimize2Icon, XIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import { issueTitle } from '../../../shared/issues'
import { priorityLabel, statusLabel } from '../../lib/issue-properties'
import { cn } from '../../lib/utils'
import { emptyNewIssueDraft, focusAfterOverlay, useAppStore } from '../../store/app-store'
import { Button } from '../ui/button'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTitle } from '../ui/dialog'
import { Kbd } from '../ui/kbd'
import { Label } from '../ui/label'
import { Switch } from '../ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { DescriptionEditor, type DescriptionEditorHandle } from './description-editor'
import { PriorityIcon, StatusIcon } from './issue-icons'
import { PriorityPicker, StatusPicker } from './property-picker'
import { TitleField } from './title-field'

/** The small rounded buttons of the properties, under the description. */
const PROPERTY_CHIP = 'rounded-full'

/**
 * Linear's new issue dialog, for the project of the Issues page shown: a
 * title, a description, a status and a priority. What is entered stays when
 * the dialog closes, until the issue is created. ⌘ Enter creates the issue
 * and ⌘⌥ Enter creates it and shows it; with Create more on, the dialog
 * stays for the next issue.
 */
export function NewIssueDialog() {
  const dialog = useAppStore((state) => state.newIssueDialog)
  // Kept while the dialog fades out.
  const [projectId, setProjectId] = useState<number | null>(null)
  if (dialog !== null && dialog.projectId !== projectId) setProjectId(dialog.projectId)
  const project = useAppStore((state) => state.projects.find(({ id }) => id === projectId))
  const draft = useAppStore((state) =>
    projectId === null
      ? emptyNewIssueDraft
      : (state.newIssueDrafts[projectId] ?? emptyNewIssueDraft),
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

  const update = (changes: Parameters<typeof updateNewIssueDraft>[1]) => {
    if (projectId !== null) updateNewIssueDraft(projectId, changes)
  }

  const create = async (open: boolean) => {
    if (projectId === null || !canCreate) return
    // What was typed into the description a moment ago.
    description.current?.flush()
    setCreating(true)
    try {
      const created = await createIssue(projectId, { open })
      if (created !== null && useAppStore.getState().newIssueDialog !== null) {
        setEditorKey((key) => key + 1)
        title.current?.focus()
      }
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog
      open={dialog !== null}
      onOpenChange={(open) => {
        if (!open) closeNewIssue()
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
        data-project-id={projectId ?? undefined}
      >
        <div className="flex items-center gap-1 px-4 pt-3">
          <DialogTitle className="flex min-w-0 items-center gap-1.5 text-sm font-normal">
            <span
              className="min-w-0 truncate rounded-md border px-1.5 py-0.5 text-xs font-medium text-muted-foreground"
              title={project?.root}
              data-path=""
              data-testid="new-issue-project"
            >
              {project?.name}
            </span>
            <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="shrink-0">New issue</span>
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
            onChange={(value) => update({ title: value })}
            onEnter={() => description.current?.focus()}
            placeholder="Issue title"
            aria-label="Title"
            className="text-lg font-semibold md:text-lg"
            data-user-text=""
            data-testid="new-issue-title"
          />
          <DescriptionEditor
            key={`${projectId}-${editorKey}`}
            ref={description}
            markdown={draft.description}
            onChange={(markdown) => update({ description: markdown })}
            className={expanded ? '[&_.tiptap]:min-h-64' : '[&_.tiptap]:min-h-16'}
            testId="new-issue-description"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3">
          <StatusPicker
            value={draft.status}
            onChange={(status) => update({ status })}
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
            onChange={(priority) => update({ priority })}
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

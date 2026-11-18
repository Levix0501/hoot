import { ChevronRightIcon, FolderIcon, XIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import { issueTitle } from '../../../shared/issues'
import { priorityLabel, statusLabel } from '../../lib/issue-properties'
import { focusAfterOverlay, useAppStore } from '../../store/app-store'
import { Button } from '../ui/button'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '../ui/dialog'
import { Kbd, KbdGroup } from '../ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { DescriptionEditor, type DescriptionEditorHandle } from './description-editor'
import { PriorityIcon, StatusIcon } from './issue-icons'
import { PriorityPicker, ProjectPicker, StatusPicker } from './property-picker'
import { TitleField } from './title-field'

/** The small rounded buttons of the status and the priority, in the footer. */
const PROPERTY_CHIP = 'rounded-full px-2.5'

/**
 * Linear's new issue dialog: the project the issue goes to over a page with
 * its title and its description, which has block handles, and its status and
 * priority beside the button that creates it. There is one draft, wherever
 * the dialog opens: what is entered stays when the dialog closes, until the
 * issue is created. ⌘ Enter creates the issue and ⌘⌥ Enter creates it and
 * shows it.
 */
export function NewIssueDialog() {
  const open = useAppStore((state) => state.newIssueDialogOpen)
  const draft = useAppStore((state) => state.newIssueDraft)
  const project = useAppStore((state) =>
    state.projects.find(({ id }) => id === state.newIssueDraft.projectId),
  )
  const updateNewIssueDraft = useAppStore((state) => state.updateNewIssueDraft)
  const createIssue = useAppStore((state) => state.createIssue)
  const closeNewIssue = useAppStore((state) => state.closeNewIssue)
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
      // Also when the dialog opens again while it is still fading out.
      if (created !== null) setEditorKey((key) => key + 1)
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
        // Below the window's top row, whose blank parts drag the window; the same height whatever is written.
        className="top-[max(3rem,7vh)] flex h-[min(80vh,720px)] translate-y-0 flex-col gap-0 overflow-hidden p-0 shadow-2xl sm:max-w-3xl"
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
        <div className="flex shrink-0 items-center gap-1 pt-3 pr-3 pl-4">
          <ProjectPicker
            value={project ? project.id : null}
            onChange={(projectId) => updateNewIssueDraft({ projectId })}
            triggerProps={{
              render: (
                <Button
                  variant="secondary"
                  size="xs"
                  className="max-w-56 gap-1.5 rounded-md px-1.5 font-normal"
                  aria-label={`Project: ${project?.name ?? 'No project'}`}
                  data-testid="new-issue-project"
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
          <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <DialogTitle className="min-w-0 text-[13px] font-normal" data-testid="new-issue-heading">
            New issue
          </DialogTitle>
          <div className="flex-1" />
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
          className="min-h-0 flex-1 cursor-text overflow-y-auto pt-5 pr-10 pb-6 pl-14"
          // A press around the text writes in the title beside it, or at the description's end under it.
          onMouseDown={(event) => {
            if (event.target !== event.currentTarget) return
            const field = title.current
            const editor = event.currentTarget.querySelector('.notra-editor')
            if (field && event.clientY <= field.getBoundingClientRect().bottom) {
              event.preventDefault()
              field.focus()
            } else if (editor && event.clientY > editor.getBoundingClientRect().bottom) {
              event.preventDefault()
              description.current?.focus('end')
            }
          }}
        >
          <TitleField
            ref={title}
            value={draft.title}
            onChange={(value) => updateNewIssueDraft({ title: value })}
            onEnter={() => description.current?.focus()}
            placeholder="Issue title"
            aria-label="Title"
            className="text-2xl leading-tight font-semibold md:text-2xl"
            data-user-text=""
            data-testid="new-issue-title"
          />
          <DescriptionEditor
            key={editorKey}
            ref={description}
            markdown={draft.description}
            onChange={(markdown) => updateNewIssueDraft({ description: markdown })}
            placeholder="Press / to insert blocks"
            blockHandle
            className="mt-4 [&_.tiptap]:min-h-40"
            testId="new-issue-description"
          />
        </div>
        <div className="flex shrink-0 items-center gap-1.5 border-t px-4 py-3">
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
          <div className="flex-1" />
          <KbdGroup aria-hidden className="mr-1.5">
            <Kbd>⌘</Kbd>
            <Kbd>↵</Kbd>
          </KbdGroup>
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
        </div>
      </DialogContent>
    </Dialog>
  )
}

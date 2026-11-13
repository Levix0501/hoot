import { ArrowUpIcon, FolderIcon } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { issueTitle } from '../../../shared/issues'
import { currentSessionId, useAppStore } from '../../store/app-store'
import { Button } from '../ui/button'
import { Kbd, KbdGroup } from '../ui/kbd'
import { DescriptionEditor, type DescriptionEditorHandle } from './description-editor'
import { ProjectPicker } from './property-picker'
import { TitleField } from './title-field'

/** What is written in the note and not yet made an issue, kept while the window is closed. */
let draft = { title: '', description: '' }

/** Whether the note takes the keyboard focus once it shows. */
let focusOnShow = false

/** Has the note take the keyboard focus once it shows, as when the window is opened by hand. */
export function focusNoteOnShow(): void {
  focusOnShow = true
}

/** notra-editor's `/` menu, while it is open. */
const SLASH_MENU = '[data-notra-slash-menu]'

/** The project of what the main area shows: a session's, or an issue's; `null` for none. */
function useShownProjectId(): number | null {
  return useAppStore((state) => {
    const page = state.currentPage
    if (page?.kind === 'issue') {
      return state.issues.find((issue) => issue.id === page.issueId)?.projectId ?? null
    }
    const id = currentSessionId(state)
    const session = state.sessions.find((entry) => entry.id === id)
    if (!session || session.chatId !== null) return null
    return state.projects.find((project) => project.root === session.projectRoot)?.id ?? null
  })
}

/** Whether a key went to a description's editor that holds nothing but an empty paragraph. */
function inEmptyDescription(target: EventTarget): boolean {
  if (!(target instanceof Element) || !target.classList.contains('notra-content')) return false
  return (
    target.childElementCount === 1 &&
    target.firstElementChild?.tagName === 'P' &&
    target.textContent === ''
  )
}

/**
 * The note at the bottom of the Issues window, a box shaped as a chat's
 * composer. Its big title takes plain text, as the new issue dialog's does;
 * Enter goes on to the description, at least two lines high, whose
 * placeholder says that `/` inserts blocks while the cursor is in it, as
 * Notion's pages do, and Backspace at the start of an empty description goes
 * back to the title. Under them are the project, ⌘ Enter and the button that
 * creates the issue: in the project of what the main area shows unless
 * another is picked, which the next issues keep. The note then empties for
 * the next one. Esc in the text calls `onEscape`, unless it closes the `/` menu.
 */
export function IssueNote({ onEscape }: { onEscape(): void }) {
  const shownProject = useShownProjectId()
  const noteIssue = useAppStore((state) => state.noteIssue)
  /** The project picked by hand, which the next issues keep; `undefined` follows the main area. */
  const [picked, setPicked] = useState<number | null | undefined>(undefined)
  const project = useAppStore((state) => {
    const id = picked === undefined ? shownProject : picked
    return state.projects.find((entry) => entry.id === id) ?? null
  })
  const [title, setTitle] = useState(draft.title)
  const [autoFocus] = useState(() => {
    const focus = focusOnShow
    focusOnShow = false
    return focus
  })
  // A new editor for each issue, since an editor only shows what it starts with.
  const [editorKey, setEditorKey] = useState(0)
  const titleField = useRef<HTMLTextAreaElement>(null)
  const description = useRef<DescriptionEditorHandle>(null)
  const canCreate = issueTitle(title) !== ''
  // What the editor shown writes to: one going away once its issue is made writes to the old draft.
  const shownDraft = draft

  // With the cursor after what was written before.
  useLayoutEffect(() => {
    const field = titleField.current
    if (autoFocus && field) field.setSelectionRange(field.value.length, field.value.length)
  }, [autoFocus])

  const create = async () => {
    // What was typed into the description a moment ago.
    description.current?.flush()
    if (!canCreate) return
    const created = await noteIssue({
      title: issueTitle(title),
      description: draft.description.trim(),
      projectId: project?.id ?? null,
      status: 'backlog',
      priority: 0,
    })
    if (created === null) return
    draft = { title: '', description: '' }
    setTitle('')
    setEditorKey((key) => key + 1)
    titleField.current?.focus()
  }

  // Before the title and the editor, where ⌘ Enter would otherwise break the line.
  const onKeyDownCapture = (event: React.KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter' && event.metaKey && !event.ctrlKey && !event.shiftKey) {
      event.preventDefault()
      event.stopPropagation()
      void create()
      return
    }
    // Only what goes to the text itself, not to a menu or a field of the editor's toolbar.
    const inText =
      event.target === titleField.current ||
      (event.target instanceof Element && event.target.classList.contains('notra-content'))
    if (!inText) return
    if (event.key === 'Escape' && document.querySelector(SLASH_MENU) === null) {
      event.preventDefault()
      event.stopPropagation()
      onEscape()
    } else if (
      event.key === 'Backspace' &&
      !event.metaKey &&
      !event.altKey &&
      inEmptyDescription(event.target)
    ) {
      event.preventDefault()
      event.stopPropagation()
      const field = titleField.current
      field?.focus()
      field?.setSelectionRange(field.value.length, field.value.length)
    }
  }

  return (
    <div className="shrink-0 px-2 pt-1 pb-2">
      <div
        className="flex flex-col rounded-[25px] bg-background shadow-[0_0_0_1px_#0000000a,0_2px_8px_0_#0000000a,0_4px_80px_8px_#00000006] [corner-shape:superellipse(1.5)] dark:bg-white/4.5 dark:shadow-[inset_0_0_1px_0_#fff3]"
        // A press around the text, rather than on it or on a control, writes in it.
        onMouseDown={(event) => {
          const text = event.currentTarget.firstElementChild
          if (event.target !== event.currentTarget && event.target !== text) return
          event.preventDefault()
          const field = titleField.current
          if (field && event.clientY <= field.getBoundingClientRect().bottom) {
            field.focus()
          } else {
            description.current?.focus('end')
          }
        }}
        data-testid="issue-note-box"
      >
        <div
          className="mb-3 grid max-h-48 cursor-text content-start gap-1 overflow-y-auto px-3 pt-3.5"
          onKeyDownCapture={onKeyDownCapture}
        >
          <TitleField
            ref={titleField}
            value={title}
            onChange={(value) => {
              draft.title = value
              setTitle(value)
            }}
            onEnter={() => description.current?.focus()}
            placeholder="New issue"
            aria-label="Title"
            autoFocus={autoFocus}
            className="text-base leading-6 font-semibold tracking-[-0.005em] md:text-base"
            data-user-text=""
            data-testid="issue-note-title"
          />
          <DescriptionEditor
            key={editorKey}
            ref={description}
            markdown={draft.description}
            onChange={(markdown) => {
              shownDraft.description = markdown
            }}
            placeholder="Press / to insert blocks"
            className="issue-note min-h-10 [&_.tiptap]:min-h-10"
            testId="issue-note"
          />
        </div>
        <div className="mb-2 flex items-center gap-2 px-2">
          <ProjectPicker
            value={project?.id ?? null}
            onChange={setPicked}
            triggerProps={{
              render: (
                <Button
                  variant="ghost"
                  className="h-7 max-w-44 gap-1.5 rounded-full px-2 text-[13px] font-normal text-muted-foreground [&>svg:last-child]:size-3.5 [&>svg:last-child]:text-current"
                  aria-label={`Project: ${project?.name ?? 'No project'}`}
                  data-testid="issue-note-project"
                />
              ),
            }}
          >
            <FolderIcon className="size-4" />
            <span className="min-w-0 truncate" data-path={project ? '' : undefined}>
              {project ? project.name : 'No project'}
            </span>
          </ProjectPicker>
          <div className="flex-1" />
          <KbdGroup aria-hidden>
            <Kbd>⌘</Kbd>
            <Kbd>↵</Kbd>
          </KbdGroup>
          <Button
            size="icon-sm"
            className="rounded-full border-0"
            disabled={!canCreate}
            aria-label="Create issue"
            aria-keyshortcuts="Meta+Enter"
            onClick={() => void create()}
            data-testid="issue-note-create"
          >
            <ArrowUpIcon />
          </Button>
        </div>
      </div>
    </div>
  )
}

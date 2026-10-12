import { Selection } from '@tiptap/pm/state'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type Ref,
} from 'react'
import { browserLink } from '../../../shared/links'
import { api } from '../../lib/api'
import { cn } from '../../lib/utils'
import { onFlushIssueEdits } from '../../store/app-store'
import { descriptionExtensions } from './description-extensions'

/** How long typing pauses before what was typed is handed on. */
const SETTLE_MS = 300

export interface DescriptionEditorHandle {
  /** Puts the keyboard focus at the start of the description. */
  focus(): void
  /** Hands on what was typed and not handed on yet. */
  flush(): void
}

/**
 * Opens the link a click is on, if any: an http or https one in the default
 * browser, any other nowhere. The window itself never follows a link.
 */
function openLink(event: MouseEvent): boolean {
  const link = event.target instanceof Element ? event.target.closest('a[href]') : null
  if (link === null) return false
  event.preventDefault()
  const target = browserLink(link.getAttribute('href') ?? '')
  if (target !== null) api.openExternalLink(target)
  return true
}

/**
 * An issue's description, edited in place as Linear's are: formatted as it
 * is typed (`# `, `- `, `[ ] ` and the like), and kept as GitHub Flavored
 * Markdown. What is typed is handed to `onChange` as Markdown once typing
 * pauses, when the editor loses the focus or goes away, and before an issue
 * is sent to Claude Code; never just for showing the description.
 */
export function DescriptionEditor({
  markdown,
  onChange,
  placeholder = 'Add description…',
  escapeBlurs = false,
  className,
  testId,
  ref,
}: {
  /** What the editor starts with; later changes to it are not shown. */
  markdown: string
  onChange(markdown: string): void
  placeholder?: string
  /** Whether Esc takes the focus out of the editor, instead of reaching the dialog it is in. */
  escapeBlurs?: boolean
  /** Classes of the element around the editor; `[&_.tiptap]:` ones reach the editor itself. */
  className?: string
  testId: string
  ref?: Ref<DescriptionEditorHandle>
}) {
  const onChangeRef = useRef(onChange)
  const escapeBlursRef = useRef(escapeBlurs)
  useEffect(() => {
    onChangeRef.current = onChange
    escapeBlursRef.current = escapeBlurs
  })
  /** The Markdown last handed on, or that the editor started with. */
  const baseline = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const editorRef = useRef<Editor | null>(null)

  const flush = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = undefined
    const editor = editorRef.current
    if (editor === null || editor.isDestroyed || baseline.current === null) return
    const typed = editor.getMarkdown()
    if (typed === baseline.current) return
    baseline.current = typed
    onChangeRef.current(typed)
  }, [])

  const editor = useEditor(
    {
      extensions: descriptionExtensions(placeholder),
      content: markdown,
      contentType: 'markdown',
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: {
          class: cn(
            'prose prose-sm max-w-none break-words prose-neutral outline-none dark:prose-invert',
            // Code in the interface's colors, inline code without backticks around it.
            'prose-pre:bg-muted prose-pre:text-foreground prose-code:font-normal',
            'prose-code:before:content-none prose-code:after:content-none',
            '[&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-muted [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-0.5',
            // Lists as tight as Linear's, though each item is a paragraph.
            'prose-li:my-0.5 [&_li>p]:my-0',
          ),
          'aria-label': 'Description',
          'data-testid': testId,
          'data-user-text': '',
        },
        handleClick: (_view, _position, event) => openLink(event),
        handleDOMEvents: {
          // A middle click on a link opens nothing either.
          auxclick: (_view, event) => openLink(event),
        },
        handleKeyDown: (view, event) => {
          // ⌘B makes text bold here, rather than hiding the sidebar.
          if (event.metaKey && event.key.toLowerCase() === 'b') event.stopPropagation()
          if (event.key === 'Escape' && escapeBlursRef.current && !event.isComposing) {
            view.dom.blur()
            return true
          }
          return false
        },
      },
      onCreate: ({ editor: created }) => {
        baseline.current = created.getMarkdown()
      },
      onUpdate: () => {
        clearTimeout(timer.current)
        timer.current = setTimeout(flush, SETTLE_MS)
      },
      onBlur: flush,
    },
    [],
  )

  useEffect(() => {
    editorRef.current = editor
  }, [editor])

  // Before the editor goes, which happens after the layout effects are cleaned up.
  useLayoutEffect(() => flush, [flush])

  useEffect(() => {
    window.addEventListener('pagehide', flush)
    const unregister = onFlushIssueEdits(flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      unregister()
    }
  }, [flush])

  useImperativeHandle(ref, () => ({
    focus: () => {
      if (!editor) return
      // Not with the focus command, which waits for the next frame: keys typed meanwhile would go astray.
      const { state, view } = editor
      view.dispatch(state.tr.setSelection(Selection.atStart(state.doc)).scrollIntoView())
      view.focus()
    },
    flush,
  }))

  return <EditorContent editor={editor} className={cn('min-w-0', className)} />
}

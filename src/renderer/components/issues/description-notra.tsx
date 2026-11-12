import 'notra-editor/styles.css'
import '../files/markdown-editor.css'
import './description-editor.css'
import { Extension } from '@tiptap/core'
import { Selection } from '@tiptap/pm/state'
import { useEditor, type Editor } from '@tiptap/react'
import {
  NotraEditorView,
  createDictionary,
  createNotraExtensions,
  markdownFeatures,
} from 'notra-editor'
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react'
import { browserLink } from '../../../shared/links'
import { api } from '../../lib/api'
import { cn } from '../../lib/utils'
import { onFlushIssueEdits } from '../../store/app-store'
import type { DescriptionEditorProps } from './description-editor'
import { openLink } from './markdown'

/** How long typing pauses before what was typed is handed on. */
const SETTLE_MS = 300

/**
 * What a description holds: what GitHub Flavored Markdown keeps, without
 * underlines, which it cannot keep, and without pictures for now.
 */
const FEATURES = { ...markdownFeatures, underline: false, image: false }

/** notra-editor's `/` menu, while it is open. */
const SLASH_MENU = '[data-notra-slash-menu]'

/** Markdown has no underline, which ⌘U would otherwise make. */
const NoUnderline = Extension.create({
  name: 'noUnderline',
  addKeyboardShortcuts: () => ({ 'Mod-u': () => true }),
})

/**
 * The editor of `DescriptionEditor`. Blocks still as they were loaded are
 * written back as the description had them, so that only what is edited
 * changes. Links open in the default browser when clicked, and from the
 * toolbar over them.
 */
export default function DescriptionNotra({
  markdown,
  onChange,
  placeholder = 'Add description…',
  escapeBlurs = false,
  className,
  testId,
  ref,
}: DescriptionEditorProps) {
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
      extensions: [
        ...createNotraExtensions({
          dictionary: createDictionary(),
          placeholder,
          features: FEATURES,
          markdown: { preserveSource: true },
          onLinkClick: (href) => {
            const target = browserLink(href)
            if (target !== null) api.openExternalLink(target)
            return true
          },
        }),
        NoUnderline,
        // After the editor's own keys, so that Esc closes its menus first.
        Extension.create({
          name: 'escapeBlurs',
          priority: 0,
          addKeyboardShortcuts: () => ({
            Escape: ({ editor: current }) => {
              if (!escapeBlursRef.current) return false
              current.view.dom.blur()
              return true
            },
          }),
        }),
      ],
      content: markdown,
      contentType: 'markdown',
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: {
          // The class notra-editor's styles format the document under.
          class: 'notra-content',
          'aria-label': 'Description',
          'data-testid': testId,
          'data-user-text': '',
        },
        handleClick: (_view, _position, event) => openLink(event),
        handleDOMEvents: {
          // A middle click on a link opens nothing either.
          auxclick: (_view, event) => openLink(event),
        },
        handleKeyDown: (_view, event) => {
          // ⌘B makes text bold here, rather than hiding the sidebar.
          if (event.metaKey && event.key.toLowerCase() === 'b') event.stopPropagation()
          // Esc in the `/` menu closes the menu, and not the dialog the editor is in.
          if (event.key === 'Escape' && document.querySelector(SLASH_MENU) !== null) {
            event.stopPropagation()
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

  return (
    <NotraEditorView
      editor={editor}
      blockHandle={false}
      className={cn('issue-description min-w-0', className)}
    />
  )
}

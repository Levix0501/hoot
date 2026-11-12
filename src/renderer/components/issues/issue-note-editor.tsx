import 'notra-editor/styles.css'
import '../files/markdown-editor.css'
import './description-editor.css'
import { Extension } from '@tiptap/core'
import { useEditor, type Editor } from '@tiptap/react'
import {
  NotraEditorView,
  createDictionary,
  createNotraExtensions,
  markdownFeatures,
} from 'notra-editor'
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import { browserLink } from '../../../shared/links'
import { issueTitle, oneLineTitle } from '../../../shared/issues'
import { api } from '../../lib/api'

/** What a note holds: as a description does (see `description-notra`). */
const FEATURES = { ...markdownFeatures, underline: false, image: false }

const NoUnderline = Extension.create({
  name: 'noUnderline',
  addKeyboardShortcuts: () => ({ 'Mod-u': () => true }),
})

/** A note as an issue: its title, and its description as Markdown, which may be empty. */
export interface IssueNote {
  title: string
  description: string
}

export interface IssueNoteEditorHandle {
  /** The issue the note makes, or `null` while it has no text. */
  note(): IssueNote | null
  /** Empties the note, for the next one. */
  clear(): void
  focus(): void
}

/**
 * The issue a note makes. Its first paragraph or heading with text is the
 * title, line breaks and all on one line, and what follows it the
 * description. When the note starts with anything else, such as a list or
 * code, the first line of it is the title, and the description is all of
 * the note, so that nothing written is lost.
 */
function noteOf(editor: Editor): IssueNote | null {
  const { doc } = editor.state
  let index = -1
  for (let i = 0; i < doc.childCount; i++) {
    if (doc.child(i).textContent.trim() !== '') {
      index = i
      break
    }
  }
  if (index === -1) return null
  const block = doc.child(index)
  const text = block.textBetween(0, block.content.size, '\n', '\n')
  const titled = block.type.name === 'paragraph' || block.type.name === 'heading'
  const title = issueTitle(
    oneLineTitle(titled ? text : (text.split('\n').find((line) => line.trim() !== '') ?? '')),
  )
  const rest = []
  for (let i = titled ? index + 1 : index; i < doc.childCount; i++) rest.push(doc.child(i).toJSON())
  const description =
    rest.length === 0 ? '' : (editor.markdown?.serialize({ type: 'doc', content: rest }) ?? '')
  return { title, description: description.trim() }
}

/**
 * The editor of the Issues window's note, in notra-editor as descriptions
 * are, whose first line shows bold as the title it becomes. Each change is
 * handed to `onChange` as Markdown, with whether the note has text. Esc
 * calls `onEscape`, unless one of the editor's menus takes it to close.
 */
export default function IssueNoteEditor({
  initial,
  placeholder,
  autoFocus,
  onChange,
  onEscape,
  ref,
}: {
  /** What the note starts with, as Markdown. */
  initial: string
  placeholder: string
  autoFocus: boolean
  onChange(markdown: string, hasText: boolean): void
  onEscape(): void
  ref?: Ref<IssueNoteEditorHandle>
}) {
  const onChangeRef = useRef(onChange)
  const onEscapeRef = useRef(onEscape)
  useEffect(() => {
    onChangeRef.current = onChange
    onEscapeRef.current = onEscape
  })

  const editor = useEditor(
    {
      extensions: [
        ...createNotraExtensions({
          dictionary: createDictionary(),
          placeholder,
          features: FEATURES,
          onLinkClick: (href) => {
            const target = browserLink(href)
            if (target !== null) api.openExternalLink(target)
            return true
          },
        }),
        NoUnderline,
        // After the editor's own keys, so that Esc closes its menus first. (The
        // editor marks every Esc as taken, so the window cannot tell by that.)
        Extension.create({
          name: 'escapeNote',
          priority: 0,
          addKeyboardShortcuts: () => ({
            Escape: () => {
              onEscapeRef.current()
              return true
            },
          }),
        }),
      ],
      content: initial,
      contentType: 'markdown',
      autofocus: autoFocus ? 'end' : false,
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: {
          // The class notra-editor's styles format the document under.
          class: 'notra-content',
          'aria-label': 'New issue: the first line is its title',
          'data-testid': 'issue-note',
          'data-user-text': '',
        },
        handleKeyDown: (_view, event) => {
          // ⌘B makes text bold here, rather than hiding the sidebar.
          if (event.metaKey && event.key.toLowerCase() === 'b') event.stopPropagation()
          return false
        },
      },
      onUpdate: ({ editor: changed }) =>
        onChangeRef.current(changed.getMarkdown(), changed.state.doc.textContent.trim() !== ''),
    },
    [],
  )

  useImperativeHandle(
    ref,
    () => ({
      note: () => (editor === null ? null : noteOf(editor)),
      clear: () => {
        editor?.commands.clearContent(true)
      },
      focus: () => {
        editor?.commands.focus('end')
      },
    }),
    [editor],
  )

  return (
    <NotraEditorView
      editor={editor}
      blockHandle={false}
      // As tall as the note's box, so that a click anywhere in the box writes in the note.
      className="issue-description issue-note min-w-0 [&_.tiptap]:min-h-10"
    />
  )
}

import 'notra-editor/styles.css'
import './markdown-editor.css'
import { Editor, Extension } from '@tiptap/core'
import {
  NotraEditorView,
  createDictionary,
  createNotraExtensions,
  isPreservingMarkdownSource,
  markdownFeatures,
} from 'notra-editor'
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import {
  entryExtension,
  entryReference,
  folderKey,
  isFolderPath,
  referencedEntry,
  type PanelFolder,
} from '../../../shared/files'
import { browserLink } from '../../../shared/links'
import { api } from '../../lib/api'
import {
  editStateKey,
  focusNextEditor,
  keepEditState,
  registerEditor,
  useFilesStore,
} from '../../store/files-store'
import { Button } from '../ui/button'
import { isSaveShortcut } from './code-views'
import { Notice } from './notice'

/** A Markdown file's preview: its editor, which outlives its tab's being shown, and what it knows. */
interface Preview {
  editor: Editor
  /**
   * Whether the editor could not match the file's Markdown block by block
   * with what it shows: saving would write all of it again, so it only
   * shows the file.
   */
  mismatched: boolean
  /** The addresses of the pictures it shows from the folder, by their path. */
  pictures: Map<string, Promise<string>>
  /** How far it was scrolled when its tab last stopped showing. */
  scrollTop: number
  /** What follows `mismatched`. */
  listeners: Set<() => void>
}

/** The previews kept while their tabs are open, by edit state key (see `editStateKey`). */
const previews = new Map<string, Preview>()

/** What previews edit: what GitHub Flavored Markdown keeps, without underlines, as in issue descriptions. */
const FEATURES = { ...markdownFeatures, underline: false }

/** Markdown has no underline, which ⌘U would otherwise make. */
const NoUnderline = Extension.create({
  name: 'noUnderline',
  addKeyboardShortcuts: () => ({ 'Mod-u': () => true }),
})

/** The schemes of the addresses of pictures shown as they are: on the web, or in the address itself. */
const SHOWN_PICTURE_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:', 'data:', 'blob:'])

/**
 * The address a picture of the document `document` shows from: a picture on
 * the web as it is, and a file of the folder, which `src` refers to as
 * GitHub reads it, from its bytes. Each file is read once for the preview.
 */
function pictureUrl(
  pictures: Map<string, Promise<string>>,
  folder: PanelFolder,
  document: string,
  src: string,
): string | Promise<string> {
  const scheme = /^[A-Za-z][A-Za-z\d+.-]*:/.exec(src)?.[0].toLowerCase()
  if (scheme !== undefined) {
    if (SHOWN_PICTURE_SCHEMES.has(scheme)) return src
    throw new Error(`Pictures at ${scheme} addresses are not shown.`)
  }
  if (src.startsWith('//')) return `https:${src}`
  const file = referencedEntry(document, src)
  if (file === null || isFolderPath(file)) throw new Error(`"${src}" is not a file of the folder.`)
  let url = pictures.get(file)
  if (url === undefined) {
    url = readPicture(folder, file)
    pictures.set(file, url)
  }
  return url
}

/** An address for the picture a file of the folder holds: a picture, or the image an SVG file's text draws. */
async function readPicture(folder: PanelFolder, file: string): Promise<string> {
  const result = await api.readFile(folder, file)
  if (result.kind === 'image') return URL.createObjectURL(new Blob([result.bytes]))
  if (result.kind === 'text' && entryExtension(file) === 'svg') {
    return URL.createObjectURL(new Blob([result.content], { type: 'image/svg+xml' }))
  }
  throw new Error(`"${file}" is not a picture.`)
}

/**
 * Keeps a picture pasted or dropped into the document `document` in the
 * folder, next to the document (see `addFileNextTo`), and gives what the
 * document refers to it with.
 */
async function addPicture(folder: PanelFolder, document: string, file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const result = await api.addFileNextTo(folder, document, file.name, bytes, api.pathForFile(file))
  if (result.kind !== 'added') throw new Error(result.message)
  return entryReference(document, result.file)
}

/**
 * Opens a link of the document `document`: a web address in the default
 * browser, a file of the folder in a tab of the panel. Nothing else opens
 * one, the window not leaving Hoot's page.
 */
function openLink(folder: PanelFolder, document: string, href: string): boolean {
  const url = browserLink(href)
  if (url !== null) {
    api.openExternalLink(url)
    return true
  }
  const file = referencedEntry(document, href)
  if (file !== null && !isFolderPath(file)) useFilesStore.getState().openFile(folder, file, false)
  return true
}

/** Keeps a preview that could not match its file's Markdown from editing it, or lets it again. */
function setMismatched(preview: Preview, mismatched: boolean): void {
  if (preview.mismatched === mismatched) return
  preview.mismatched = mismatched
  const { editor } = preview
  editor.setEditable(!mismatched, false)
  // Its menus, which only show while it is editable, follow it.
  editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false))
  for (const listener of preview.listeners) listener()
}

/**
 * The preview kept under `stateKey`, or a new one of the Markdown file
 * `path`, which holds `text`. Its editor writes the Markdown of what is not
 * edited as the file has it, and reports each change to the panel. It is
 * let go of once its tab no longer needs it (see `keepEditState`).
 */
function openPreview(stateKey: string, folder: PanelFolder, path: string, text: string): Preview {
  const kept = previews.get(stateKey)
  if (kept !== undefined) return kept
  const folderId = folderKey(folder)
  const pictures = new Map<string, Promise<string>>()
  let preview: Preview | undefined
  let mismatchedAtStart = false
  const editor = new Editor({
    content: text,
    contentType: 'markdown',
    extensions: [
      ...createNotraExtensions({
        dictionary: createDictionary(),
        features: FEATURES,
        markdown: {
          preserveSource: true,
          onSourceMismatch: () => {
            if (preview === undefined) mismatchedAtStart = true
            else setMismatched(preview, true)
          },
        },
        resolveImageUrl: (src) => pictureUrl(pictures, folder, path, src),
        uploadImage: (file) => addPicture(folder, path, file),
        onLinkClick: (href) => openLink(folder, path, href),
      }),
      NoUnderline,
    ],
    // The class notra-editor's styles format the document under.
    editorProps: { attributes: { class: 'notra-content' } },
    onUpdate: ({ editor: changed }) =>
      useFilesStore.getState().editorChanged(folderId, path, changed.getMarkdown()),
  })
  preview = { editor, mismatched: false, pictures, scrollTop: 0, listeners: new Set() }
  if (mismatchedAtStart) setMismatched(preview, true)
  previews.set(stateKey, preview)
  keepEditState(stateKey, () => {
    previews.delete(stateKey)
    editor.destroy()
    for (const url of pictures.values()) {
      void url.then(
        (address) => URL.revokeObjectURL(address),
        () => undefined,
      )
    }
  })
  return preview
}

/** Gives a preview the file's new text, as an edit that cannot be undone. */
function takeText(preview: Preview, text: string): void {
  preview.editor.commands.updateContent(text, { contentType: 'markdown', addToHistory: false })
  // Markdown it can match again, it edits again.
  if (preview.mismatched && isPreservingMarkdownSource(preview.editor)) {
    setMismatched(preview, false)
  }
}

/**
 * A Markdown file's preview: its text formatted, edited as it shows, which
 * reports each change as the file's new Markdown (the text of what was not
 * edited stays as the file has it). It shows `initialText` once and then
 * keeps its own text. Its editor, with its caret and its undo history, is
 * kept while another tab is shown, and comes back with the tab. The file's
 * new text, when it changed on disk, goes in as an edit.
 */
function MarkdownEditor({
  folder,
  path,
  generation,
  initialText,
}: {
  folder: PanelFolder
  path: string
  generation: number
  initialText: string
}) {
  const folderId = folderKey(folder)
  const saveNow = useFilesStore((state) => state.saveNow)
  const setTabView = useFilesStore((state) => state.setTabView)
  // The preview takes its file and text once: they stay as they were.
  const [preview] = useState(() =>
    openPreview(editStateKey(folderId, path, generation), folder, path, initialText),
  )
  const subscribe = useCallback(
    (listener: () => void) => {
      preview.listeners.add(listener)
      return () => preview.listeners.delete(listener)
    },
    [preview],
  )
  const mismatched = useSyncExternalStore(subscribe, () => preview.mismatched)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(
    () =>
      registerEditor(folderId, path, {
        getText: () => preview.editor.getMarkdown(),
        takeText: (text) => takeText(preview, text),
        focus: () => preview.editor.commands.focus(null, { scrollIntoView: false }),
      }),
    [folderId, path, preview],
  )

  // It is scrolled back to where it was when its tab shows again.
  useLayoutEffect(() => {
    const element = scroller.current
    if (element === null) return
    element.scrollTop = preview.scrollTop
    return () => {
      preview.scrollTop = element.scrollTop
    }
  }, [preview])

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      onKeyDownCapture={(event) => {
        if (!isSaveShortcut(event)) return
        event.preventDefault()
        event.stopPropagation()
        saveNow(folderId, path)
      }}
      onKeyDown={(event) => {
        // ⌘B makes text bold here, rather than hiding the sidebar.
        if (event.metaKey && event.key.toLowerCase() === 'b') event.stopPropagation()
      }}
      data-testid="markdown-preview"
    >
      {mismatched && (
        <Notice>
          <span className="min-w-0 flex-1" data-testid="markdown-preview-read-only">
            Saving this file from its preview would write all of it again, so the preview only shows
            it. Edit its source instead.
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              focusNextEditor(folderId, path)
              setTabView(folderId, path, 'text')
            }}
          >
            Show Source
          </Button>
        </Notice>
      )}
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-auto">
        <NotraEditorView editor={preview.editor} className="min-h-full" />
      </div>
    </div>
  )
}

/** Only the preview's key matters: it shows its first text, then keeps its own. */
export default memo(
  MarkdownEditor,
  (before, after) =>
    folderKey(before.folder) === folderKey(after.folder) &&
    before.path === after.path &&
    before.generation === after.generation,
)

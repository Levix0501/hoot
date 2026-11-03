import type { FileContents } from '@pierre/diffs'
import type { EditorChangeEvent, EditorOptions } from '@pierre/diffs/edit'
import {
  File as CodeFile,
  MultiFileDiff,
  Virtualizer,
  type FileDiffOptions,
  type FileOptions,
} from '@pierre/diffs/react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { entryName } from '../../../shared/files'
import { TERMINAL_FONT_FAMILY } from '../../terminal/terminal-font'
import { editStateKey, registerEditor, useFilesStore } from '../../store/files-store'

/**
 * Inside the code's shadow root: the code on the window's own background, in
 * the terminal's font, rather than the theme's. The theme sets its
 * background on the host and on the code, after these rules.
 */
const CODE_CSS = `
:host,
pre {
  --diffs-font-family: ${TERMINAL_FONT_FAMILY};
  --diffs-font-size: 13px;
  --diffs-line-height: 20px;
  --diffs-light-bg: var(--background) !important;
  --diffs-dark-bg: var(--background) !important;
}
`

/** Lines longer than this many characters, and files longer than this, are not highlighted. */
const TOKENIZE_MAX_LINE_LENGTH = 10_000
const TOKENIZE_MAX_LENGTH = 2_000_000

/**
 * How code shows: Pierre's light and dark themes, following the appearance
 * in effect; lines wrapped, as the panel is narrow; and no header, as the
 * tab names the file.
 */
const CODE_OPTIONS = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  themeType: 'system',
  overflow: 'wrap',
  disableFileHeader: true,
  tokenizeMaxLineLength: TOKENIZE_MAX_LINE_LENGTH,
  tokenizeMaxLength: TOKENIZE_MAX_LENGTH,
  unsafeCSS: CODE_CSS,
} as const

const FILE_OPTIONS: FileOptions<undefined, undefined> = CODE_OPTIONS

/** How the difference shows when a file changed on disk under unsaved edits: one column, with `-` and `+`. */
const DIFF_OPTIONS: FileDiffOptions<undefined, undefined> = {
  ...CODE_OPTIONS,
  diffStyle: 'unified',
  diffIndicators: 'classic',
}

const FILE_STYLE = { flex: '1 1 auto', minWidth: '100%' } as const
const SCROLLER_CONTENT_STYLE = { display: 'flex', minHeight: '100%', width: '100%' } as const

/** Whether a key press is ⌘S (Ctrl+S on Windows), which saves at once. */
function isSaveShortcut(event: KeyboardEvent): boolean {
  return (
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === 's'
  )
}

/**
 * A text file's editor, which shows `initialText` once and then keeps its
 * own text, reporting each change: the panel keeps a copy, which it saves.
 * Its state, with its carets and its undo history, is kept under its key
 * while another tab is shown, and comes back with the tab. The file's new
 * text, when it changed on disk, goes in as an edit.
 */
export function TextFileEditor({
  folderId,
  path,
  generation,
  initialText,
}: {
  folderId: string
  path: string
  generation: number
  initialText: string
}) {
  const editorChanged = useFilesStore((state) => state.editorChanged)
  const saveNow = useFilesStore((state) => state.saveNow)
  const stateKey = editStateKey(folderId, path, generation)
  // The editor takes its file and options once: they stay as they were.
  const [file] = useState<FileContents>(() => ({
    name: entryName(path),
    contents: initialText,
    cacheKey: stateKey,
  }))
  const unregister = useRef<(() => void) | null>(null)
  const [editorOptions] = useState<EditorOptions<'file', undefined, undefined>>(() => ({
    onAttach(editor) {
      unregister.current?.()
      unregister.current = registerEditor(folderId, path, editor)
    },
  }))
  useEffect(
    () => () => {
      unregister.current?.()
      unregister.current = null
    },
    [],
  )

  return (
    <div
      className="flex min-h-0 flex-1"
      onKeyDownCapture={(event) => {
        if (!isSaveShortcut(event)) return
        event.preventDefault()
        event.stopPropagation()
        saveNow(folderId, path)
      }}
      data-testid="file-editor"
    >
      <Virtualizer
        className="relative min-h-0 min-w-0 flex-1 overflow-auto"
        contentStyle={SCROLLER_CONTENT_STYLE}
      >
        <CodeFile
          style={FILE_STYLE}
          file={file}
          options={FILE_OPTIONS}
          edit
          editorOptions={editorOptions}
          editStateKey={stateKey}
          onEditChange={(event: EditorChangeEvent<'file', undefined, undefined>) =>
            editorChanged(folderId, path, event.file.contents)
          }
        />
      </Virtualizer>
    </div>
  )
}

/**
 * The difference between what a file holds on disk, `disk`, and the unsaved
 * edits, `local`: lines only on disk with a `-`, lines only in the edits
 * with a `+`.
 */
export function ConflictDiff({ path, disk, local }: { path: string; disk: string; local: string }) {
  const name = entryName(path)
  // New objects only when the text changes: the diff is worked out again for new ones.
  const oldFile = useMemo<FileContents>(() => ({ name, contents: disk }), [name, disk])
  const newFile = useMemo<FileContents>(() => ({ name, contents: local }), [name, local])
  return (
    <Virtualizer
      className="relative min-h-0 min-w-0 flex-1 overflow-auto"
      contentStyle={SCROLLER_CONTENT_STYLE}
    >
      <MultiFileDiff
        style={FILE_STYLE}
        oldFile={oldFile}
        newFile={newFile}
        options={DIFF_OPTIONS}
      />
    </Virtualizer>
  )
}

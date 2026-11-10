import { Editor, type EditorFactory } from '@pierre/diffs/edit'
import { EditProvider } from '@pierre/diffs/react'
import { CodeXmlIcon, FolderOpenIcon, ImageIcon, PanelRightIcon, XIcon } from 'lucide-react'
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { useShallow } from 'zustand/react/shallow'
import { FILE_EDITOR_WIDTH, FILE_TREE_WIDTH } from '../../../shared/file-panel'
import { entryName, folderKey, type PanelFolder } from '../../../shared/files'
import { api } from '../../lib/api'
import { cn } from '../../lib/utils'
import {
  editStateKey,
  focusEditor,
  isUnsaved,
  useFilesStore,
  type FileTab,
  type FileView,
  type OpenText,
} from '../../store/files-store'
import { CORNERS, LABEL, TAB, TabShade } from '../session-tabs'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog'
import { Button } from '../ui/button'
import { TooltipProvider } from '../ui/tooltip'
import { BUTTON_CLASS, NavigationButton } from '../window-navigation'
import { ConflictDiff, TextFileEditor } from './code-views'
import { FileTreePane } from './file-tree-pane'

/** Makes the editors of the panel's files. */
const createEditor: EditorFactory<undefined, undefined> = (type, options, key) =>
  new Editor(type, options, key)

/** A size in bytes as people read it: `12.3 MB`. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`
  const units = ['KB', 'MB', 'GB']
  let size = bytes / 1024
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit++
  }
  return `${size.toFixed(1)} ${units[unit]}`
}

/**
 * Follows the pointer that pressed one of the panel's edges until it is let
 * go of: `resize` gets how far it moved left from where it was pressed, and
 * `done` follows once it is let go of. While the edge is held, the pointer
 * shows the resize cursor wherever it is, nothing is selected, and the
 * terminal keeps its size until the edge is let go of.
 */
function dragEdge(
  down: ReactPointerEvent<HTMLElement>,
  resize: (movedLeft: number) => void,
  done: () => void,
): void {
  const { pointerId, clientX: startX } = down
  down.currentTarget.setPointerCapture(pointerId)
  const store = useFilesStore.getState
  store().setResizing(true)
  document.documentElement.dataset.filePanelResizing = ''
  const onMove = (event: PointerEvent) => {
    if (event.pointerId === pointerId) resize(startX - event.clientX)
  }
  const onUp = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
    delete document.documentElement.dataset.filePanelResizing
    store().setResizing(false)
    done()
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
}

/**
 * An edge of the panel's parts, below the window's top row: dragging it
 * resizes them, and a double click gives them their default widths back. It
 * reaches 8 pixels either side of the line it sits on, which a line covers
 * while the pointer is on it or drags it, as on the sidebar's edge.
 */
function ResizeEdge({
  label,
  className,
  onPointerDown,
  onReset,
  testId,
}: {
  label: string
  className: string
  onPointerDown(event: ReactPointerEvent<HTMLElement>): void
  onReset(): void
  testId: string
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      className={cn(
        'group/resize absolute top-11.5 bottom-0 z-10 w-4 cursor-col-resize touch-none select-none',
        className,
      )}
      onPointerDown={(event) => {
        if (event.button === 0) onPointerDown(event)
      }}
      onMouseDown={(event) => event.preventDefault()}
      onDoubleClick={onReset}
      data-testid={testId}
    >
      <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-linear-to-b from-transparent via-foreground/25 to-transparent opacity-0 group-hover/resize:opacity-100 group-active/resize:opacity-100" />
    </div>
  )
}

/** A line across the top of an open file, saying what is wrong with it, with what can be done. */
function Notice({ tone, children }: { tone?: 'error'; children: ReactNode }) {
  return (
    <div
      role="status"
      className={cn(
        'flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b bg-muted/50 px-3 py-2 text-[13px]',
        tone === 'error' && 'text-destructive',
      )}
      data-testid="file-notice"
    >
      {children}
    </div>
  )
}

/** What an open file shows when it cannot be edited: why, and a way to it in Finder. */
function Unavailable({
  folder,
  path,
  message,
}: {
  folder: PanelFolder
  path: string
  message: string
}) {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-[13px] text-muted-foreground"
      data-testid="file-unavailable"
    >
      <p className="max-w-80">{message}</p>
      <Button variant="outline" size="sm" onClick={() => api.revealFile(folder, path)}>
        <FolderOpenIcon />
        Reveal in {api.fileManager}
      </Button>
    </div>
  )
}

/** Only the editor's key matters: it shows its first text, then keeps its own. */
const MemoTextFileEditor = memo(
  TextFileEditor,
  (before, after) =>
    before.folderId === after.folderId &&
    before.path === after.path &&
    before.generation === after.generation,
)

/**
 * An open text file: its editor, or for an SVG file its image if the tab
 * shows that, with a notice above it while the file is gone or could not be
 * saved. When the file changed on disk while edits were unsaved, the
 * difference shows in their place, and the user picks which to keep.
 */
function TextTab({
  folder,
  path,
  text,
  view,
}: {
  folder: PanelFolder
  path: string
  text: OpenText
  view: FileView | null
}) {
  const folderId = folderKey(folder)
  const resolveConflict = useFilesStore((state) => state.resolveConflict)
  const saveNow = useFilesStore((state) => state.saveNow)
  if (text.conflict !== null) {
    return (
      <>
        <Notice>
          <span className="min-w-0 flex-1" data-testid="file-conflict">
            This file changed on disk while you had unsaved changes. Lines marked − are only in the
            file on disk, lines marked + only in your changes.
          </span>
          <span className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => resolveConflict(folderId, path, 'disk')}
              data-testid="file-conflict-use-disk"
            >
              Use the File on Disk
            </Button>
            <Button
              size="sm"
              onClick={() => resolveConflict(folderId, path, 'mine')}
              data-testid="file-conflict-keep-mine"
            >
              Keep My Changes
            </Button>
          </span>
        </Notice>
        <ConflictDiff path={path} disk={text.conflict.disk} local={text.local} />
      </>
    )
  }
  return (
    <>
      {text.deleted ? (
        <Notice>
          <span className="min-w-0 flex-1" data-testid="file-deleted">
            This file is no longer on disk.
            {isUnsaved(text) && ' Your unsaved changes stay here until you close this tab.'}
          </span>
        </Notice>
      ) : text.saveError !== null ? (
        <Notice tone="error">
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]" data-testid="file-save-error">
            Could not save this file: {text.saveError}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="text-foreground"
            onClick={() => saveNow(folderId, path)}
          >
            Try Again
          </Button>
        </Notice>
      ) : null}
      {view === 'image' ? (
        <SvgImage folder={folder} path={path} text={text.local} />
      ) : (
        <MemoTextFileEditor
          key={editStateKey(folderId, path, text.generation)}
          folderId={folderId}
          path={path}
          generation={text.generation}
          initialText={text.local}
        />
      )}
    </>
  )
}

/**
 * An image, whole and in the middle. A picture shows at its own size, or
 * smaller to fit the panel. An SVG image, which scales, fills the panel, on
 * white, as it may well draw in black on nothing. When the file holds no
 * image that can be drawn, as when it is broken, the tab says so instead.
 */
function ImageView({
  folder,
  path,
  src,
  svg = false,
}: {
  folder: PanelFolder
  path: string
  src: string
  svg?: boolean
}) {
  // The image that could not be drawn; the file's next one may be.
  const [broken, setBroken] = useState<string | null>(null)
  if (broken === src) {
    return <Unavailable folder={folder} path={path} message="This image cannot be shown here." />
  }
  return (
    <div
      className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-3"
      data-testid="file-image"
    >
      <img
        src={src}
        alt={entryName(path)}
        draggable={false}
        className={cn(
          'max-h-full max-w-full rounded-sm object-contain shadow-sm',
          svg && 'size-full bg-white p-3',
        )}
        onError={() => setBroken(src)}
      />
    </div>
  )
}

/**
 * The image an SVG file's text draws: the text in its editor, unsaved edits
 * and all. As an image, the SVG runs no scripts and loads nothing else.
 */
function SvgImage({ folder, path, text }: { folder: PanelFolder; path: string; text: string }) {
  const src = useMemo(() => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`, [text])
  return <ImageView folder={folder} path={path} src={src} svg />
}

/** What the tab shown holds: its file, or why the file cannot be shown. */
function TabBody({ folder, tab }: { folder: PanelFolder; tab: FileTab }) {
  switch (tab.content.kind) {
    case 'loading':
      return <div className="flex-1" />
    case 'text':
      return <TextTab folder={folder} path={tab.path} text={tab.content.text} view={tab.view} />
    case 'image':
      return <ImageView folder={folder} path={tab.path} src={tab.content.url} />
    case 'not-text':
      return (
        <Unavailable
          folder={folder}
          path={tab.path}
          message="This file is not UTF-8 text, so it cannot be shown here."
        />
      )
    case 'too-large':
      return (
        <Unavailable
          folder={folder}
          path={tab.path}
          message={`This file is too large to open here (${formatSize(tab.content.size)}).`}
        />
      )
    case 'missing':
      return <Unavailable folder={folder} path={tab.path} message="This file is no longer there." />
    case 'error':
      return (
        <Unavailable
          folder={folder}
          path={tab.path}
          message={`This file could not be read: ${tab.content.message}`}
        />
      )
  }
}

/**
 * A file's tab: its name, in italics while the tab only previews the file,
 * and right of it a dot while the file has unsaved changes (red while they
 * cannot be saved), where its close button shows on the current tab and on
 * another under the pointer. Pressing it shows its file, a middle click
 * closes it and a double click keeps it.
 */
function FileTabButton({
  folderId: key,
  tab,
  current,
}: {
  folderId: string
  tab: FileTab
  current: boolean
}) {
  const selectTab = useFilesStore((state) => state.selectTab)
  const pinTab = useFilesStore((state) => state.pinTab)
  const closeTab = useFilesStore((state) => state.closeTab)
  const nodeRef = useRef<HTMLDivElement>(null)
  const text = tab.content.kind === 'text' ? tab.content.text : null
  const unsaved = text !== null && isUnsaved(text)
  const stuck = text !== null && (text.saveError !== null || text.conflict !== null || text.deleted)

  // When the tabs do not fit, the current one scrolls into view.
  useEffect(() => {
    if (current) nodeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [current])

  return (
    <div
      ref={nodeRef}
      className="relative flex w-36 min-w-[72px] items-center [app-region:no-drag]"
      data-testid="file-tab"
      data-path={tab.path}
      data-current={current}
      data-preview={tab.preview}
      data-unsaved={unsaved}
    >
      <div
        className={TAB}
        title={tab.path}
        // Pressing it shows its file, whose editor takes the keyboard focus.
        onMouseDown={(event) => {
          if (event.button !== 0 && event.button !== 1) return
          event.preventDefault()
          if (event.button !== 0) return
          selectTab(key, tab.path)
          focusEditor(key, tab.path)
        }}
        onAuxClick={(event) => {
          if (event.button !== 1) return
          event.preventDefault()
          void closeTab(key, tab.path)
        }}
        onDoubleClick={() => pinTab(key, tab.path)}
      >
        <TabShade shaded={current} />
        <div
          role="tab"
          aria-selected={current}
          className={cn(
            LABEL,
            current || unsaved ? 'pe-5' : 'group-hover/tab:pe-5',
            current ? 'text-foreground' : 'text-foreground/70',
          )}
        >
          <span
            className={cn('min-w-0 truncate', tab.preview && 'italic')}
            data-testid="file-tab-name"
          >
            {entryName(tab.path)}
          </span>
        </div>
        {unsaved && (
          <span
            aria-label="Unsaved changes"
            className={cn(
              'pointer-events-none absolute inset-y-0 end-2.5 my-auto size-2 rounded-full group-hover/tab:opacity-0',
              stuck ? 'bg-destructive' : 'bg-foreground/45',
            )}
            data-testid="file-tab-unsaved"
          />
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          className={cn(
            `absolute inset-y-0 end-1 my-auto size-5 rounded-[10px] bg-clip-border text-foreground transition-none hover:bg-accent dark:hover:bg-accent ${CORNERS}`,
            (!current || unsaved) &&
              'pointer-events-none opacity-0 group-hover/tab:pointer-events-auto group-hover/tab:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100',
          )}
          // Pressing it neither shows the tab nor moves the keyboard focus.
          onMouseDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onDoubleClick={(event) => event.stopPropagation()}
          onClick={() => void closeTab(key, tab.path)}
          aria-label="Close File"
          data-testid="file-tab-close"
        >
          <XIcon className="size-[12.67px] opacity-50" strokeWidth={1.77} />
        </Button>
      </div>
    </div>
  )
}

/**
 * The button right of the tabs that shows the text of an SVG file in place
 * of its image, giving its editor the keyboard focus, or its image in place
 * of its text. Its tooltip shows as the navigation's do.
 */
function FileViewToggle({
  folderId: key,
  path,
  view,
}: {
  folderId: string
  path: string
  view: FileView
}) {
  const setTabView = useFilesStore((state) => state.setTabView)
  const showsImage = view === 'image'
  return (
    <div className="ms-auto flex shrink-0 items-center ps-2 [app-region:no-drag]">
      <TooltipProvider delay={700} timeout={300}>
        <NavigationButton label={showsImage ? 'Show source' : 'Show image'}>
          <Button
            variant="ghost"
            size="icon-sm"
            className={BUTTON_CLASS}
            onClick={() => {
              setTabView(key, path, showsImage ? 'text' : 'image')
              if (showsImage) focusEditor(key, path)
            }}
            aria-label={showsImage ? 'Show Source' : 'Show Image'}
            data-testid="file-view-toggle"
            data-view={view}
          >
            {showsImage ? <CodeXmlIcon /> : <ImageIcon />}
          </Button>
        </NavigationButton>
      </TooltipProvider>
    </div>
  )
}

/**
 * The open files of a folder: their tabs in the window's top row, and the
 * current one below. An SVG file's tab, unless its text is at odds with the
 * file on disk, has a button at the row's right end that switches it
 * between its image and its text.
 */
function OpenFiles({ folder }: { folder: PanelFolder }) {
  const key = folderKey(folder)
  const files = useFilesStore((state) => state.folders[key])
  if (files === undefined) return null
  const tab = files.tabs.find((candidate) => candidate.path === files.active)
  const view = tab?.content.kind === 'text' && tab.content.text.conflict === null ? tab.view : null
  return (
    <div className="flex min-w-0 flex-1 flex-col" data-testid="open-files">
      {/* The open files' part of the window's top row, whose blank parts drag the window. */}
      <div className="flex h-11.5 shrink-0 items-center px-2 [app-region:drag]">
        <div
          role="tablist"
          aria-label="Open files"
          className="flex h-full min-w-0 items-center gap-[3px] overflow-x-auto select-none [scrollbar-width:none]"
          data-testid="file-tabs"
        >
          {files.tabs.map((candidate) => (
            <FileTabButton
              key={candidate.id}
              folderId={key}
              tab={candidate}
              current={candidate.path === files.active}
            />
          ))}
        </div>
        {tab !== undefined && view !== null && (
          <FileViewToggle folderId={key} path={tab.path} view={view} />
        )}
      </div>
      {tab !== undefined && <TabBody key={tab.id} folder={files.folder} tab={tab} />}
    </div>
  )
}

/**
 * The file panel of a session's folder, right of the terminal: the folder's
 * tree at the window's right edge and, once a file is open, the open files
 * left of it. Dragging the panel's left edge resizes the open files (the
 * tree, while no file is open); dragging the line between them moves it,
 * resizing the tree. The panel narrows, its open files first, to leave the
 * terminal room beside it.
 */
export function FilePanel({ projectRoot, worktreePath }: PanelFolder) {
  const folder = useMemo(() => ({ projectRoot, worktreePath }), [projectRoot, worktreePath])
  const key = folderKey(folder)
  const showFolder = useFilesStore((state) => state.showFolder)
  const hasTabs = useFilesStore((state) => (state.folders[key]?.tabs.length ?? 0) > 0)
  const { treeWidth, editorWidth } = useFilesStore(
    useShallow((state) => ({
      treeWidth: state.layout.treeWidth,
      editorWidth: state.layout.editorWidth,
    })),
  )
  const editorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    showFolder(folder)
    return () => showFolder(null)
  }, [folder, showFolder])

  /** How wide the open files are now, which may be less than their width in a narrow window. */
  const shownEditorWidth = () => editorRef.current?.getBoundingClientRect().width ?? editorWidth
  const store = useFilesStore.getState

  const dragPanelEdge = (down: ReactPointerEvent<HTMLElement>) => {
    const startTree = treeWidth
    const startEditor = shownEditorWidth()
    dragEdge(
      down,
      (moved) => {
        if (hasTabs) store().setEditorWidth(startEditor + moved, false)
        else store().setTreeWidth(startTree + moved, false)
      },
      () => {
        if (hasTabs) store().setEditorWidth(store().layout.editorWidth)
        else store().setTreeWidth(store().layout.treeWidth)
      },
    )
  }

  const dragTreeEdge = (down: ReactPointerEvent<HTMLElement>) => {
    const startTree = treeWidth
    const startEditor = shownEditorWidth()
    dragEdge(
      down,
      (moved) => {
        store().setTreeWidth(startTree + moved, false)
        store().setEditorWidth(startEditor - (store().layout.treeWidth - startTree), false)
      },
      () => {
        store().setTreeWidth(store().layout.treeWidth)
        store().setEditorWidth(store().layout.editorWidth)
      },
    )
  }

  return (
    <EditProvider createEditor={createEditor}>
      <div
        className="relative flex h-full min-w-0 shrink border-l"
        // Their widths, and the lines at the panel's left edge and between them.
        style={{ width: hasTabs ? editorWidth + 1 + treeWidth + 1 : treeWidth + 1 }}
        data-file-panel=""
        data-testid="file-panel"
      >
        <ResizeEdge
          label="Resize file panel"
          className="-left-2"
          onPointerDown={dragPanelEdge}
          onReset={() =>
            hasTabs
              ? store().setEditorWidth(FILE_EDITOR_WIDTH.default)
              : store().setTreeWidth(FILE_TREE_WIDTH.default)
          }
          testId="file-panel-resize"
        />
        {hasTabs && (
          <>
            <div ref={editorRef} className="flex min-w-0 flex-1">
              <OpenFiles folder={folder} />
            </div>
            <div className="relative w-px shrink-0 bg-border">
              <ResizeEdge
                label="Resize file tree"
                className="-left-2"
                onPointerDown={dragTreeEdge}
                onReset={() => store().setTreeWidth(FILE_TREE_WIDTH.default)}
                testId="file-tree-resize"
              />
            </div>
          </>
        )}
        <FileTreePane folder={folder} width={treeWidth} />
      </div>
    </EditProvider>
  )
}

/**
 * The button at the window's top right that shows and hides the file panel,
 * with ⌘⇧E as its shortcut; it stays in place either way. Its tooltip shows
 * as the navigation's do, and pressing it leaves the keyboard focus where it is.
 */
export function FilePanelToggle() {
  const open = useFilesStore((state) => state.layout.open)
  const togglePanel = useFilesStore((state) => state.togglePanel)
  return (
    <div className="absolute top-0 right-[calc(var(--window-controls-width)+--spacing(2))] z-20 flex h-11.5 items-center [app-region:no-drag]">
      <TooltipProvider delay={700} timeout={300}>
        <NavigationButton label="Toggle files" shortcut="⌘⇧E">
          <Button
            variant="ghost"
            size="icon-sm"
            className={BUTTON_CLASS}
            onClick={togglePanel}
            aria-label="Toggle Files"
            aria-pressed={open}
            data-testid="toggle-file-panel"
          >
            <PanelRightIcon />
          </Button>
        </NavigationButton>
      </TooltipProvider>
    </div>
  )
}

/** Asks before a tab is closed whose changes could not be saved, which closing it discards. */
export function DiscardChangesDialog() {
  const discarding = useFilesStore((state) => state.discarding)
  const confirmDiscard = useFilesStore((state) => state.confirmDiscard)
  const cancelDiscard = useFilesStore((state) => state.cancelDiscard)
  // Kept while the dialog fades out after the answer.
  const [name, setName] = useState('')
  if (discarding !== null && entryName(discarding.path) !== name) {
    setName(entryName(discarding.path))
  }
  return (
    <AlertDialog
      open={discarding !== null}
      onOpenChange={(open) => {
        if (!open) cancelDiscard()
      }}
    >
      <AlertDialogContent data-testid="discard-file-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Discard your changes?</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-medium text-foreground [overflow-wrap:anywhere]">{name}</span> has
            changes that could not be saved. Closing its tab discards them.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="discard-file-cancel">Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={confirmDiscard}
            data-testid="discard-file-confirm"
          >
            Discard Changes
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

import { FileTree } from '@pierre/trees/react'
import { CopyIcon, FolderOpenIcon } from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import { isFolderPath, type PanelFolder } from '../../../shared/files'
import { api } from '../../lib/api'
import { focusEditor, folderTree, useFilesStore } from '../../store/files-store'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '../ui/context-menu'

/**
 * The tree's colors and type, through the variables it offers for them: the
 * window's background and text, in the interface's font, with a faint shade
 * under the pointer, a stronger one on the selected row, and the focus ring
 * at half strength, as elsewhere in Hoot.
 */
const TREE_STYLE = {
  '--trees-bg-override': 'var(--background)',
  '--trees-fg-override': 'var(--foreground)',
  '--trees-fg-muted-override': 'var(--muted-foreground)',
  '--trees-bg-muted-override': 'color-mix(in oklab, var(--foreground) 5%, transparent)',
  '--trees-selected-bg-override': 'color-mix(in oklab, var(--foreground) 9%, transparent)',
  '--trees-selected-fg-override': 'var(--foreground)',
  '--trees-selected-focused-border-color-override': 'transparent',
  '--trees-accent-override': 'var(--ring)',
  '--trees-focus-ring-color-override': 'color-mix(in oklab, var(--ring) 50%, transparent)',
  '--trees-border-color-override': 'var(--border)',
  '--trees-indent-guide-bg-override': 'var(--border)',
  '--trees-font-family-override': "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  '--trees-font-size-override': '13px',
} as CSSProperties

/**
 * The entry of the tree an event happened on, by its path, from the row it
 * reached first on its way out of the tree's shadow root: a part of a row
 * that shows several folders as one, a row, or a folder's row kept at the
 * top while its entries scroll. `''`, the folder itself, when it happened on
 * no row.
 */
function entryAt(event: Event): string {
  for (const target of event.composedPath()) {
    if (!(target instanceof HTMLElement)) continue
    const path =
      target.dataset.itemFlattenedSubitem ??
      target.dataset.itemPath ??
      target.dataset.fileTreeStickyPath
    if (path !== undefined && path !== '') return path
  }
  return ''
}

/** The last part of a folder's path, on any system. */
function folderName(root: string): string {
  return root.split(/[\\/]/).findLast((part) => part !== '') ?? root
}

/**
 * While the file panel's parts take new widths that do not follow the
 * pointer, as when a double click on an edge gives them their default
 * widths back, they slide to them as the sidebar does: in 200 ms, at an even
 * pace. The session's page says when (`data-file-panel-settling`).
 */
export const SETTLING_WIDTH_CLASS =
  'in-data-[file-panel-settling]:transition-[width] in-data-[file-panel-settling]:duration-200 in-data-[file-panel-settling]:ease-linear'

/**
 * The file panel's tree of a folder, with the folder's name in the window's
 * top row above it. Selecting a file, with a click or the arrow keys, shows
 * it in the preview tab; a double click, or Enter, opens it in a tab of its
 * own. A right click opens the menu of the entry under the pointer, or of the
 * folder itself on no entry: Reveal in Finder (File Explorer on Windows) and
 * Copy Path. It is as wide as the session's page says (`--file-tree-width`).
 */
export function FileTreePane({ folder }: { folder: PanelFolder }) {
  const tree = folderTree(folder)
  const openFile = useFilesStore((state) => state.openFile)
  const [menuEntry, setMenuEntry] = useState('')
  const root = folder.worktreePath ?? folder.projectRoot

  /** Opens a file in a tab of its own, whose editor takes the keyboard focus. */
  const openPinned = (entry: string | null) => {
    if (entry === null || entry === '' || isFolderPath(entry)) return
    openFile(folder, entry, false)
    focusEditor(root, entry)
  }

  return (
    <div
      className={`flex h-full w-(--file-tree-width) shrink-0 flex-col ${SETTLING_WIDTH_CLASS}`}
      data-testid="file-tree-pane"
    >
      {/* The panel's part of the window's top row, which drags the window. */}
      <div className="flex h-11.5 shrink-0 items-center ps-3 pe-[calc(--spacing(12)+var(--window-controls-width))] [app-region:drag]">
        <span
          className="min-w-0 truncate text-[13px] font-medium text-muted-foreground"
          data-testid="file-tree-folder-name"
        >
          {folderName(root)}
        </span>
      </div>
      <ContextMenu>
        <ContextMenuTrigger
          className="min-h-0 flex-1"
          onContextMenu={(event) => setMenuEntry(entryAt(event.nativeEvent))}
          onDoubleClick={(event) => openPinned(entryAt(event.nativeEvent))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') openPinned(tree.model.getFocusedPath())
          }}
        >
          <FileTree
            model={tree.model}
            className="block size-full"
            style={TREE_STYLE}
            data-testid="file-tree"
          />
        </ContextMenuTrigger>
        <ContextMenuContent className="w-auto min-w-36">
          <ContextMenuItem
            onClick={() => api.revealFile(folder, menuEntry)}
            data-testid="file-tree-reveal"
          >
            <FolderOpenIcon />
            Reveal in {api.fileManager}
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => api.copyFilePath(folder, menuEntry)}
            data-testid="file-tree-copy-path"
          >
            <CopyIcon />
            Copy Path
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  )
}

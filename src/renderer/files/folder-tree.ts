import { FileTree, type FileTreeBatchOperation, type FileTreeItemHandle } from '@pierre/trees'
import { childPath, isFolderPath, type PanelFolder } from '../../shared/files'
import { api } from '../lib/api'

/** The height of a row of the tree in CSS pixels. */
const ROW_HEIGHT = 28

export interface FolderTreeOptions {
  /** A file was selected on its own, with a click or the arrow keys. */
  onSelectFile(path: string): void
  /** The folders shown expanded changed. */
  onExpandedChange(): void
}

function isExpanded(item: FileTreeItemHandle | null): boolean {
  return item !== null && item.isDirectory() && 'isExpanded' in item && item.isExpanded()
}

/**
 * The tree of a file panel's folder: the folder's entries, read one folder
 * at a time as it is first expanded, then again whenever it is expanded
 * again, changes on disk or the window gets the focus. It outlives the panel
 * showing it, so the folders expanded and the file selected are as they were
 * left when the panel shows the folder again.
 */
export class FolderTree {
  readonly model: FileTree
  /** The entries the tree holds of each folder listed, by the folder's path. */
  private readonly listed = new Map<string, string[]>()
  private readonly listing = new Set<string>()
  /** Folders to list again once their listing under way is done. */
  private readonly listAgain = new Set<string>()
  /** Every folder in the tree, listed or not. */
  private readonly folders = new Set<string>()
  /** The folders shown expanded; the folder itself always is. */
  private expanded = new Set<string>([''])
  /** Whether the selection is being changed here, not by the user. */
  private selecting = false
  private disposed = false

  constructor(
    private readonly folder: PanelFolder,
    private readonly options: FolderTreeOptions,
  ) {
    this.model = new FileTree({
      paths: [],
      itemHeight: ROW_HEIGHT,
      stickyFolders: true,
      search: false,
      onSelectionChange: (paths) => {
        if (this.selecting || paths.length !== 1) return
        const [path] = paths
        if (path !== undefined && !isFolderPath(path)) this.options.onSelectFile(path)
      },
    })
    this.model.subscribe(() => this.followExpansion())
    void this.list('')
  }

  /** The folders shown expanded, by their paths: `''` for the folder itself, and every expanded folder in it. */
  expandedFolders(): string[] {
    return [...this.expanded]
  }

  /** Lists a folder again if the tree holds its entries, as when it changed on disk. */
  refresh(directory: string): void {
    if (this.listed.has(directory)) void this.list(directory)
  }

  /** Lists every folder shown expanded again, as when the window gets the focus. */
  refreshExpanded(): void {
    for (const directory of this.expanded) void this.list(directory)
  }

  /**
   * Makes `path` the selected entry, without opening it, as when its file's
   * tab is selected; nothing is selected for `null`, or for a path the tree
   * does not hold.
   */
  select(path: string | null): void {
    this.selecting = true
    try {
      for (const selected of this.model.getSelectedPaths()) {
        if (selected !== path) this.model.getItem(selected)?.deselect()
      }
      if (path !== null && !this.model.getSelectedPaths().includes(path)) {
        this.model.getItem(path)?.select()
      }
    } finally {
      this.selecting = false
    }
  }

  dispose(): void {
    this.disposed = true
    this.model.cleanUp()
  }

  /**
   * Notes which folders are expanded: one expanded for the first time is
   * listed, and one expanded again is listed again, as it may have changed
   * while collapsed, when it was not followed.
   */
  private followExpansion(): void {
    const expanded = new Set<string>([''])
    for (const folder of this.folders) {
      if (isExpanded(this.model.getItem(folder))) expanded.add(folder)
    }
    let changed = expanded.size !== this.expanded.size
    for (const folder of expanded) {
      if (this.expanded.has(folder)) continue
      changed = true
      void this.list(folder)
    }
    this.expanded = expanded
    if (changed) this.options.onExpandedChange()
  }

  /** Reads a folder's entries and puts them in the tree in place of those it held. */
  private async list(directory: string): Promise<void> {
    if (this.listing.has(directory)) {
      this.listAgain.add(directory)
      return
    }
    this.listing.add(directory)
    try {
      const result = await api.listFolder(this.folder, directory)
      if (this.disposed) return
      if (result.kind === 'listed') {
        this.replaceEntries(
          directory,
          result.entries.map((entry) => childPath(directory, entry)),
        )
      } else if (result.kind === 'missing') {
        this.replaceEntries(directory, [])
      }
    } finally {
      this.listing.delete(directory)
      if (this.listAgain.delete(directory) && !this.disposed) void this.list(directory)
    }
  }

  private replaceEntries(directory: string, paths: string[]): void {
    const before = this.listed.get(directory) ?? []
    const now = new Set(paths)
    const had = new Set(before)
    const operations: FileTreeBatchOperation[] = []
    for (const path of before) {
      if (now.has(path)) continue
      operations.push({ type: 'remove', path, recursive: true })
      this.forget(path)
    }
    for (const path of paths) {
      if (had.has(path)) continue
      operations.push({ type: 'add', path })
      if (isFolderPath(path)) this.folders.add(path)
    }
    this.listed.set(directory, paths)
    if (operations.length > 0) this.model.batch(operations)
  }

  /** Forgets a folder that left the tree, and every folder in it. */
  private forget(path: string): void {
    if (!isFolderPath(path)) return
    // Deleting from a set or a map while going through it leaves out only what was deleted.
    for (const folder of this.folders) if (folder.startsWith(path)) this.folders.delete(folder)
    for (const listed of this.listed.keys()) {
      if (listed.startsWith(path)) this.listed.delete(listed)
    }
  }
}

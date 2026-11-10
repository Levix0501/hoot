import { EditStateManager, type Editor } from '@pierre/diffs/edit'
import { create } from 'zustand'
import {
  FILE_EDITOR_WIDTH,
  FILE_TREE_WIDTH,
  fileEditorWidthWithin,
  fileTreeWidthWithin,
  type FilePanelLayout,
} from '../../shared/file-panel'
import {
  entryExtension,
  folderKey,
  isFolderPath,
  type FileVersion,
  type PanelFolder,
  type ReadFileResult,
} from '../../shared/files'
import { FolderTree } from '../files/folder-tree'
import { api } from '../lib/api'
import { diskChange, textReplacement } from '../lib/file-sync'

/** How long a file waits after its last edit before it is saved, in milliseconds. */
export const AUTOSAVE_DELAY_MS = 3_000

/**
 * How long after the last edit a change on disk that conflicts with the
 * edits waits before the editor gives way to the difference, in
 * milliseconds: not while the user is typing.
 */
const CONFLICT_TYPING_DELAY_MS = 550

/** An open text file: what the file held, what the editor holds, and how saving goes. */
export interface OpenText {
  /** What the file held when it was last read or saved. */
  base: string
  /** What the editor holds; edits are unsaved while it differs from `base`. */
  local: string
  /** The file's version when it was last read or saved, which saving checks first. */
  version: FileVersion
  /** Whether the file starts with a byte order mark, which saving keeps. */
  bom: boolean
  /**
   * How many times the editor started over with `local`, as when it takes
   * text it could not take as an edit: it is part of the editor's key.
   */
  generation: number
  saving: boolean
  /** Why the last save failed, until the next one succeeds. */
  saveError: string | null
  /** What the file holds now, when it changed on disk while edits were unsaved. */
  conflict: { disk: string; version: FileVersion } | null
  /** Whether the file is no longer on disk. */
  deleted: boolean
}

export type TabContent =
  | { kind: 'loading' }
  | { kind: 'text'; text: OpenText }
  /** A picture: an object URL of its bytes, and its file's version when it was read. */
  | { kind: 'image'; url: string; version: FileVersion }
  | { kind: 'not-text' }
  | { kind: 'too-large'; size: number }
  | { kind: 'missing' }
  | { kind: 'error'; message: string }

export interface FileTab {
  /** Tells a tab from one opened again later for the same file. */
  id: number
  /** The file's path from the folder (see `src/shared/files.ts`). */
  path: string
  /**
   * Whether the tab only previews its file: the next file opened from the
   * tree with a single click takes its place, until it is edited, double
   * clicked, or its file is opened with a double click.
   */
  preview: boolean
  /**
   * What the tab of an SVG file shows: its image, as it does at first, or
   * its text, which the user switches between; `null` for any other file.
   */
  view: FileView | null
  content: TabContent
}

/** What the tab of an SVG file shows: the image its text draws, or the text. */
export type FileView = 'image' | 'text'

/** What a folder's file panel has open. */
export interface FolderFiles {
  folder: PanelFolder
  tabs: FileTab[]
  /** The path of the tab shown, or `null` with no tabs. */
  active: string | null
}

export interface FilesState {
  /** Whether the panel is shown, and how wide its parts are. */
  layout: FilePanelLayout
  /** Whether an edge of the panel is being dragged. */
  resizing: boolean
  /** The key of the folder whose panel is on screen; `null` while none is. */
  shown: string | null
  /** What each folder's panel has open, by folder key (see `folderKey`). */
  folders: Record<string, FolderFiles>
  /** A tab with edits that could not be saved, which closing loses once the user confirms. */
  discarding: { key: string; path: string } | null
  setLayout(layout: FilePanelLayout): void
  setPanelOpen(open: boolean): void
  togglePanel(): void
  /** Sets the tree's width, and saves it. */
  setTreeWidth(width: number): void
  /** Sets the open files' width, and saves it. */
  setEditorWidth(width: number): void
  setResizing(resizing: boolean): void
  /** Notes the folder whose panel is on screen, or `null` once none is, and looks at its files again. */
  showFolder(folder: PanelFolder | null): void
  /** Looks at the files of the folder on screen again, as when the window gets the focus. */
  refreshShown(): void
  /** Opens a file in a tab, or shows its tab; `preview` opens it in the preview tab. */
  openFile(folder: PanelFolder, path: string, preview: boolean): void
  selectTab(key: string, path: string): void
  /** Keeps a preview tab, as a double click does. */
  pinTab(key: string, path: string): void
  /** Shows the image of an SVG file's tab, or its text. */
  setTabView(key: string, path: string, view: FileView): void
  /** Closes a tab once its edits are saved, or once the user confirms losing them. */
  closeTab(key: string, path: string): Promise<void>
  /** Closes the tab shown in the panel on screen. */
  closeActiveTab(): void
  confirmDiscard(): void
  cancelDiscard(): void
  /** The editor's text changed: by the user, or as the file's new text went in. */
  editorChanged(key: string, path: string, text: string): void
  /** Saves a tab's edits at once, as ⌘S does. */
  saveNow(key: string, path: string): void
  /** Settles a conflict: the user's edits are written over the file, or the file's text is taken. */
  resolveConflict(key: string, path: string, keep: 'mine' | 'disk'): void
  /** An entry the panel follows changed on disk; `root` is its folder's root. */
  fileChanged(root: string, entry: string): void
}

export function isUnsaved(text: OpenText): boolean {
  return text.local !== text.base
}

/** The key a tab's editor keeps its state under; it changes as the editor starts over. */
export function editStateKey(key: string, path: string, generation: number): string {
  return `${key}\0${path}\0${generation}`
}

function tabKey(key: string, path: string): string {
  return `${key}\0${path}`
}

function contentOf(result: ReadFileResult): TabContent {
  switch (result.kind) {
    case 'text':
      return {
        kind: 'text',
        text: {
          base: result.content,
          local: result.content,
          version: result.version,
          bom: result.bom,
          generation: 0,
          saving: false,
          saveError: null,
          conflict: null,
          deleted: false,
        },
      }
    case 'image':
      return {
        kind: 'image',
        url: URL.createObjectURL(new Blob([result.bytes])),
        version: result.version,
      }
    case 'not-text':
      return { kind: 'not-text' }
    case 'too-large':
      return { kind: 'too-large', size: result.size }
    case 'missing':
      return { kind: 'missing' }
    case 'error':
      return { kind: 'error', message: result.message }
  }
}

/** Frees what a tab's content holds once no tab shows it: a picture's bytes. */
function release(content: TabContent): void {
  if (content.kind === 'image') URL.revokeObjectURL(content.url)
}

/** Whether a tab shows the picture just read, unchanged since it was read before. */
function sameImage(content: TabContent, result: ReadFileResult): boolean {
  return (
    content.kind === 'image' &&
    result.kind === 'image' &&
    content.version.mtimeMs === result.version.mtimeMs &&
    content.version.size === result.version.size
  )
}

let nextTabId = 1
/** The trees of the folders the panel has shown, by folder key. */
const trees = new Map<string, FolderTree>()
/** The editors on screen, by tab key: one at most, the shown tab's. */
const editors = new Map<string, Editor<'file'>>()
/** The saves waiting for the end of the wait after an edit, by tab key. */
const autosaves = new Map<string, ReturnType<typeof setTimeout>>()
/** The saves under way, by tab key. */
const saves = new Map<string, Promise<void>>()
/** The tabs whose file changed on disk while they were saved, to look at once they are. */
const checksAfterSave = new Set<string>()
/** When each tab was last edited, by tab key. */
const lastEdits = new Map<string, number>()
/** The entries last followed, so that the same ones are not asked for again. */
let watched = ''
/** The tab whose editor takes the keyboard focus once it is on screen. */
let focusPending: string | null = null

/** The tree of a folder, made the first time the panel shows the folder. */
export function folderTree(folder: PanelFolder): FolderTree {
  const key = folderKey(folder)
  let tree = trees.get(key)
  if (tree === undefined) {
    tree = new FolderTree(folder, {
      onSelectFile: (path) => useFilesStore.getState().openFile(folder, path, true),
      onExpandedChange: () => followShownEntries(),
    })
    trees.set(key, tree)
  }
  return tree
}

/** Notes the editor of a tab shown, which takes a file's new text as an edit. */
export function registerEditor(key: string, path: string, editor: Editor<'file'>): () => void {
  const at = tabKey(key, path)
  editors.set(at, editor)
  if (focusPending === at) {
    focusPending = null
    editor.focus({ preventScroll: true })
  }
  return () => {
    if (editors.get(at) === editor) editors.delete(at)
  }
}

/** Gives the keyboard focus to a tab's editor, now or once it is on screen. */
export function focusEditor(key: string, path: string): void {
  const at = tabKey(key, path)
  const editor = editors.get(at)
  if (editor === undefined) {
    focusPending = at
    return
  }
  focusPending = null
  editor.focus({ preventScroll: true })
}

/** Frees the state an editor kept under `generation`, once it no longer shows. */
function forgetEditState(key: string, path: string, generation: number): void {
  setTimeout(() => EditStateManager.clear('file', editStateKey(key, path, generation)), 0)
}

function clearAutosave(key: string, path: string): void {
  const at = tabKey(key, path)
  clearTimeout(autosaves.get(at))
  autosaves.delete(at)
}

/**
 * Follows the entries of the folder on screen, its open files and its
 * expanded folders, in place of what was followed before.
 */
function followShownEntries(): void {
  const { shown, folders } = useFilesStore.getState()
  const files = shown === null ? undefined : folders[shown]
  const entries =
    files === undefined
      ? []
      : [
          ...(trees.get(shown!)?.expandedFolders() ?? []),
          ...files.tabs.map((tab) => tab.path),
        ].toSorted()
  const request = JSON.stringify([shown, entries])
  if (request === watched) return
  watched = request
  api.watchFiles(files?.folder ?? null, entries)
}

export const useFilesStore = create<FilesState>()((set, get) => {
  /** The tab of `path` in the folder, if it is still the one with `id`. */
  const findTab = (key: string, path: string, id?: number): FileTab | undefined => {
    const tab = get().folders[key]?.tabs.find((candidate) => candidate.path === path)
    return tab !== undefined && (id === undefined || tab.id === id) ? tab : undefined
  }

  const changeTab = (key: string, path: string, id: number, change: (tab: FileTab) => FileTab) =>
    set((state) => {
      const files = state.folders[key]
      if (files === undefined) return state
      let changed = false
      const tabs = files.tabs.map((tab) => {
        if (tab.path !== path || tab.id !== id) return tab
        changed = true
        return change(tab)
      })
      return changed ? { folders: { ...state.folders, [key]: { ...files, tabs } } } : state
    })

  const changeText = (
    key: string,
    path: string,
    id: number,
    change: (text: OpenText) => OpenText,
  ) =>
    changeTab(key, path, id, (tab) =>
      tab.content.kind === 'text'
        ? { ...tab, content: { kind: 'text', text: change(tab.content.text) } }
        : tab,
    )

  const load = async (folder: PanelFolder, path: string, id: number) => {
    const result = await api.readFile(folder, path)
    changeTab(folderKey(folder), path, id, (tab) => ({ ...tab, content: contentOf(result) }))
  }

  const scheduleSave = (key: string, path: string) => {
    clearAutosave(key, path)
    const at = tabKey(key, path)
    autosaves.set(
      at,
      setTimeout(() => {
        autosaves.delete(at)
        void save(key, path)
      }, AUTOSAVE_DELAY_MS),
    )
  }

  /**
   * Saves a tab's edits, after the save under way if there is one; settles
   * once nothing is left to save, or saving could not go on: the file
   * changed or went away, or writing it failed.
   */
  const save = (key: string, path: string): Promise<void> => {
    clearAutosave(key, path)
    const at = tabKey(key, path)
    const running = saves.get(at)
    if (running !== undefined) return running.then(() => save(key, path))
    const write = writeOnce(key, path)
    if (write === null) return Promise.resolve()
    const saving = write.finally(() => {
      if (saves.get(at) === saving) saves.delete(at)
    })
    saves.set(at, saving)
    return saving
  }

  /** Writes a tab's edits once; `null` when there is nothing it can write. */
  const writeOnce = (key: string, path: string): Promise<void> | null => {
    const files = get().folders[key]
    const tab = findTab(key, path)
    if (files === undefined || tab?.content.kind !== 'text') return null
    const { text } = tab.content
    if (!isUnsaved(text) || text.conflict !== null || text.deleted) return null
    const { id } = tab
    const content = text.local
    changeText(key, path, id, (current) => ({ ...current, saving: true }))
    return api.writeFile(files.folder, path, content, text.version, text.bom).then(
      async (result) => {
        switch (result.kind) {
          case 'saved':
            changeText(key, path, id, (current) => ({
              ...current,
              base: content,
              version: result.version,
              saving: false,
              saveError: null,
            }))
            break
          case 'changed':
            // Something else changed the file: what it holds now says whether
            // the edits are at odds with that.
            changeText(key, path, id, (current) => ({ ...current, saving: false }))
            checksAfterSave.add(tabKey(key, path))
            break
          case 'missing':
            changeText(key, path, id, (current) => ({
              ...current,
              saving: false,
              deleted: true,
            }))
            break
          case 'error':
            changeText(key, path, id, (current) => ({
              ...current,
              saving: false,
              saveError: result.message,
            }))
            return
        }
        if (checksAfterSave.delete(tabKey(key, path))) await check(key, path)
        // What was typed while it was saved is saved in turn.
        const after = findTab(key, path, id)
        if (after?.content.kind === 'text' && isUnsaved(after.content.text)) {
          scheduleSave(key, path)
        }
      },
      (error: unknown) => {
        changeText(key, path, id, (current) => ({
          ...current,
          saving: false,
          saveError: error instanceof Error ? error.message : String(error),
        }))
      },
    )
  }

  /**
   * Gives a tab whose edits were all saved the file's new text: the editor on
   * screen takes it as an edit, which keeps its carets and scroll position;
   * an editor that is not on screen, or cannot take the text so (its line
   * breaks are another kind), starts over with it.
   */
  const reload = (
    key: string,
    path: string,
    id: number,
    disk: { content: string; version: FileVersion; bom: boolean },
  ) => {
    changeText(key, path, id, (text) => ({
      ...text,
      base: disk.content,
      version: disk.version,
      bom: disk.bom,
      deleted: false,
    }))
    const editor = editors.get(tabKey(key, path))
    if (editor !== undefined) {
      try {
        const replacement = textReplacement(editor.getText(), disk.content)
        if (replacement !== null) editor.applyEdits([replacement], false)
      } catch (error) {
        console.error('Could not take the new text of', path, error)
      }
      if (editor.getText() === disk.content) {
        changeText(key, path, id, (text) => ({ ...text, local: disk.content }))
        return
      }
    }
    const tab = findTab(key, path, id)
    if (tab?.content.kind !== 'text') return
    forgetEditState(key, path, tab.content.text.generation)
    changeText(key, path, id, (text) => ({
      ...text,
      local: disk.content,
      generation: text.generation + 1,
    }))
  }

  /** Reads a tab's file again, after it changed on disk, and does what that comes to. */
  const check = async (key: string, path: string): Promise<void> => {
    const files = get().folders[key]
    const tab = findTab(key, path)
    // A file being read is read as it is now anyway.
    if (files === undefined || tab === undefined || tab.content.kind === 'loading') return
    if (tab.content.kind === 'text' && tab.content.text.saving) {
      checksAfterSave.add(tabKey(key, path))
      return
    }
    const { id } = tab
    const result = await api.readFile(files.folder, path)
    const current = findTab(key, path, id)
    if (current === undefined) return
    if (current.content.kind !== 'text') {
      // A picture, or a file the tab could not show, is shown as it is now:
      // a picture only once it changed.
      if (current.content.kind !== 'loading' && !sameImage(current.content, result)) {
        changeTab(key, path, id, (stale) => ({ ...stale, content: contentOf(result) }))
        release(current.content)
      }
      return
    }
    const { text } = current.content
    if (text.saving) {
      checksAfterSave.add(tabKey(key, path))
      return
    }
    switch (result.kind) {
      case 'text': {
        const disk = { content: result.content, version: result.version, bom: result.bom }
        if (text.conflict !== null) {
          // Still at odds with the edits, or no longer: the file now holds them.
          changeText(key, path, id, (stale) =>
            disk.content === stale.local
              ? { ...stale, base: disk.content, version: disk.version, conflict: null }
              : { ...stale, conflict: { disk: disk.content, version: disk.version } },
          )
          return
        }
        switch (diskChange(text, disk.content)) {
          case 'unchanged':
          case 'caught-up':
            changeText(key, path, id, (stale) => ({
              ...stale,
              base: disk.content,
              version: disk.version,
              bom: disk.bom,
              deleted: false,
            }))
            return
          case 'reload':
            reload(key, path, id, disk)
            return
          case 'conflict': {
            // Not while the user is typing: once they pause, it is looked at again.
            const sinceEdit = Date.now() - (lastEdits.get(tabKey(key, path)) ?? 0)
            if (sinceEdit < CONFLICT_TYPING_DELAY_MS) {
              setTimeout(() => void check(key, path), CONFLICT_TYPING_DELAY_MS - sinceEdit)
              return
            }
            clearAutosave(key, path)
            changeText(key, path, id, (stale) => ({
              ...stale,
              conflict: { disk: disk.content, version: disk.version },
              deleted: false,
            }))
            return
          }
        }
        return
      }
      case 'missing':
        clearAutosave(key, path)
        changeText(key, path, id, (stale) => ({ ...stale, deleted: true }))
        return
      case 'image':
      case 'not-text':
      case 'too-large':
        // A file that is no longer text it can edit, unless it holds edits.
        if (!isUnsaved(text)) {
          changeTab(key, path, id, (stale) => ({ ...stale, content: contentOf(result) }))
        }
        return
      case 'error':
        return
    }
  }

  /** Takes a tab out of its panel; the tab next to it is shown in its place. */
  const removeTab = (key: string, path: string, id: number) => {
    const files = get().folders[key]
    const index = files?.tabs.findIndex((tab) => tab.path === path && tab.id === id) ?? -1
    if (files === undefined || index === -1) return
    const removed = files.tabs[index]!
    const tabs = files.tabs.filter((_, at) => at !== index)
    const active =
      files.active !== path ? files.active : (tabs[Math.min(index, tabs.length - 1)]?.path ?? null)
    clearAutosave(key, path)
    checksAfterSave.delete(tabKey(key, path))
    lastEdits.delete(tabKey(key, path))
    if (removed.content.kind === 'text') forgetEditState(key, path, removed.content.text.generation)
    set((state) => ({ folders: { ...state.folders, [key]: { ...files, tabs, active } } }))
    release(removed.content)
    followShownEntries()
  }

  /** Looks at a folder's files again: its open files, and its expanded folders. */
  const refresh = (key: string) => {
    for (const tab of get().folders[key]?.tabs ?? []) void check(key, tab.path)
    trees.get(key)?.refreshExpanded()
  }

  return {
    layout: {
      open: false,
      treeWidth: FILE_TREE_WIDTH.default,
      editorWidth: FILE_EDITOR_WIDTH.default,
    },
    resizing: false,
    shown: null,
    folders: {},
    discarding: null,

    setLayout(layout) {
      set({ layout })
    },

    setPanelOpen(open) {
      if (get().layout.open === open) return
      set((state) => ({ layout: { ...state.layout, open } }))
      api.setFilePanelOpen(open)
    },

    togglePanel() {
      get().setPanelOpen(!get().layout.open)
    },

    setTreeWidth(width) {
      const within = fileTreeWidthWithin(width)
      if (within === get().layout.treeWidth) return
      set((state) => ({ layout: { ...state.layout, treeWidth: within } }))
      api.setFileTreeWidth(within)
    },

    setEditorWidth(width) {
      const within = fileEditorWidthWithin(width)
      if (within === get().layout.editorWidth) return
      set((state) => ({ layout: { ...state.layout, editorWidth: within } }))
      api.setFileEditorWidth(within)
    },

    setResizing(resizing) {
      set({ resizing })
    },

    showFolder(folder) {
      const key = folder === null ? null : folderKey(folder)
      if (key === get().shown) return
      set((state) => ({
        shown: key,
        folders:
          folder === null || key === null || state.folders[key] !== undefined
            ? state.folders
            : { ...state.folders, [key]: { folder, tabs: [], active: null } },
      }))
      if (folder !== null && key !== null) {
        folderTree(folder)
        refresh(key)
      }
      followShownEntries()
    },

    refreshShown() {
      const { shown } = get()
      if (shown !== null) refresh(shown)
    },

    openFile(folder, path, preview) {
      if (path === '' || isFolderPath(path)) return
      const key = folderKey(folder)
      const files = get().folders[key] ?? { folder, tabs: [], active: null }
      const existing = files.tabs.find((tab) => tab.path === path)
      if (existing !== undefined) {
        set((state) => ({
          folders: {
            ...state.folders,
            [key]: {
              ...files,
              active: path,
              tabs: files.tabs.map((tab) =>
                tab === existing && !preview ? { ...tab, preview: false } : tab,
              ),
            },
          },
        }))
        return
      }
      const tab: FileTab = {
        id: nextTabId++,
        path,
        preview,
        view: entryExtension(path) === 'svg' ? 'image' : null,
        content: { kind: 'loading' },
      }
      // A preview takes the place of the preview tab, which nothing was edited in.
      const replaced = preview ? files.tabs.find((candidate) => candidate.preview) : undefined
      let tabs: FileTab[]
      if (replaced !== undefined) {
        tabs = files.tabs.map((candidate) => (candidate === replaced ? tab : candidate))
        clearAutosave(key, replaced.path)
        if (replaced.content.kind === 'text') {
          forgetEditState(key, replaced.path, replaced.content.text.generation)
        }
        release(replaced.content)
      } else {
        // Right of the tab shown, or at the end.
        const shownIndex = files.tabs.findIndex((candidate) => candidate.path === files.active)
        const at = shownIndex === -1 ? files.tabs.length : shownIndex + 1
        tabs = [...files.tabs.slice(0, at), tab, ...files.tabs.slice(at)]
      }
      set((state) => ({ folders: { ...state.folders, [key]: { folder, tabs, active: path } } }))
      void load(folder, path, tab.id)
      followShownEntries()
    },

    selectTab(key, path) {
      const files = get().folders[key]
      if (files === undefined || files.active === path) return
      if (!files.tabs.some((tab) => tab.path === path)) return
      set((state) => ({ folders: { ...state.folders, [key]: { ...files, active: path } } }))
    },

    pinTab(key, path) {
      const tab = findTab(key, path)
      if (tab?.preview === true)
        changeTab(key, path, tab.id, (stale) => ({ ...stale, preview: false }))
    },

    setTabView(key, path, view) {
      const tab = findTab(key, path)
      if (tab === undefined || tab.view === null || tab.view === view) return
      changeTab(key, path, tab.id, (stale) => ({ ...stale, view }))
    },

    async closeTab(key, path) {
      const tab = findTab(key, path)
      if (tab === undefined) return
      const { id } = tab
      if (tab.content.kind === 'text' && isUnsaved(tab.content.text)) {
        await save(key, path)
        let after = findTab(key, path, id)
        // What was typed while it was saved is saved too, unless saving stopped.
        if (
          after?.content.kind === 'text' &&
          isUnsaved(after.content.text) &&
          after.content.text.conflict === null &&
          !after.content.text.deleted &&
          after.content.text.saveError === null
        ) {
          await save(key, path)
          after = findTab(key, path, id)
        }
        if (after === undefined) return
        if (after.content.kind === 'text' && isUnsaved(after.content.text)) {
          set({ discarding: { key, path } })
          return
        }
      }
      removeTab(key, path, id)
    },

    closeActiveTab() {
      const { shown, folders } = get()
      const active = shown === null ? null : folders[shown]?.active
      if (shown !== null && active !== null && active !== undefined) {
        void get().closeTab(shown, active)
      }
    },

    confirmDiscard() {
      const { discarding } = get()
      set({ discarding: null })
      if (discarding === null) return
      const tab = findTab(discarding.key, discarding.path)
      if (tab !== undefined) removeTab(discarding.key, discarding.path, tab.id)
    },

    cancelDiscard() {
      set({ discarding: null })
    },

    editorChanged(key, path, text) {
      const tab = findTab(key, path)
      if (tab?.content.kind !== 'text') return
      const current = tab.content.text
      if (text === current.local) return
      // Taking the file's new text is no edit: the text then matches the file.
      const edited = text !== current.base
      changeTab(key, path, tab.id, (stale) =>
        stale.content.kind !== 'text'
          ? stale
          : {
              ...stale,
              preview: edited ? false : stale.preview,
              content: { kind: 'text', text: { ...stale.content.text, local: text } },
            },
      )
      if (edited) {
        lastEdits.set(tabKey(key, path), Date.now())
        scheduleSave(key, path)
      } else {
        clearAutosave(key, path)
      }
    },

    saveNow(key, path) {
      void save(key, path)
    },

    resolveConflict(key, path, keep) {
      const tab = findTab(key, path)
      if (tab?.content.kind !== 'text' || tab.content.text.conflict === null) return
      const { id } = tab
      const { conflict, generation } = tab.content.text
      if (keep === 'disk') {
        forgetEditState(key, path, generation)
        changeText(key, path, id, (text) => ({
          ...text,
          base: conflict.disk,
          local: conflict.disk,
          version: conflict.version,
          conflict: null,
          generation: text.generation + 1,
        }))
        return
      }
      // The edits are written over the file as it is now.
      changeText(key, path, id, (text) => ({
        ...text,
        base: conflict.disk,
        version: conflict.version,
        conflict: null,
      }))
      void save(key, path)
    },

    fileChanged(root, entry) {
      // A folder's key is its root.
      if (get().folders[root] === undefined) return
      if (entry === '' || isFolderPath(entry)) trees.get(root)?.refresh(entry)
      else void check(root, entry)
    },
  }
})

// The entries the panel follows report their changes here.
api.onFilesChanged((root, entry) => useFilesStore.getState().fileChanged(root, entry))

// Edits still waiting to be saved as the window closes, as when Hoot quits,
// are written then. The main process writes them after the page is gone.
window.addEventListener('beforeunload', () => {
  for (const files of Object.values(useFilesStore.getState().folders)) {
    for (const tab of files.tabs) {
      if (tab.content.kind !== 'text') continue
      const { text } = tab.content
      if (!isUnsaved(text) || text.conflict !== null || text.deleted || text.saving) continue
      void api.writeFile(files.folder, tab.path, text.local, text.version, text.bom)
    }
  }
})

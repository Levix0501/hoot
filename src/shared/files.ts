/**
 * The files of a session's folder, as the file panel shows and edits them.
 *
 * An entry of the folder is named by its path from the folder, its parts
 * joined with `/` whatever the system: `src/index.ts`. A folder's path ends
 * with `/` (`src/`), as the panel's tree takes it; the folder itself is `''`.
 */

/** Files larger than this many bytes are not opened: too large to edit or show here. */
export const MAX_OPENED_FILE_BYTES = 10 * 1024 * 1024

/**
 * Entries every folder listing leaves out, as Visual Studio Code's Explorer
 * does by default (its `files.exclude`): the folders where version control
 * keeps its data, and the files Finder and File Explorer leave behind.
 */
export const HIDDEN_ENTRY_NAMES: ReadonlySet<string> = new Set([
  '.git',
  '.svn',
  '.hg',
  'CVS',
  '.DS_Store',
  'Thumbs.db',
])

export interface FolderEntry {
  name: string
  directory: boolean
}

export type ListFolderResult =
  | { kind: 'listed'; entries: FolderEntry[] }
  /** The folder is no longer there. */
  | { kind: 'missing' }
  | { kind: 'error'; message: string }

/**
 * What a file was like when it was read or written: saving compares it with
 * the file to find out whether anything else changed the file since.
 */
export interface FileVersion {
  /** When the file was last changed, as `fs.Stats.mtimeMs` gives it. */
  mtimeMs: number
  /** Its size in bytes. */
  size: number
}

export type ReadFileResult =
  | {
      kind: 'text'
      /** The file's text, without the byte order mark it may start with. */
      content: string
      version: FileVersion
      /** Whether the file starts with a UTF-8 byte order mark, which saving keeps. */
      bom: boolean
    }
  /** A picture, which the panel shows rather than edits. */
  | { kind: 'image'; bytes: Uint8Array<ArrayBuffer>; version: FileVersion }
  /** Not UTF-8 text: a binary file, or text in another encoding. */
  | { kind: 'not-text' }
  /** Larger than {@link MAX_OPENED_FILE_BYTES}. */
  | { kind: 'too-large'; size: number }
  | { kind: 'missing' }
  | { kind: 'error'; message: string }

export type WriteFileResult =
  | { kind: 'saved'; version: FileVersion }
  /**
   * The file changed after it was read, so it was not written: whatever
   * changed it would lose its change.
   */
  | { kind: 'changed' }
  /** The file is no longer there, so it was not written. */
  | { kind: 'missing' }
  | { kind: 'error'; message: string }

/** The folder a file panel shows: a project's own folder, or one of its worktrees. */
export interface PanelFolder {
  projectRoot: string
  /** The worktree's root, or `null` for the project's own folder. */
  worktreePath: string | null
}

/** The key a folder's state is kept under: its root. */
export function folderKey(folder: PanelFolder): string {
  return folder.worktreePath ?? folder.projectRoot
}

/** Whether a path names a folder: it ends with `/`. */
export function isFolderPath(entry: string): boolean {
  return entry.endsWith('/')
}

/** The last part of a path: `index.ts` of `src/index.ts`, `src` of `src/`. */
export function entryName(entry: string): string {
  const parts = entry.split('/').filter((part) => part !== '')
  return parts.at(-1) ?? ''
}

/**
 * The extension of an entry's name, in lowercase and without its dot: `svg`
 * of `assets/logo.SVG`; `null` for a name without one, such as `.env`.
 */
export function entryExtension(entry: string): string | null {
  const name = entryName(entry)
  const dot = name.lastIndexOf('.')
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : null
}

/** The path of an entry of the folder `parent` (`''` for the folder itself). */
export function childPath(parent: string, entry: FolderEntry): string {
  return `${parent}${entry.name}${entry.directory ? '/' : ''}`
}

/**
 * Whether `entry` is a path the panel may name: relative, with no empty, `.`
 * or `..` parts. A folder path ends with a single `/`; `''` is the folder
 * itself. The main process also checks that the path stays in the folder.
 */
export function isEntryPath(entry: string): boolean {
  if (entry === '') return true
  if (entry.includes('\0')) return false
  const parts = (isFolderPath(entry) ? entry.slice(0, -1) : entry).split('/')
  return parts.every((part) => part !== '' && part !== '.' && part !== '..')
}

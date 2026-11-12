/**
 * The files of a session's folder, as the file panel shows and edits them.
 *
 * An entry of the folder is named by its path from the folder, its parts
 * joined with `/` whatever the system: `src/index.ts`. A folder's path ends
 * with `/` (`src/`), as the panel's tree takes it; the folder itself is `''`.
 */

/** Files larger than this many bytes are not opened: too large to edit or show here. */
export const MAX_OPENED_FILE_BYTES = 10 * 1024 * 1024

/** Files larger than this many bytes are not added to a folder: pictures pasted into a document. */
export const MAX_ADDED_FILE_BYTES = 100 * 1024 * 1024

/** The extensions of Markdown files, in lowercase, which the panel shows formatted. */
const MARKDOWN_EXTENSIONS: ReadonlySet<string> = new Set(['markdown', 'md'])

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

export type AddFileResult =
  /** The file is in the folder, at `file`: its path from the folder. */
  { kind: 'added'; file: string } | { kind: 'error'; message: string }

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

/** Whether an entry is a Markdown file, by its extension: `README.md`, `notes.markdown`. */
export function isMarkdownPath(entry: string): boolean {
  if (isFolderPath(entry)) return false
  const extension = entryExtension(entry)
  return extension !== null && MARKDOWN_EXTENSIONS.has(extension)
}

/** The path of an entry of the folder `parent` (`''` for the folder itself). */
export function childPath(parent: string, entry: FolderEntry): string {
  return `${parent}${entry.name}${entry.directory ? '/' : ''}`
}

/** The path of the folder an entry is in: `docs/` of `docs/a.md`, `''` for one at the top. */
export function parentPath(entry: string): string {
  const trimmed = isFolderPath(entry) ? entry.slice(0, -1) : entry
  const slash = trimmed.lastIndexOf('/')
  return slash === -1 ? '' : trimmed.slice(0, slash + 1)
}

/** A reference that names its scheme, such as `https://…` or `mailto:…`, or a host (`//…`). */
const ABSOLUTE_REFERENCE = /^(?:[A-Za-z][A-Za-z\d+.-]*:|\/\/)/

/** A part of a reference with its `%xx` escapes decoded; itself when they are not valid. */
function decodePart(part: string): string {
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}

/**
 * The entry of the folder that a link or picture of the file `document`
 * refers to, as GitHub reads it: `docs/images/a.png` for `images/a.png` in
 * `docs/a.md`, `images/a.png` for `../images/a.png` there, and from the top
 * of the folder for a reference that starts with `/`. Its query and fragment
 * are left out and its `%20`s and the like decoded. A reference ending with
 * `/` names a folder. `null` for one with a scheme or a host, one to a place
 * in the document itself (`#usage`), and one that leads out of the folder.
 */
export function referencedEntry(document: string, reference: string): string | null {
  if (ABSOLUTE_REFERENCE.test(reference)) return null
  const target = reference.replace(/[?#].*$/s, '')
  if (target === '') return null
  const parts = target.startsWith('/') ? [] : parentPath(document).split('/').filter(Boolean)
  const steps = target.split('/')
  for (const step of steps.map(decodePart)) {
    if (step.includes('/') || step.includes('\0')) return null
    if (step === '' || step === '.') continue
    if (step === '..') {
      if (parts.length === 0) return null
      parts.pop()
      continue
    }
    parts.push(step)
  }
  if (parts.length === 0) return null
  const entry = `${parts.join('/')}${target.endsWith('/') ? '/' : ''}`
  return isEntryPath(entry) ? entry : null
}

/**
 * The reference from the file `document` to `entry`, another entry of the
 * folder, which {@link referencedEntry} reads back as `entry`: `a.png` for
 * `docs/a.png` from `docs/a.md`, `../images/a.png` for `images/a.png` there.
 */
export function entryReference(document: string, entry: string): string {
  const from = parentPath(document).split('/').filter(Boolean)
  const to = entry.split('/')
  let shared = 0
  while (shared < from.length && shared < to.length - 1 && from[shared] === to[shared]) shared++
  return [...from.slice(shared).map(() => '..'), ...to.slice(shared)].join('/')
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

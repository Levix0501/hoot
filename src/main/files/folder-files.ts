import fs from 'node:fs/promises'
import path from 'node:path'
import {
  HIDDEN_ENTRY_NAMES,
  MAX_OPENED_FILE_BYTES,
  entryExtension,
  isEntryPath,
  isFolderPath,
  parentPath,
  type AddFileResult,
  type FileVersion,
  type FolderEntry,
  type ListFolderResult,
  type ReadFileResult,
  type WriteFileResult,
} from '../../shared/files'

/**
 * How much of a file's start is looked at for a NUL byte, which makes it
 * binary: as much as Git looks at to tell whether a file is binary.
 */
const BINARY_CHECK_BYTES = 8000

/**
 * The extensions of the pictures the panel shows, in lowercase: the formats
 * Chromium draws. An SVG file is text, which the panel edits, and draws from
 * its text.
 */
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  'apng',
  'avif',
  'bmp',
  'gif',
  'ico',
  'jfif',
  'jpeg',
  'jpg',
  'png',
  'webp',
])

const BYTE_ORDER_MARK = '﻿'

function errorCode(error: unknown): string | undefined {
  return error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Whether `location` is `folder` or inside it. */
function isWithin(folder: string, location: string): boolean {
  const relative = path.relative(folder, location)
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  )
}

/**
 * Where an entry of `folder` is on disk, by its path from the folder (see
 * `src/shared/files.ts`); `null` for a path that names no entry or leads out
 * of the folder. On Windows, a part holding a `\` or a `:`, which Windows
 * takes as a separator or a drive, names no entry either.
 */
export function entryLocation(folder: string, entry: string): string | null {
  if (!isEntryPath(entry)) return null
  const parts = entry.split('/').filter((part) => part !== '')
  if (process.platform === 'win32' && parts.some((part) => /[\\:]/.test(part))) return null
  const location = path.resolve(folder, ...parts)
  return isWithin(folder, location) ? location : null
}

/**
 * What `name`, a symbolic link in the folder at `location`, shows as: what
 * it leads to, a file or a folder; a file when it leads nowhere, which then
 * does not open. A link to a folder outside `realFolder` (the real path of
 * the panel's folder), and one to anything but a file or folder, is left out.
 */
async function linkEntry(
  realFolder: string,
  location: string,
  name: string,
): Promise<FolderEntry | null> {
  const target = path.join(location, name)
  const stats = await fs.stat(target).catch(() => null)
  if (stats === null) return { name, directory: false }
  if (stats.isFile()) return { name, directory: false }
  if (!stats.isDirectory()) return null
  const real = await fs.realpath(target).catch(() => null)
  return real !== null && isWithin(realFolder, real) ? { name, directory: true } : null
}

/**
 * The entries of a folder in the panel's folder, `directory` being its path
 * (`''` for the panel's folder itself): its files and folders, unordered,
 * without the entries Visual Studio Code's Explorer leaves out by default.
 * Anything else, such as a socket, is left out too.
 */
export async function listFolder(folder: string, directory: string): Promise<ListFolderResult> {
  const location =
    directory === '' || isFolderPath(directory) ? entryLocation(folder, directory) : null
  if (location === null) return { kind: 'error', message: `"${directory}" is not a folder.` }
  let dirents
  try {
    dirents = await fs.readdir(location, { withFileTypes: true })
  } catch (error) {
    const code = errorCode(error)
    if (code === 'ENOENT' || code === 'ENOTDIR') return { kind: 'missing' }
    return { kind: 'error', message: errorMessage(error) }
  }
  const realFolder = await fs.realpath(folder).catch(() => folder)
  const entries = await Promise.all(
    dirents.map(async (dirent): Promise<FolderEntry | null> => {
      if (HIDDEN_ENTRY_NAMES.has(dirent.name)) return null
      if (dirent.isDirectory()) return { name: dirent.name, directory: true }
      if (dirent.isFile()) return { name: dirent.name, directory: false }
      if (dirent.isSymbolicLink()) return linkEntry(realFolder, location, dirent.name)
      return null
    }),
  )
  return { kind: 'listed', entries: entries.filter((entry) => entry !== null) }
}

/**
 * Reads a file of the panel's folder: a picture's bytes, for a file named
 * as one (see {@link IMAGE_EXTENSIONS}), and any other file as UTF-8 text.
 * A file with a NUL byte near its start, or that is not valid UTF-8, is not
 * text; one larger than {@link MAX_OPENED_FILE_BYTES} is not read. The
 * version is the file's as it was just before it was read: a change made
 * while it is read shows as a change when the file is saved.
 */
export async function readFile(folder: string, file: string): Promise<ReadFileResult> {
  const location = file === '' || isFolderPath(file) ? null : entryLocation(folder, file)
  if (location === null) return { kind: 'error', message: `"${file}" is not a file.` }
  let handle
  try {
    handle = await fs.open(location, 'r')
  } catch (error) {
    const code = errorCode(error)
    if (code === 'ENOENT' || code === 'ENOTDIR') return { kind: 'missing' }
    return { kind: 'error', message: errorMessage(error) }
  }
  try {
    const stats = await handle.stat()
    // A folder now, or anything that is not a file, such as a pipe, which
    // reading would wait on.
    if (!stats.isFile()) return { kind: 'not-text' }
    if (stats.size > MAX_OPENED_FILE_BYTES) return { kind: 'too-large', size: stats.size }
    const bytes = await handle.readFile()
    const version = { mtimeMs: stats.mtimeMs, size: stats.size }
    const extension = entryExtension(file)
    if (extension !== null && IMAGE_EXTENSIONS.has(extension)) {
      return { kind: 'image', bytes, version }
    }
    if (bytes.subarray(0, BINARY_CHECK_BYTES).includes(0)) return { kind: 'not-text' }
    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    } catch {
      return { kind: 'not-text' }
    }
    const bom = text.startsWith(BYTE_ORDER_MARK)
    return { kind: 'text', content: bom ? text.slice(BYTE_ORDER_MARK.length) : text, version, bom }
  } catch (error) {
    return { kind: 'error', message: errorMessage(error) }
  } finally {
    await handle.close().catch(() => undefined)
  }
}

/**
 * Writes `content` over a file of the panel's folder, with a byte order mark
 * before it when `bom`, unless the file is no longer as it was at `expected`,
 * the version it had when it was last read or written: then something else
 * changed it, which writing would undo. The file is written in place, as an
 * editor saves, so it keeps its permissions and any links to it.
 */
export async function writeTextFile(
  folder: string,
  file: string,
  content: string,
  expected: FileVersion,
  bom: boolean,
): Promise<WriteFileResult> {
  const location = file === '' || isFolderPath(file) ? null : entryLocation(folder, file)
  if (location === null) return { kind: 'error', message: `"${file}" is not a file.` }
  try {
    const before = await fs.stat(location)
    if (!before.isFile()) return { kind: 'missing' }
    if (before.mtimeMs !== expected.mtimeMs || before.size !== expected.size) {
      return { kind: 'changed' }
    }
    await fs.writeFile(location, bom ? BYTE_ORDER_MARK + content : content, 'utf8')
    const after = await fs.stat(location)
    return { kind: 'saved', version: { mtimeMs: after.mtimeMs, size: after.size } }
  } catch (error) {
    const code = errorCode(error)
    if (code === 'ENOENT' || code === 'ENOTDIR') return { kind: 'missing' }
    return { kind: 'error', message: errorMessage(error) }
  }
}

/** The name an added file gets when the one it came with is not a name a file can have. */
const ADDED_FILE_NAME = 'image.png'

/** How many names an added file tries before giving up: `image.png`, `image-1.png`… */
const ADDED_FILE_NAME_TRIES = 1000

/**
 * The name `name` keeps as the name of a file on any system: its last part,
 * without control characters or the ones Windows does not take in names, and
 * without the spaces and dots Windows drops at its end.
 */
function fileNameOf(name: string): string {
  const last = name.split(/[\\/]/).at(-1) ?? ''
  const kept = Array.from(last)
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0
      return code > 0x1f && code !== 0x7f && !'<>:"|?*'.includes(character)
    })
    .join('')
    .replace(/[. ]+$/, '')
  return kept === '' ? ADDED_FILE_NAME : kept
}

/** The names `name` tries in turn: itself, then with `-1`, `-2`… before its extension. */
function* fileNames(name: string): Generator<string> {
  yield name
  const dot = name.lastIndexOf('.')
  const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
  for (let number = 1; number < ADDED_FILE_NAME_TRIES; number++) {
    yield `${stem}-${number}${extension}`
  }
}

/**
 * Puts a file pasted or dropped into the document `document` of the panel's
 * folder next to it, as Visual Studio Code does with pictures pasted into
 * Markdown: in the document's folder, under the name it came with, or with
 * `-1`, `-2`… before its extension when another file has that name, which
 * it never writes over. A dropped file that is already in the folder, at
 * `source` (`''` when it is not on disk, as a pasted picture), is not copied:
 * its own path is the result. Returns the path of the file from the folder.
 */
export async function addFileNextTo(
  folder: string,
  document: string,
  name: string,
  bytes: Uint8Array,
  source: string,
): Promise<AddFileResult> {
  if (document === '' || isFolderPath(document) || entryLocation(folder, document) === null) {
    return { kind: 'error', message: `"${document}" is not a file.` }
  }
  if (source !== '') {
    const realFolder = await fs.realpath(folder).catch(() => folder)
    const real = await fs.realpath(source).catch(() => null)
    const stats = real === null ? null : await fs.stat(real).catch(() => null)
    if (real !== null && stats?.isFile() === true && isWithin(realFolder, real)) {
      const file = path.relative(realFolder, real).split(path.sep).join('/')
      if (isEntryPath(file)) return { kind: 'added', file }
    }
  }
  const directory = parentPath(document)
  for (const candidate of fileNames(fileNameOf(name))) {
    const file = `${directory}${candidate}`
    const location = entryLocation(folder, file)
    if (location === null) return { kind: 'error', message: `"${candidate}" is not a file name.` }
    try {
      await fs.writeFile(location, bytes, { flag: 'wx' })
      return { kind: 'added', file }
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') return { kind: 'error', message: errorMessage(error) }
    }
  }
  return { kind: 'error', message: `The folder already has files named like "${name}".` }
}

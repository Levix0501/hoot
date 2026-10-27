import fs from 'node:fs/promises'
import path from 'node:path'
import { displayPath } from '../../shared/paths'

/**
 * Replaces every character other than a letter (of any script), a digit, `.`,
 * `_` and `-` with `-`, so that the text can be used as a folder name.
 */
export function safeName(text: string): string {
  return text.replace(/[^\p{L}\p{N}._-]/gu, '-')
}

/**
 * The file in each project folder that records which project the folder
 * belongs to. Worktree folders are named after branches, which cannot start
 * with a dot, so a worktree folder never has this name.
 */
export const PROJECT_MARKER = '.hoot-project.json'

async function exists(file: string): Promise<boolean> {
  return (await fs.lstat(file).catch(() => null)) !== null
}

/**
 * Whether a path is a folder. A symbolic link to a folder counts as one, so
 * that a project folder moved to another disk, with a link to it in its
 * place, is still the project's.
 */
async function isFolder(file: string): Promise<boolean> {
  return (await fs.stat(file).catch(() => null))?.isDirectory() ?? false
}

/**
 * Where a symbolic link leads when nothing is there, following links to
 * links; `null` for anything else, such as a folder or a link to one.
 */
async function danglingTarget(file: string): Promise<string | null> {
  try {
    if (!(await fs.lstat(file)).isSymbolicLink()) return null
    const reached = await fs.stat(file).then(
      () => true,
      (error: NodeJS.ErrnoException) => error.code !== 'ENOENT' && error.code !== 'ENOTDIR',
    )
    if (reached) return null
    let target = file
    // As many links as the system follows in a path.
    for (let hop = 0; hop < 40; hop++) {
      const stats = await fs.lstat(target).catch(() => null)
      if (!stats?.isSymbolicLink()) return target
      target = path.resolve(path.dirname(target), await fs.readlink(target))
    }
    return target
  } catch {
    return null
  }
}

/**
 * `undefined` when nothing is at the path, `null` when it is not a project
 * folder of Hoot's (also a link that leads nowhere).
 */
async function readMarker(folder: string): Promise<string | null | undefined> {
  if (!(await exists(folder))) return undefined
  if (!(await isFolder(folder))) return null
  try {
    const marker = JSON.parse(await fs.readFile(path.join(folder, PROJECT_MARKER), 'utf8'))
    return typeof marker?.root === 'string' ? marker.root : null
  } catch {
    return null
  }
}

/**
 * Where Hoot creates worktrees: `<directory>/<project folder>/<worktree folder>`.
 *
 * Each project has one project folder, named after the project, with a suffix
 * when another project of the same name has the folder. A marker file in the
 * folder says which project it belongs to, so that every Hoot that shares the
 * directory (an installed one and one run from its repository, with different
 * user data) picks the same folder for a project.
 */
export class WorktreeLayout {
  constructor(
    /** The directory that holds the project folders, `~/.hoot/worktrees`. */
    readonly directory: string,
    /** The home directory, shown as `~` in paths. */
    private readonly home: string,
  ) {}

  /** A path with the home directory shown as `~`. */
  displayPath(file: string): string {
    return displayPath(file, this.home)
  }

  /** The project folder that already belongs to the project, if any. */
  async existingProjectFolder(projectRoot: string): Promise<string | null> {
    const entries = await fs.readdir(this.directory).catch(() => [] as string[])
    for (const entry of entries.toSorted()) {
      const folder = path.join(this.directory, entry)
      if ((await readMarker(folder)) === projectRoot) return folder
    }
    return null
  }

  /**
   * The entries of the directory that are symbolic links leading nowhere,
   * each with where it leads: a project folder moved to another disk, with a
   * link to it in its place, while that disk is not connected, say. Which
   * project such a folder belongs to cannot be read from its marker then.
   */
  async danglingFolders(): Promise<Array<{ folder: string; target: string }>> {
    const entries = await fs.readdir(this.directory).catch(() => [] as string[])
    const found: Array<{ folder: string; target: string }> = []
    for (const entry of entries.toSorted()) {
      const folder = path.join(this.directory, entry)
      const target = await danglingTarget(folder)
      if (target !== null) found.push({ folder, target })
    }
    return found
  }

  /**
   * The project folder of a project: the one that belongs to it, or else the
   * first of `<name>`, `<name>-2`, `<name>-3`, … that does not belong to
   * another project. With `create`, the folder is created (when needed) and
   * marked as the project's; otherwise nothing is changed.
   */
  async projectFolder(
    projectRoot: string,
    options: { create: boolean },
  ): Promise<{ folder: string; created: boolean }> {
    const existing = await this.existingProjectFolder(projectRoot)
    if (existing) return { folder: existing, created: false }
    const base = safeName(path.basename(projectRoot)) || 'project'
    for (let attempt = 1; ; attempt++) {
      const folder = path.join(this.directory, attempt === 1 ? base : `${base}-${attempt}`)
      const marker = await readMarker(folder)
      if (marker !== undefined && marker !== null) continue
      // Not a folder: a file, or a link that leads nowhere.
      if (marker === null && !(await isFolder(folder))) continue
      if (!options.create) return { folder, created: false }
      let created = false
      if (marker === undefined) {
        await fs.mkdir(this.directory, { recursive: true })
        try {
          await fs.mkdir(folder)
          created = true
        } catch (error) {
          // Someone else took the name in the meantime: look again.
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
            attempt--
            continue
          }
          throw error
        }
      }
      // A folder without a marker (for example one made by hand, or a link to
      // one) is taken over.
      await fs.writeFile(
        path.join(folder, PROJECT_MARKER),
        `${JSON.stringify({ root: projectRoot })}\n`,
      )
      return { folder, created }
    }
  }

  /**
   * The root directory for a new worktree of a branch in a project folder:
   * the first of `<safe name>`, `<safe name>-2`, `<safe name>-3`, … that does
   * not exist.
   */
  async worktreeRoot(projectFolder: string, branch: string): Promise<string> {
    const base = safeName(branch)
    for (let attempt = 1; ; attempt++) {
      const candidate = path.join(projectFolder, attempt === 1 ? base : `${base}-${attempt}`)
      if (!(await exists(candidate))) return candidate
    }
  }

  /** Removes a project folder that holds nothing but its marker. */
  async removeIfEmpty(projectFolder: string): Promise<void> {
    const entries = await fs.readdir(projectFolder).catch(() => null)
    if (!entries || entries.some((entry) => entry !== PROJECT_MARKER)) return
    await fs.rm(projectFolder, { recursive: true, force: true }).catch(() => undefined)
  }
}

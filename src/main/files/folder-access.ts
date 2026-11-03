/**
 * How long a folder found to be one of a project's worktrees is taken to
 * stay one, in milliseconds, before Git is asked again.
 */
const WORKTREE_CHECK_MS = 10_000

export interface FolderAccessOptions {
  /** Whether `root` is the root of a project in the list. */
  isProject(root: string): boolean
  /** Whether `worktreePath` is one of the worktrees of the project at `projectRoot`, as Git lists them. */
  isWorktreeOf(projectRoot: string, worktreePath: string): Promise<boolean>
  now?: () => number
}

/**
 * Which folders the file panel may read and write files in: the own folder of
 * a project in the list, and the worktrees of such a project. The panel asks
 * about its folder for every file it reads or writes; what Git says about a
 * worktree is kept for a few seconds, so that it is not asked every time.
 */
export class FolderAccess {
  private readonly worktrees = new Map<string, { until: number; found: Promise<boolean> }>()

  constructor(private readonly options: FolderAccessOptions) {}

  /**
   * The folder the panel shows for `projectRoot` and `worktreePath` (`null`
   * for the project's own folder), or `null` when the panel may not show it.
   */
  async folder(projectRoot: string, worktreePath: string | null): Promise<string | null> {
    if (!this.options.isProject(projectRoot)) return null
    if (worktreePath === null) return projectRoot
    const key = `${projectRoot}\0${worktreePath}`
    const now = (this.options.now ?? Date.now)()
    let check = this.worktrees.get(key)
    if (check === undefined || check.until <= now) {
      check = {
        until: now + WORKTREE_CHECK_MS,
        found: this.options.isWorktreeOf(projectRoot, worktreePath).catch(() => false),
      }
      this.worktrees.set(key, check)
    }
    const found = await check.found
    // A folder that is not a worktree yet may be one soon: it is asked about again next time.
    if (!found && this.worktrees.get(key) === check) this.worktrees.delete(key)
    return found ? worktreePath : null
  }
}

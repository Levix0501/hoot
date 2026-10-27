/**
 * A project's own folder, the main worktree of its repository, as Hoot last
 * looked at it: whether it is there, and what is checked out in it, which
 * the project's Local row shows after its name.
 */
export interface ProjectFolderInfo {
  /** Nothing is at the folder's path any more, or what is there is not a folder. */
  missing: boolean
  /** The branch checked out, or `null` when HEAD is on no branch or cannot be read. */
  branch: string | null
  /**
   * The branch, or on a HEAD that is on no branch its abbreviated commit, as
   * a worktree row without a name shows it; empty when neither can be told.
   */
  displayName: string
}

/** Whether two looks at a project folder found the same. */
export function sameProjectFolder(a: ProjectFolderInfo | null, b: ProjectFolderInfo): boolean {
  return (
    a !== null &&
    a.missing === b.missing &&
    a.branch === b.branch &&
    a.displayName === b.displayName
  )
}

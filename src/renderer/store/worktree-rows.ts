import { compareWorktrees, type WorktreeInfo } from '../../shared/worktrees'

/** A worktree row of the sidebar. */
export interface WorktreeRow extends WorktreeInfo {
  /**
   * False for a worktree that Git no longer lists but that still has
   * sessions: its row stays, as missing, until they are closed.
   */
  registered: boolean
}

function fallbackInfo(path: string): WorktreeInfo {
  return {
    path,
    branch: null,
    displayName: path.split('/').filter(Boolean).at(-1) ?? path,
    name: null,
    createdAt: 0,
    missing: true,
    locked: false,
    lockReason: null,
    innerMembers: [],
  }
}

/**
 * The worktree rows of a project, in sidebar order: its worktrees as Git
 * lists them, and the worktrees its sessions run in that Git no longer lists,
 * as they were last known.
 */
export function worktreeRows(
  listed: readonly WorktreeInfo[] | undefined,
  sessionWorktrees: readonly string[],
  known: Readonly<Record<string, WorktreeInfo>>,
): WorktreeRow[] {
  const rows: WorktreeRow[] = (listed ?? []).map((worktree) => ({ ...worktree, registered: true }))
  const paths = new Set(rows.map((row) => row.path))
  for (const path of sessionWorktrees) {
    if (paths.has(path)) continue
    paths.add(path)
    rows.push({
      ...(known[path] ?? fallbackInfo(path)),
      missing: true,
      locked: false,
      lockReason: null,
      registered: false,
    })
  }
  return rows.toSorted(compareWorktrees)
}

import { compareWorktrees, type WorktreeInfo } from '../../shared/worktrees'

/**
 * A worktree row of the sidebar: of a worktree Git lists, or of one Git no
 * longer lists that still has open sessions, which shows as missing.
 */
export type WorktreeRow = WorktreeInfo

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
  const rows: WorktreeRow[] = [...(listed ?? [])]
  const paths = new Set(rows.map((row) => row.path))
  for (const path of sessionWorktrees) {
    if (paths.has(path)) continue
    paths.add(path)
    rows.push({
      ...(known[path] ?? fallbackInfo(path)),
      missing: true,
      locked: false,
      lockReason: null,
    })
  }
  return rows.toSorted(compareWorktrees)
}

import { describe, expect, it } from 'vitest'
import type { WorktreeInfo } from '../../shared/worktrees'
import { worktreeRows } from './worktree-rows'

const worktree = (path: string, displayName: string, changes: Partial<WorktreeInfo> = {}) => ({
  path,
  branch: displayName,
  displayName,
  name: null,
  createdAt: 0,
  missing: false,
  locked: false,
  lockReason: null,
  innerMembers: [],
  ...changes,
})

describe('worktreeRows', () => {
  it('lists the worktrees Git lists, by display name', () => {
    const rows = worktreeRows([worktree('/w/b', 'b-tree'), worktree('/w/a', 'a-tree')], [], {})
    expect(rows.map((row) => [row.displayName, row.registered])).toEqual([
      ['a-tree', true],
      ['b-tree', true],
    ])
  })

  it('keeps a row, as missing, for a worktree that is gone while sessions run in it', () => {
    const known = { '/w/gone': worktree('/w/gone', 'gone', { locked: true, lockReason: 'x' }) }
    const rows = worktreeRows(
      [worktree('/w/a', 'a-tree')],
      ['/w/a', '/w/gone', '/w/unknown'],
      known,
    )
    expect(rows.map((row) => [row.path, row.displayName, row.missing, row.registered])).toEqual([
      ['/w/a', 'a-tree', false, true],
      ['/w/gone', 'gone', true, false],
      ['/w/unknown', 'unknown', true, false],
    ])
    expect(rows[1]).toMatchObject({ locked: false, lockReason: null })
  })

  it('has no rows for a project without worktrees', () => {
    expect(worktreeRows(undefined, [], {})).toEqual([])
  })
})

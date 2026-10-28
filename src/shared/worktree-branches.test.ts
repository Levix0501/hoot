import { describe, expect, it } from 'vitest'
import {
  alsoDeleteLabel,
  branchesNote,
  branchesToDelete,
  mergedBranches,
  noteText,
} from './worktree-branches'
import type { WorktreeBranch, WorktreeInspection } from './worktrees'

const branch = (
  repository: string,
  name: string | null,
  merged: boolean,
  current: string | null = 'main',
): WorktreeBranch => ({
  repository,
  relativePath: repository === 'app' ? '' : repository,
  branch: name,
  current,
  merged,
})

/** An inspection of a worktree with these branches, and inner members for all but the first. */
function inspection(
  branches: WorktreeBranch[],
): Pick<WorktreeInspection, 'branch' | 'branches' | 'innerMembers'> {
  return {
    branch: branches[0]?.branch ?? null,
    branches,
    innerMembers: branches.slice(1).map((entry) => `/w/x/${entry.repository}`),
  }
}

describe('the branches of a worktree being deleted', () => {
  it('offers no checkbox, and says the branch is kept as before, while none is merged', () => {
    const one = inspection([branch('app', 'feature-x', false)])
    expect(mergedBranches(one)).toEqual([])
    expect(alsoDeleteLabel(one)).toBeNull()
    expect(noteText(branchesNote(one, true))).toBe('The branch feature-x will be kept.')
    const both = inspection([
      branch('app', 'feature-x', false),
      branch('inner', 'feature-x', false),
    ])
    expect(noteText(branchesNote(both, true))).toBe(
      'The branch feature-x will be kept in every repository.',
    )
    expect(noteText(branchesNote(inspection([branch('app', null, false)]), true))).toBe(
      'No branch will be deleted.',
    )
    // On a project folder on no branch, nothing is merged.
    expect(alsoDeleteLabel(inspection([branch('app', 'feature-x', false, null)]))).toBeNull()
  })

  it('names the merged branches in the checkbox, and says where each is deleted and kept', () => {
    const outerOnly = inspection([
      branch('app', 'feature-x', true),
      branch('inner', 'feature-x', false),
    ])
    expect(noteText([alsoDeleteLabel(outerOnly)!])).toBe('Also delete the branch feature-x')
    expect(noteText(branchesNote(outerOnly, true))).toBe(
      'The branch feature-x will be deleted in app and kept in inner.',
    )
    // Unchecked, every branch is kept, as before.
    expect(noteText(branchesNote(outerOnly, false))).toBe(
      'The branch feature-x will be kept in every repository.',
    )

    const all = inspection([
      branch('app', 'feature-x', true),
      branch('inner', 'feature-x', true),
      branch('inner/deep', 'feature-x', true),
    ])
    expect(noteText(branchesNote(all, true))).toBe(
      'The branch feature-x will be deleted in app, inner, and inner/deep.',
    )
    expect(noteText(branchesNote(inspection([branch('app', 'feature-x', true)]), true))).toBe(
      'The branch feature-x will be deleted.',
    )
  })

  it('tells branches of different names apart, and leaves out a member on no branch', () => {
    const mixed = inspection([
      branch('app', 'feature-x', true),
      branch('inner', 'other', true),
      branch('second', 'other', false),
      branch('third', null, false),
    ])
    expect(noteText([alsoDeleteLabel(mixed)!])).toBe('Also delete the branches feature-x and other')
    expect(branchesNote(mixed, true)).toEqual([
      [
        { text: 'The branch ', user: false },
        { text: 'feature-x', user: true },
        { text: ' will be ', user: false },
        { text: 'deleted in ', user: false },
        { text: 'app', user: true },
        { text: '.', user: false },
      ],
      [
        { text: 'The branch ', user: false },
        { text: 'other', user: true },
        { text: ' will be ', user: false },
        { text: 'deleted in ', user: false },
        { text: 'inner', user: true },
        { text: ' and kept in ', user: false },
        { text: 'second', user: true },
        { text: '.', user: false },
      ],
    ])
    // What deleting it deletes too, member by member: the merged branches the note names.
    expect(branchesToDelete(mixed)).toEqual([
      { relativePath: '', branch: 'feature-x' },
      { relativePath: 'inner', branch: 'other' },
    ])
    const keptElsewhere = inspection([
      branch('app', 'feature-x', true),
      branch('inner', 'mine', false),
    ])
    expect(noteText(branchesNote(keptElsewhere, true))).toBe(
      'The branch feature-x will be deleted in app. The branch mine will be kept in inner.',
    )
  })
})

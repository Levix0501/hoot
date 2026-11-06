import { describe, expect, it } from 'vitest'
import { deletionInstruction, type DeletionPlan } from './deletion'

describe('deletionInstruction', () => {
  const plan: DeletionPlan = {
    worktreeName: 'feature-x',
    worktreePath: '/home/me/.hoot/worktrees/app/feature-x',
    repositories: [{ path: '/work/app', branch: 'feature-x' }],
  }

  it('says what to delete in one sentence: the worktree and its branch', () => {
    expect(deletionInstruction(plan)).toBe(
      'Delete the worktree feature-x, at /home/me/.hoot/worktrees/app/feature-x, and its branch `feature-x` in /work/app.',
    )
  })

  it('names the branch of each repository of a worktree with inner members', () => {
    expect(
      deletionInstruction({
        ...plan,
        repositories: [
          { path: '/work/app', branch: 'feature-x' },
          { path: '/work/app/inner1', branch: 'feature-x' },
          { path: '/work/app/inner2', branch: 'own' },
        ],
      }),
    ).toBe(
      'Delete the worktree feature-x, at /home/me/.hoot/worktrees/app/feature-x, and its branches: `feature-x` in /work/app, `feature-x` in /work/app/inner1, and `own` in /work/app/inner2.',
    )
  })

  it('names no branch for a HEAD on none', () => {
    expect(
      deletionInstruction({ ...plan, repositories: [{ path: '/work/app', branch: null }] }),
    ).toBe('Delete the worktree feature-x, at /home/me/.hoot/worktrees/app/feature-x.')
    expect(
      deletionInstruction({
        ...plan,
        repositories: [
          { path: '/work/app', branch: 'feature-x' },
          { path: '/work/app/inner1', branch: null },
        ],
      }),
    ).toBe(
      'Delete the worktree feature-x, at /home/me/.hoot/worktrees/app/feature-x, and its branches: `feature-x` in /work/app and no branch in /work/app/inner1.',
    )
  })

  it('says nothing of how to delete, which the agent judges itself', () => {
    expect(deletionInstruction(plan)).not.toMatch(
      /git worktree|branch -[dD]|--force|merged|uncommitted|ask me|\bcheck/i,
    )
  })
})

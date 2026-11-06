import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkedOutBranch, mergeInstruction, type MergePlan } from './merge'
import type { GitContext } from './repositories'
import { git, makeRepository, makeSandbox } from './test-support'

describe('mergeInstruction', () => {
  const plan: MergePlan = {
    worktreeName: 'feature-x',
    worktreePath: '/home/me/.hoot/worktrees/app/feature-x',
    repositories: [
      { path: '/work/app', branch: 'feature-x', into: 'main' },
      { path: '/work/app/inner1', branch: 'feature-x', into: 'develop' },
    ],
  }

  it('says what to merge in one sentence: the branch of each repository, into the one checked out there', () => {
    expect(mergeInstruction(plan)).toBe(
      'Merge the worktree feature-x, at /home/me/.hoot/worktrees/app/feature-x, into the project folder: `feature-x` into `main` in /work/app and `feature-x` into `develop` in /work/app/inner1.',
    )
    expect(mergeInstruction({ ...plan, repositories: plan.repositories.slice(0, 1) })).toBe(
      'Merge the worktree feature-x, at /home/me/.hoot/worktrees/app/feature-x, into the project folder: `feature-x` into `main` in /work/app.',
    )
  })

  it('says where a HEAD is on no branch, in the worktree or in the project folder', () => {
    expect(
      mergeInstruction({
        ...plan,
        repositories: [
          { path: '/work/app', branch: null, into: 'main' },
          { path: '/work/app/inner1', branch: 'feature-x', into: null },
          { path: '/work/app/inner2', branch: 'feature-x', into: 'main' },
        ],
      }),
    ).toBe(
      "Merge the worktree feature-x, at /home/me/.hoot/worktrees/app/feature-x, into the project folder: the worktree's detached HEAD into `main` in /work/app, `feature-x` into the detached HEAD in /work/app/inner1, and `feature-x` into `main` in /work/app/inner2.",
    )
  })

  it('says nothing of how to merge, which the agent judges itself', () => {
    expect(mergeInstruction(plan)).not.toMatch(
      /git merge|rebase|squash|conflict|commit|push|delete|ask me|\btest|\bcheck/i,
    )
  })
})

describe('the branches of a repository', () => {
  let root: string
  let context: GitContext
  let repository: string

  beforeEach(() => {
    ;({ root, context } = makeSandbox('hoot-merge-'))
    repository = makeRepository(path.join(root, 'repository'))
  })

  afterEach(async () => {
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('tells the branch checked out, or none on a detached HEAD', async () => {
    expect(await checkedOutBranch(context, repository)).toBe('main')
    git(repository, 'checkout', '-q', '--detach')
    expect(await checkedOutBranch(context, repository)).toBeNull()
  })
})

import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  checkedOutBranch,
  describeMergeFindings,
  hasUnfinishedMerge,
  isMergedInto,
  mergeInstruction,
  noFindings,
  nothingToMerge,
  type MergePlan,
} from './merge'
import type { GitContext } from './repositories'
import { addBranch, git, makeRepository, makeSandbox } from './test-support'

describe('describeMergeFindings', () => {
  it('says nothing when nothing stops the merge', () => {
    expect(describeMergeFindings(noFindings())).toEqual([])
  })

  it('says what stops the merge, check by check, naming the repositories', () => {
    expect(
      describeMergeFindings({
        detachedInFolder: ['app'],
        changedInFolder: ['app', 'inner1', 'inner2'],
        unfinishedInFolder: ['inner2'],
        changedInWorktree: ['inner1'],
        runningSessions: 2,
        locked: { reason: 'on usb' },
        detachedInWorktree: ['app', 'inner1'],
      }),
    ).toEqual([
      'app has no branch checked out in the project folder.',
      'app, inner1, and inner2 have uncommitted changes in the project folder: commit or stash them first.',
      'inner2 has a merge or rebase in progress in the project folder: finish or abort it first.',
      'inner1 has uncommitted changes in the worktree: commit them first.',
      '2 sessions are still running in the worktree: close them first.',
      'The worktree is locked: on usb.',
      'app and inner1 have no branch checked out in the worktree.',
    ])
    expect(
      describeMergeFindings({ ...noFindings(), runningSessions: 1, locked: { reason: null } }),
    ).toEqual([
      'A session is still running in the worktree: close it first.',
      'The worktree is locked.',
    ])
  })

  it('says that a worktree merged already has nothing new to merge, and can be deleted', () => {
    expect(nothingToMerge('feature-x', ['main', 'main'])).toBe(
      'feature-x has no new commits to merge into main. You can delete the worktree with Delete.',
    )
    expect(nothingToMerge('feature-x', ['main', 'develop'])).toBe(
      'feature-x has no new commits to merge into the branches checked out in the project folder. You can delete the worktree with Delete.',
    )
  })
})

describe('mergeInstruction', () => {
  const plan: MergePlan = {
    worktreeName: 'feature-x',
    worktreePath: '/home/me/.hoot/worktrees/app/feature-x',
    projectFolder: '/work/app',
    repositories: [
      { label: 'app', path: '/work/app', branch: 'feature-x', into: 'main' },
      { label: 'inner1', path: '/work/app/inner1', branch: 'feature-x', into: 'develop' },
    ],
  }

  it('names each repository by its path in the project folder, with the branches to merge', () => {
    const text = mergeInstruction(plan)
    expect(text).toContain('/home/me/.hoot/worktrees/app/feature-x')
    expect(text).toContain('- /work/app: merge `feature-x` into `main`')
    expect(text).toContain('- /work/app/inner1: merge `feature-x` into `develop`')
    expect(text).toContain('In each of these repositories of the project folder')
  })

  it('asks for git merge in the project folder, conflicts resolved, nothing pushed or deleted, and a word once done', () => {
    const text = mergeInstruction(plan)
    for (const asked of [
      'Work in the project folder, and make each merge with `git merge`: do not rebase, and do not squash.',
      'Finish each merge, and commit the merge commit when one is needed.',
      'If there are conflicts, resolve them, keeping the intent of the changes on both sides, and make no changes unrelated to the merge.',
      'When you are unsure how to resolve something, stop and ask me.',
      'Do not push, do not delete any branch, and do not delete the worktree.',
      'When every repository is merged, tell me that the merge is complete and that the worktree can be deleted now. Then stop and wait for me.',
    ]) {
      expect(text).toContain(asked)
    }
    // It asks for no checks.
    expect(text).not.toMatch(/\btest|\bchecks\b|\blint/i)
    expect(mergeInstruction({ ...plan, repositories: plan.repositories.slice(0, 1) })).toContain(
      'When the repository is merged, tell me',
    )
  })
})

describe('the state of a repository before a merge', () => {
  let root: string
  let context: GitContext
  let repository: string

  beforeEach(() => {
    ;({ root, context } = makeSandbox('hoot-merge-'))
    repository = makeRepository(path.join(root, 'repository'))
    addBranch(repository, 'feature')
  })

  afterEach(async () => {
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('tells the branch checked out, or none on a detached HEAD', async () => {
    expect(await checkedOutBranch(context, repository)).toBe('main')
    git(repository, 'checkout', '-q', '--detach')
    expect(await checkedOutBranch(context, repository)).toBeNull()
  })

  it('tells whether a branch is merged into another: the same commit, or one in its history', async () => {
    expect(await isMergedInto(context, repository, 'feature', 'main')).toBe(false)
    expect(await isMergedInto(context, repository, 'main', 'feature')).toBe(true)
    git(repository, 'merge', '-q', '--no-edit', 'feature')
    expect(await isMergedInto(context, repository, 'feature', 'main')).toBe(true)
    expect(await isMergedInto(context, repository, 'gone', 'main')).toBe(false)
  })

  it('tells a merge or a rebase that was started and has neither finished nor been aborted', async () => {
    expect(await hasUnfinishedMerge(context, repository)).toBe(false)
    // Stopped in the middle, with nothing uncommitted.
    fs.writeFileSync(path.join(repository, 'second.txt'), 'second\n')
    git(repository, 'add', '.')
    git(repository, 'commit', '-q', '-m', 'second')
    expect(() => git(repository, 'rebase', '--exec', 'false', 'HEAD~1')).toThrow('Command failed')
    expect(await hasUnfinishedMerge(context, repository)).toBe(true)
    git(repository, 'rebase', '--abort')
    expect(await hasUnfinishedMerge(context, repository)).toBe(false)

    // Stopped at a conflict.
    fs.writeFileSync(path.join(repository, 'feature.txt'), 'main\n')
    git(repository, 'add', '.')
    git(repository, 'commit', '-q', '-m', 'conflicting')
    expect(() => git(repository, 'merge', 'feature')).toThrow('Command failed')
    expect(await hasUnfinishedMerge(context, repository)).toBe(true)
    git(repository, 'merge', '--abort')
    expect(await hasUnfinishedMerge(context, repository)).toBe(false)
  })
})

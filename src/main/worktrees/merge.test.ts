import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkedOutBranch, isMergedInto } from './merge'
import type { GitContext } from './repositories'
import { addBranch, git, makeRepository, makeSandbox } from './test-support'

describe('the branches of a repository', () => {
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
})

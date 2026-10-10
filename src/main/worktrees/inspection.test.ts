import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LISTED_FILES, hasDetachedCommit, inspectMembers, parseStatus } from './inspection'
import type { GitContext } from './repositories'
import { git, makeRepository, makeSandbox } from './test-support'

describe('parseStatus', () => {
  it('reads one path per changed file, renames included', () => {
    expect(
      parseStatus(' M a.txt\0A  new file.txt\0R  moved.txt\0old.txt\0?? dir/u.txt\0 D gone.txt\0'),
    ).toEqual(['a.txt', 'new file.txt', 'moved.txt', 'dir/u.txt', 'gone.txt'])
    expect(parseStatus('')).toEqual([])
  })
})

describe('inspectMembers', () => {
  let root: string
  let context: GitContext
  let project: string
  let inner: string
  let worktree: string

  beforeAll(() => {
    ;({ root, context } = makeSandbox('hoot-inspection-'))
    project = makeRepository(path.join(root, 'project'))
    fs.writeFileSync(path.join(project, '.gitignore'), '/inner/\n/build/\n/node_modules/\n')
    git(project, 'add', '.')
    git(project, 'commit', '-q', '-m', 'ignore')
    inner = makeRepository(path.join(project, 'inner'))
    worktree = path.join(root, 'worktree')
    git(project, 'worktree', 'add', '-q', '-b', 'feat', worktree)
    git(inner, 'worktree', 'add', '-q', '-b', 'feat', path.join(worktree, 'inner'))
  })

  afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

  const members = () => [
    { label: 'project', path: worktree, relativePath: '' },
    { label: 'inner', path: path.join(worktree, 'inner'), relativePath: 'inner' },
  ]

  it('finds nothing to lose in a clean worktree', async () => {
    expect(await inspectMembers(context, worktree, members())).toEqual({
      changes: [],
      foreignRepositories: [],
    })
  })

  it('lists changes by repository, a few files with the total, and foreign repositories', async () => {
    fs.appendFileSync(path.join(worktree, 'inner', 'README.md'), 'changed\n')
    for (let index = 0; index < 15; index++) {
      fs.writeFileSync(path.join(worktree, 'inner', `new-${index}.txt`), 'x\n')
    }
    makeRepository(path.join(worktree, 'build', 'cloned'))
    makeRepository(path.join(worktree, 'node_modules', 'dependency'))
    const { changes, foreignRepositories } = await inspectMembers(context, worktree, members())
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ repository: 'inner', total: 16, detachedCommits: false })
    expect(changes[0]!.files).toHaveLength(LISTED_FILES)
    expect(foreignRepositories).toEqual(['build/cloned'])
  })

  it('reports commits that are on no branch', async () => {
    const detached = makeRepository(path.join(root, 'detached'))
    git(detached, 'checkout', '-q', '--detach')
    expect(await hasDetachedCommit(context, detached)).toBe(false)
    git(detached, 'commit', '-q', '--allow-empty', '-m', 'on no branch')
    expect(await hasDetachedCommit(context, detached)).toBe(true)
    // A commit in a remote-tracking branch is not lost.
    git(detached, 'update-ref', 'refs/remotes/origin/kept', 'HEAD')
    expect(await hasDetachedCommit(context, detached)).toBe(false)
  })
})

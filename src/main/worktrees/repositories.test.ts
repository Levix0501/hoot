import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  DEPENDENCY_DIRECTORIES,
  findInnerRepositories,
  holdsRepository,
  readBranches,
  submodulesAt,
  type GitContext,
} from './repositories'
import { addBranch, git, makeRepository, makeSandbox } from './test-support'

let root: string
let context: GitContext
let project: string

beforeAll(() => {
  ;({ root, context } = makeSandbox('hoot-repositories-'))
  project = makeRepository(path.join(root, 'project'))
  fs.writeFileSync(path.join(project, '.gitignore'), '/inner/\n/build/\n')
  fs.mkdirSync(path.join(project, 'src', 'lib'), { recursive: true })
  fs.writeFileSync(path.join(project, 'src', 'lib', 'tracked.txt'), 'tracked\n')
  git(project, 'add', '.')
  git(project, 'commit', '-q', '-m', 'layout')
  addBranch(project, 'develop')

  // Ignored, with a repository inside that it ignores itself.
  const inner = makeRepository(path.join(project, 'inner'))
  fs.writeFileSync(path.join(inner, '.gitignore'), '/deep/\n')
  git(inner, 'add', '.')
  git(inner, 'commit', '-q', '-m', 'ignore deep')
  addBranch(inner, 'develop')
  makeRepository(path.join(inner, 'deep'))
  // Neither tracked nor ignored, inside a tracked directory, and without commits.
  makeRepository(path.join(project, 'src', 'lib', 'loose'), 'trunk')
  fs.mkdirSync(path.join(project, 'empty'))
  git(path.join(project, 'empty'), 'init', '-q')
  // In an ignored directory, at depth.
  makeRepository(path.join(project, 'build', 'out', 'cloned'))

  // Not inner repositories.
  for (const name of DEPENDENCY_DIRECTORIES) makeRepository(path.join(project, 'deps', name, 'x'))
  git(project, 'worktree', 'add', '-q', '-b', 'side', path.join(project, '.claude', 'side'))
  git(inner, 'worktree', 'add', '-q', '-b', 'inner-side', path.join(project, 'inner-side'))
  fs.symlinkSync(makeRepository(path.join(root, 'linked-target')), path.join(project, 'link'))
  const source = makeRepository(path.join(root, 'module-source'))
  git(project, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', source, 'mod')
  git(project, 'commit', '-q', '-m', 'submodule')
  // A repository made where the project tracks files.
  const vendored = path.join(project, 'vendored')
  fs.mkdirSync(vendored)
  fs.writeFileSync(path.join(vendored, 'file.txt'), 'tracked by the project\n')
  git(project, 'add', 'vendored')
  git(project, 'commit', '-q', '-m', 'vendored')
  git(vendored, 'init', '-q', '-b', 'main')

  // A linked worktree of a repository outside the project stands for it, once.
  const outside = makeRepository(path.join(root, 'outside'))
  git(outside, 'worktree', 'add', '-q', '-b', 'a', path.join(project, 'external', 'a'))
  git(outside, 'worktree', 'add', '-q', '-b', 'b', path.join(project, 'external', 'b'))
})

afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

describe('findInnerRepositories', () => {
  it('finds ignored and untracked repositories at any depth, and leaves out the rest', async () => {
    const found = await findInnerRepositories(context, project)
    expect(found.map((repository) => repository.relativePath)).toEqual([
      'build/out/cloned',
      'empty',
      'external/a',
      'inner',
      'inner/deep',
      'src/lib/loose',
    ])
    expect(found.find((repository) => repository.relativePath === 'inner')).toEqual({
      path: path.join(project, 'inner'),
      relativePath: 'inner',
      commonDir: path.join(project, 'inner', '.git'),
    })
    expect(found.find((repository) => repository.relativePath === 'external/a')!.commonDir).toBe(
      path.join(root, 'outside', '.git'),
    )
  })

  it('finds nothing in a repository without other repositories', async () => {
    expect(await findInnerRepositories(context, path.join(root, 'module-source'))).toEqual([])
  })
})

describe('holdsRepository', () => {
  it('tells the folders that are or hold repositories at any depth, as they are walked', async () => {
    expect(await holdsRepository(path.join(project, 'inner'))).toBe(true)
    expect(await holdsRepository(path.join(project, 'build'))).toBe(true)
    expect(await holdsRepository(path.join(project, 'src'))).toBe(true)
    // Not repositories in dependency directories or reached through a link.
    expect(await holdsRepository(path.join(project, 'deps'))).toBe(false)
    expect(await holdsRepository(path.join(project, 'link'))).toBe(false)
    const plain = path.join(root, 'plain')
    fs.mkdirSync(path.join(plain, 'a', 'b'), { recursive: true })
    fs.writeFileSync(path.join(plain, 'a', 'file.txt'), 'plain\n')
    expect(await holdsRepository(plain)).toBe(false)
    expect(await holdsRepository(path.join(plain, 'a', 'file.txt'))).toBe(false)
    expect(await holdsRepository(path.join(root, 'nothing-here'))).toBe(false)
  })
})

describe('readBranches', () => {
  it('reads the local branches and the checked-out one', async () => {
    expect(await readBranches(context, project)).toEqual({
      branches: ['develop', 'main', 'side'],
      current: 'main',
      hasCommits: true,
    })
    expect(await readBranches(context, path.join(project, 'empty'))).toMatchObject({
      branches: [],
      current: null,
      hasCommits: false,
    })
    const detached = makeRepository(path.join(root, 'detached'))
    git(detached, 'checkout', '-q', '--detach')
    expect(await readBranches(context, detached)).toEqual({
      branches: ['main'],
      current: null,
      hasCommits: true,
    })
  })
})

describe('submodulesAt', () => {
  it('lists the gitlinks of a commit', async () => {
    expect(await submodulesAt(context, project, 'refs/heads/main')).toEqual(['mod'])
    expect(await submodulesAt(context, project, 'refs/heads/develop')).toEqual([])
  })
})

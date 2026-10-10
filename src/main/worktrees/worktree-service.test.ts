import { once } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { WorktreeInfo } from '../../shared/worktrees'
import { WorktreeLayout } from './layout'
import type { GitContext } from './repositories'
import {
  addBranch,
  branches,
  git,
  linkedWorktrees,
  makeRepository,
  makeSandbox,
} from './test-support'
import { WorktreeService, deepestFirst, isRegistrationChange } from './worktree-service'

describe('isRegistrationChange', () => {
  it('matches the administrative directories, their gitdir, lock and HEAD files', () => {
    expect(isRegistrationChange('worktrees')).toBe(true)
    expect(isRegistrationChange('worktrees/feat')).toBe(true)
    expect(isRegistrationChange('worktrees/feat/gitdir')).toBe(true)
    expect(isRegistrationChange('worktrees/feat/locked')).toBe(true)
    expect(isRegistrationChange('worktrees/feat/HEAD')).toBe(true)
    expect(isRegistrationChange('worktrees/feat/index')).toBe(false)
    expect(isRegistrationChange('worktrees/feat/logs/HEAD')).toBe(false)
    expect(isRegistrationChange('refs/heads/main')).toBe(false)
    expect(isRegistrationChange('index')).toBe(false)
  })
})

describe('deepestFirst', () => {
  it('orders members by depth, deepest first', () => {
    const members = ['inner', 'loose', 'inner/deep', 'a/b/c'].map((relativePath) => ({
      relativePath,
    }))
    expect(deepestFirst(members).map((member) => member.relativePath)).toEqual([
      'a/b/c',
      'inner/deep',
      'inner',
      'loose',
    ])
  })
})

describe('WorktreeService', () => {
  let root: string
  let home: string
  let context: GitContext
  let service: WorktreeService
  let project: string
  let inner: string
  let deep: string
  let W: string

  beforeEach(() => {
    ;({ root, home, context } = makeSandbox('hoot-worktrees-'))
    W = path.join(home, '.hoot', 'worktrees')
    project = makeRepository(path.join(root, 'project'))
    fs.writeFileSync(path.join(project, '.gitignore'), '/inner/\n')
    git(project, 'add', '.')
    git(project, 'commit', '-q', '-m', 'ignore inner')
    addBranch(project, 'develop')
    inner = makeRepository(path.join(project, 'inner'))
    fs.writeFileSync(path.join(inner, '.gitignore'), '/deep/\n')
    git(inner, 'add', '.')
    git(inner, 'commit', '-q', '-m', 'ignore deep')
    addBranch(inner, 'develop')
    deep = makeRepository(path.join(inner, 'deep'))
    service = new WorktreeService({
      layout: new WorktreeLayout(W, home),
      gitContext: async () => context,
    })
  })

  afterEach(() => {
    service.dispose()
    fs.rmSync(root, { recursive: true, force: true })
  })

  /** Starts on the project and waits until its inner repositories have been found. */
  async function start(): Promise<void> {
    service.addProject(project)
    await service.newWorktreeOptions(project)
  }

  async function listed(): Promise<WorktreeInfo[]> {
    return (await service.listAll())[project] ?? []
  }

  it('lists worktrees made outside Hoot, by display name, with their state and inner members', async () => {
    const outside = path.join(root, 'outside')
    git(project, 'worktree', 'add', '-q', '-b', 'zeta', path.join(outside, 'z'))
    git(project, 'worktree', 'add', '-q', '--detach', path.join(outside, 'd'))
    git(project, 'worktree', 'add', '-q', '-b', 'alpha', path.join(outside, 'a'))
    git(project, 'worktree', 'lock', '--reason', 'on usb', path.join(outside, 'a'))
    git(project, 'worktree', 'add', '-q', '-b', 'beta', path.join(outside, 'b'))
    git(inner, 'worktree', 'add', '-q', '-b', 'beta', path.join(outside, 'b', 'inner'))
    fs.rmSync(path.join(outside, 'b'), { recursive: true })
    git(inner, 'worktree', 'add', '-q', '-b', 'zeta', path.join(outside, 'z', 'inner'))
    // A linked worktree of an inner repository outside any worktree is no member.
    git(deep, 'worktree', 'add', '-q', '-b', 'loner', path.join(outside, 'loner'))
    await start()

    const short = git(path.join(outside, 'd'), 'rev-parse', '--short', 'HEAD')
    const worktrees = await listed()
    expect(worktrees.map((worktree) => worktree.displayName)).toEqual(
      ['alpha', 'beta', 'zeta', short].toSorted((a, b) => a.localeCompare(b)),
    )
    const byName = Object.fromEntries(worktrees.map((worktree) => [worktree.displayName, worktree]))
    expect(byName.alpha).toEqual({
      path: path.join(outside, 'a'),
      branch: 'alpha',
      displayName: 'alpha',
      missing: false,
      locked: true,
      lockReason: 'on usb',
      innerMembers: [],
    })
    expect(byName.beta).toMatchObject({ missing: true, locked: false, innerMembers: ['inner'] })
    expect(byName.zeta).toMatchObject({ missing: false, innerMembers: ['inner'] })
    expect(byName[short]).toMatchObject({ branch: null, path: path.join(outside, 'd') })
    expect(await service.isWorktreeOf(project, path.join(outside, 'z'))).toBe(true)
    expect(await service.isWorktreeOf(project, path.join(outside, 'b'))).toBe(false)
    expect(await service.isWorktreeOf(project, project)).toBe(false)
  })

  it('reports changes to the registrations as they happen', async () => {
    await start()
    const changed = once(service, 'changed')
    const added = path.join(root, 'added')
    git(project, 'worktree', 'add', '-q', '-b', 'added', added)
    const [changedRoot, worktrees] = (await changed) as [string, WorktreeInfo[]]
    expect(changedRoot).toBe(project)
    expect(worktrees.map((worktree) => worktree.path)).toEqual([added])
  })

  it('offers the branches and inner repositories, checks names, and previews the location', async () => {
    await start()
    expect(await service.newWorktreeOptions(project)).toEqual({
      branches: ['develop', 'main'],
      current: 'main',
      nested: [
        { relativePath: 'inner', branches: ['develop', 'main'], current: 'main', hasCommits: true },
        { relativePath: 'inner/deep', branches: ['main'], current: 'main', hasCommits: true },
      ],
    })
    expect(await service.isValidBranchName('feat/login')).toBe(true)
    expect(await service.isValidBranchName('bad..name')).toBe(false)
    expect(await service.isValidBranchName('@{-1}')).toBe(false)
    expect(await service.isValidBranchName('')).toBe(false)
    expect(await service.previewPath(project, 'feat/login')).toEqual({
      path: path.join(W, 'project', 'feat-login'),
      displayPath: '~/.hoot/worktrees/project/feat-login',
    })
    expect(fs.existsSync(W)).toBe(false)
  })

  it('creates a worktree with inner members, each from its base branch', async () => {
    await start()
    const result = await service.create({
      projectRoot: project,
      branch: 'feat/x',
      base: 'develop',
      nested: [
        { relativePath: 'inner', base: 'develop' },
        { relativePath: 'inner/deep', base: 'main' },
      ],
    })
    const R = path.join(W, 'project', 'feat-x')
    expect(result).toEqual({ ok: true, path: R, warning: null })
    expect(linkedWorktrees(project)).toEqual([{ path: R, prunable: false }])
    expect(linkedWorktrees(inner)).toEqual([{ path: path.join(R, 'inner'), prunable: false }])
    expect(linkedWorktrees(deep)).toEqual([
      { path: path.join(R, 'inner', 'deep'), prunable: false },
    ])
    expect(git(R, 'rev-parse', 'HEAD')).toBe(git(project, 'rev-parse', 'develop'))
    expect(git(path.join(R, 'inner'), 'rev-parse', 'HEAD')).toBe(git(inner, 'rev-parse', 'develop'))
    expect(git(R, 'branch', '--show-current')).toBe('feat/x')
    expect((await listed()).map((worktree) => worktree.innerMembers)).toEqual([
      ['inner', 'inner/deep'],
    ])
  })

  it('creates nothing when a repository already has the branch or a base branch is unknown', async () => {
    git(deep, 'branch', 'taken')
    await start()
    const nested = [{ relativePath: 'inner/deep', base: 'main' }]
    expect(
      await service.create({ projectRoot: project, branch: 'taken', base: 'main', nested }),
    ).toEqual({
      ok: false,
      reason: 'branch-exists',
      message: 'A branch named taken already exists in inner/deep.',
    })
    expect(
      await service.create({ projectRoot: project, branch: 'new', base: 'nope', nested: [] }),
    ).toMatchObject({ ok: false, reason: 'invalid' })
    expect(
      await service.create({ projectRoot: project, branch: 'a..b', base: 'main', nested: [] }),
    ).toMatchObject({ ok: false, reason: 'invalid' })
    expect(fs.existsSync(W)).toBe(false)
    expect(branches(project)).toEqual(['develop', 'main'])
  })

  it('undoes what it created when a member cannot be created', async () => {
    // `feat` blocks the creation of `feat/z` in inner/deep only.
    git(deep, 'branch', 'feat')
    await start()
    const result = await service.create({
      projectRoot: project,
      branch: 'feat/z',
      base: 'main',
      nested: [
        { relativePath: 'inner', base: 'main' },
        { relativePath: 'inner/deep', base: 'main' },
      ],
    })
    expect(result).toMatchObject({ ok: false, reason: 'failed' })
    expect(result.ok === false && result.message).toContain("refs/heads/feat' exists")
    for (const repository of [project, inner, deep]) {
      expect(linkedWorktrees(repository)).toEqual([])
      expect(branches(repository)).not.toContain('feat/z')
    }
    expect(fs.existsSync(path.join(W, 'project'))).toBe(false)
    expect(await listed()).toEqual([])
  })

  it('keeps a member whose post-checkout hook fails, and returns the hook output as a warning', async () => {
    fs.writeFileSync(
      path.join(project, '.git', 'hooks', 'post-checkout'),
      '#!/bin/sh\necho "hook says no" >&2\nexit 1\n',
      { mode: 0o755 },
    )
    await start()
    const result = await service.create({
      projectRoot: project,
      branch: 'feat/h',
      base: 'main',
      nested: [{ relativePath: 'inner', base: 'main' }],
    })
    expect(result.ok).toBe(true)
    expect(result.ok && result.warning).toContain('hook says no')
    expect(linkedWorktrees(inner)).toHaveLength(1)
  })

  it('deletes a worktree, inner members first, keeping branches, and only what may be lost when asked to', async () => {
    await start()
    const created = await service.create({
      projectRoot: project,
      branch: 'feat/d',
      base: 'main',
      nested: [
        { relativePath: 'inner', base: 'main' },
        { relativePath: 'inner/deep', base: 'main' },
      ],
    })
    if (!created.ok) throw new Error(created.message)
    const R = created.path
    fs.writeFileSync(path.join(R, 'inner', 'deep', 'new.txt'), 'x\n')

    const refused = await service.delete(project, R, false)
    expect(refused).toMatchObject({ ok: false, reason: 'changed' })
    expect(refused.ok === false && refused.inspection?.changes).toEqual([
      { repository: 'inner/deep', files: ['new.txt'], total: 1, detachedCommits: false },
    ])
    expect(await service.delete(project, R, true, () => true)).toMatchObject({
      ok: false,
      reason: 'running',
    })
    expect(fs.existsSync(R)).toBe(true)

    expect(await service.delete(project, R, true)).toEqual({ ok: true })
    expect(fs.existsSync(R)).toBe(false)
    for (const repository of [project, inner, deep]) {
      expect(linkedWorktrees(repository)).toEqual([])
      expect(branches(repository)).toContain('feat/d')
    }
    expect(await listed()).toEqual([])
  })

  it('does not delete a locked worktree', async () => {
    await start()
    const created = await service.create({
      projectRoot: project,
      branch: 'feat/l',
      base: 'main',
      nested: [],
    })
    if (!created.ok) throw new Error(created.message)
    git(project, 'worktree', 'lock', created.path)
    expect(await service.delete(project, created.path, true)).toMatchObject({
      ok: false,
      reason: 'locked',
    })
    expect(fs.existsSync(created.path)).toBe(true)
  })

  it('removes the registrations of a missing worktree and its inner members, keeping branches', async () => {
    const gone = path.join(root, 'gone')
    git(project, 'worktree', 'add', '-q', '-b', 'beta', gone)
    git(inner, 'worktree', 'add', '-q', '-b', 'beta', path.join(gone, 'inner'))
    fs.rmSync(gone, { recursive: true })
    await start()
    expect(await service.delete(project, gone, true)).toMatchObject({
      ok: false,
      reason: 'missing',
    })
    expect(await service.removeMissing(project, gone)).toEqual({ ok: true })
    expect(linkedWorktrees(project)).toEqual([])
    expect(linkedWorktrees(inner)).toEqual([])
    expect(branches(project)).toContain('beta')
    expect(branches(inner)).toContain('beta')
  })

  it('lists the submodules of the base branches that would be left empty', async () => {
    const source = makeRepository(path.join(root, 'module-source'))
    git(inner, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', source, 'lib/mod')
    git(inner, 'commit', '-q', '-m', 'submodule')
    await start()
    expect(
      await service.submodules(project, [
        { relativePath: '', base: 'main' },
        { relativePath: 'inner', base: 'main' },
      ]),
    ).toEqual(['inner/lib/mod'])
    expect(await service.submodules(project, [{ relativePath: 'inner', base: 'develop' }])).toEqual(
      [],
    )
  })
})

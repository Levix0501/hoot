import fs from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
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
import { WorktreeService, deepestFirst } from './worktree-service'

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

  it('lists the linked worktrees directly in the project folder, by display name, with their state and inner members', async () => {
    // Made with git in the project folder, as Hoot makes them.
    const folder = path.join(W, 'project')
    git(project, 'worktree', 'add', '-q', '-b', 'zeta', path.join(folder, 'z'))
    git(project, 'worktree', 'add', '-q', '--detach', path.join(folder, 'd'))
    git(project, 'worktree', 'add', '-q', '-b', 'alpha', path.join(folder, 'a'))
    git(project, 'worktree', 'lock', '--reason', 'on usb', path.join(folder, 'a'))
    git(project, 'worktree', 'add', '-q', '-b', 'beta', path.join(folder, 'b'))
    git(inner, 'worktree', 'add', '-q', '-b', 'beta', path.join(folder, 'b', 'inner'))
    fs.rmSync(path.join(folder, 'b'), { recursive: true })
    git(inner, 'worktree', 'add', '-q', '-b', 'zeta', path.join(folder, 'z', 'inner'))
    // A linked worktree of an inner repository outside any worktree is no member.
    git(deep, 'worktree', 'add', '-q', '-b', 'loner', path.join(root, 'loner'))
    // The project repository's other linked worktrees are not worktrees.
    const outside = path.join(root, 'outside')
    git(project, 'worktree', 'add', '-q', '-b', 'ext', outside)
    git(project, 'worktree', 'add', '-q', '-b', 'deeper', path.join(folder, 'deeper', 'd'))
    git(project, 'worktree', 'add', '-q', '-b', 'side', path.join(project, '.claude', 'side'))
    await start()

    const short = git(path.join(folder, 'd'), 'rev-parse', '--short', 'HEAD')
    const worktrees = await listed()
    expect(worktrees.map((worktree) => worktree.displayName)).toEqual(
      ['alpha', 'beta', 'zeta', short].toSorted((a, b) => a.localeCompare(b)),
    )
    const byName = Object.fromEntries(worktrees.map((worktree) => [worktree.displayName, worktree]))
    expect(byName.alpha).toEqual({
      path: path.join(folder, 'a'),
      branch: 'alpha',
      displayName: 'alpha',
      missing: false,
      locked: true,
      lockReason: 'on usb',
      innerMembers: [],
    })
    expect(byName.beta).toMatchObject({ missing: true, locked: false, innerMembers: ['inner'] })
    expect(byName.zeta).toMatchObject({ missing: false, innerMembers: ['inner'] })
    expect(byName[short]).toMatchObject({ branch: null, path: path.join(folder, 'd') })
    expect(await service.isWorktreeOf(project, path.join(folder, 'z'))).toBe(true)
    expect(await service.isWorktreeOf(project, path.join(folder, 'b'))).toBe(false)
    expect(await service.isWorktreeOf(project, outside)).toBe(false)
    expect(await service.isWorktreeOf(project, project)).toBe(false)
  })

  it('shows what changed outside Hoot only once the worktrees are read again', async () => {
    await start()
    const created = await service.create({
      projectRoot: project,
      branch: 'feat/r',
      base: 'main',
      nested: [{ relativePath: 'inner', base: 'main' }],
    })
    if (!created.ok) throw new Error(created.message)
    const R = created.path
    const changes: WorktreeInfo[][] = []
    service.on('changed', (_root, worktrees) => changes.push(worktrees))

    // Outside Hoot: a lock, an inner member removed, and worktrees added in and out of the folder.
    git(project, 'worktree', 'lock', '--reason', 'kept', R)
    git(inner, 'worktree', 'remove', path.join(R, 'inner'))
    const added = path.join(W, 'project', 'added')
    git(project, 'worktree', 'add', '-q', '-b', 'added', added)
    git(project, 'worktree', 'add', '-q', '-b', 'elsewhere', path.join(root, 'elsewhere'))
    await delay(500)
    expect(changes).toEqual([])
    expect(await listed()).toMatchObject([{ path: R, locked: false, innerMembers: ['inner'] }])

    // As when the window gets the focus.
    service.refreshAll()
    await expect.poll(() => changes.length).toBe(1)
    expect(changes[0]).toMatchObject([
      { path: added, displayName: 'added', locked: false },
      { path: R, displayName: 'feat/r', locked: true, lockReason: 'kept', innerMembers: [] },
    ])
  })

  it('reads the worktrees again for a worktree about to be used, and goes no further when it changed', async () => {
    await start()
    const make = async (branch: string) => {
      const created = await service.create({
        projectRoot: project,
        branch,
        base: 'main',
        nested: [],
      })
      if (!created.ok) throw new Error(created.message)
      return created.path
    }
    const gone = await make('w-gone')
    const missing = await make('w-missing')
    const locked = await make('w-locked')
    const back = await make('w-back')
    const changes: WorktreeInfo[][] = []
    service.on('changed', (_root, worktrees) => changes.push(worktrees))
    const shown = () => changes.at(-1) ?? []

    git(project, 'worktree', 'remove', gone)
    expect(await service.currentWorktree(project, gone)).toBeNull()
    expect(shown().map((worktree) => worktree.path)).not.toContain(gone)
    expect(await service.removeMissing(project, gone)).toEqual({
      ok: false,
      message: 'The worktree no longer exists.',
    })

    fs.rmSync(missing, { recursive: true })
    expect(await service.currentWorktree(project, missing)).toMatchObject({ missing: true })
    expect(shown().find((worktree) => worktree.path === missing)).toMatchObject({ missing: true })

    git(project, 'worktree', 'lock', locked)
    expect(await service.currentWorktree(project, locked)).toMatchObject({ locked: true })
    expect(shown().find((worktree) => worktree.path === locked)).toMatchObject({ locked: true })

    // Missing when last shown, then back: Remove reads again and leaves it.
    fs.renameSync(back, `${back}.away`)
    service.refreshAll()
    await expect.poll(() => shown().find((worktree) => worktree.path === back)?.missing).toBe(true)
    fs.renameSync(`${back}.away`, back)
    expect(await service.removeMissing(project, back)).toEqual({
      ok: false,
      message: 'The folder of the worktree exists; delete the worktree instead.',
    })
    expect(shown().find((worktree) => worktree.path === back)).toMatchObject({ missing: false })
    expect(linkedWorktrees(project).map((entry) => entry.path)).toContain(back)
  })

  it('neither deletes nor removes the other linked worktrees of the project repository', async () => {
    const ext = path.join(root, 'ext')
    git(project, 'worktree', 'add', '-q', '-b', 'ext', ext)
    const gone = path.join(root, 'gone')
    git(project, 'worktree', 'add', '-q', '-b', 'gone', gone)
    fs.rmSync(gone, { recursive: true })
    await start()
    expect(await listed()).toEqual([])

    expect(await service.inspect(project, ext)).toMatchObject({ ok: false })
    expect(await service.delete(project, ext, true)).toMatchObject({
      ok: false,
      reason: 'not-found',
    })
    expect(await service.removeMissing(project, gone)).toMatchObject({ ok: false })
    expect(await service.currentWorktree(project, ext)).toBeNull()
    expect(fs.existsSync(ext)).toBe(true)
    expect(linkedWorktrees(project).toSorted((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: ext, prunable: false },
      { path: gone, prunable: true },
    ])
    expect(branches(project)).toEqual(expect.arrayContaining(['ext', 'gone']))
  })

  it('looks for inner repositories when the dialog opens or before a check, not when reading the worktrees again', async () => {
    await start()
    const created = await service.create({
      projectRoot: project,
      branch: 'feat/i',
      base: 'main',
      nested: [],
    })
    if (!created.ok) throw new Error(created.message)
    const R = created.path
    const later = makeRepository(path.join(project, 'later'))
    git(later, 'worktree', 'add', '-q', '-b', 'feat/i', path.join(R, 'later'))

    service.refreshAll()
    expect(await service.currentWorktree(project, R)).toMatchObject({ innerMembers: [] })
    await service.newWorktreeOptions(project)
    expect(await listed()).toMatchObject([{ path: R, innerMembers: ['later'] }])
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

  it('deletes a worktree whose inner member is locked: only the outer member’s lock makes it locked', async () => {
    await start()
    const created = await service.create({
      projectRoot: project,
      branch: 'feat/k',
      base: 'main',
      nested: [
        { relativePath: 'inner', base: 'main' },
        { relativePath: 'inner/deep', base: 'main' },
      ],
    })
    if (!created.ok) throw new Error(created.message)
    const R = created.path
    git(inner, 'worktree', 'lock', '--reason', 'kept', path.join(R, 'inner'))
    expect(await listed()).toMatchObject([{ path: R, locked: false }])

    expect(await service.delete(project, R, false)).toEqual({ ok: true })
    expect(fs.existsSync(R)).toBe(false)
    for (const repository of [project, inner, deep]) {
      expect(linkedWorktrees(repository)).toEqual([])
      expect(branches(repository)).toContain('feat/k')
    }
  })

  it('checks and deletes a worktree whose inner members’ folders were deleted', async () => {
    await start()
    const created = await service.create({
      projectRoot: project,
      branch: 'feat/m',
      base: 'main',
      nested: [
        { relativePath: 'inner', base: 'main' },
        { relativePath: 'inner/deep', base: 'main' },
      ],
    })
    if (!created.ok) throw new Error(created.message)
    const R = created.path
    fs.rmSync(path.join(R, 'inner', 'deep'), { recursive: true })
    expect(await service.inspect(project, R)).toEqual({
      ok: true,
      inspection: {
        root: R,
        innerMembers: [path.join(R, 'inner')],
        branch: 'feat/m',
        changes: [],
        foreignRepositories: [],
      },
    })
    fs.rmSync(path.join(R, 'inner'), { recursive: true })
    expect(await service.inspect(project, R)).toMatchObject({
      ok: true,
      inspection: { innerMembers: [], changes: [], foreignRepositories: [] },
    })

    expect(await service.delete(project, R, false)).toEqual({ ok: true })
    expect(fs.existsSync(R)).toBe(false)
    for (const repository of [project, inner, deep]) {
      expect(linkedWorktrees(repository)).toEqual([])
      expect(branches(repository)).toContain('feat/m')
    }
  })

  it('removes the registrations of a missing worktree and its inner members, keeping branches', async () => {
    const gone = path.join(W, 'project', 'gone')
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

  it('removes a missing worktree that is locked, and its locked inner members', async () => {
    const gone = path.join(W, 'project', 'gone')
    git(project, 'worktree', 'add', '-q', '-b', 'beta', gone)
    git(project, 'worktree', 'lock', '--reason', 'on usb', gone)
    git(inner, 'worktree', 'add', '-q', '-b', 'beta', path.join(gone, 'inner'))
    git(inner, 'worktree', 'lock', path.join(gone, 'inner'))
    fs.rmSync(gone, { recursive: true })
    await start()
    expect(await listed()).toMatchObject([{ path: gone, missing: true, locked: true }])
    expect(await service.removeMissing(project, gone)).toEqual({ ok: true })
    expect(linkedWorktrees(project)).toEqual([])
    expect(linkedWorktrees(inner)).toEqual([])
    expect(branches(project)).toContain('beta')
    expect(branches(inner)).toContain('beta')
  })

  it('checks and deletes a worktree with the inner repositories there are, also right after it starts', async () => {
    await start()
    const created = await service.create({
      projectRoot: project,
      branch: 'feat/n',
      base: 'main',
      nested: [{ relativePath: 'inner', base: 'main' }],
    })
    if (!created.ok) throw new Error(created.message)
    const R = created.path
    fs.writeFileSync(path.join(R, 'inner', 'work.txt'), 'x\n')

    // Hoot starts again, and lists the worktree before it has looked for inner repositories.
    service.dispose()
    service = new WorktreeService({
      layout: new WorktreeLayout(W, home),
      gitContext: async () => context,
    })
    service.addProject(project)
    expect((await listed()).map((worktree) => worktree.path)).toEqual([R])
    expect(await service.inspect(project, R)).toEqual({
      ok: true,
      inspection: {
        root: R,
        innerMembers: [path.join(R, 'inner')],
        branch: 'feat/n',
        changes: [{ repository: 'inner', files: ['work.txt'], total: 1, detachedCommits: false }],
        foreignRepositories: [],
      },
    })

    // A repository made in the project since then, with a worktree in the root, is one too.
    const later = makeRepository(path.join(project, 'later'))
    git(later, 'worktree', 'add', '-q', '-b', 'feat/n', path.join(R, 'later'))
    fs.writeFileSync(path.join(R, 'later', 'more.txt'), 'x\n')
    const inspected = await service.inspect(project, R)
    expect(inspected.ok && inspected.inspection.innerMembers).toEqual([
      path.join(R, 'inner'),
      path.join(R, 'later'),
    ])
    expect(
      inspected.ok && inspected.inspection.changes.map((changes) => changes.repository),
    ).toEqual(['inner', 'later'])
    expect(inspected.ok && inspected.inspection.foreignRepositories).toEqual([])

    expect(await service.delete(project, R, true)).toEqual({ ok: true })
    for (const repository of [project, inner, later]) {
      expect(linkedWorktrees(repository)).toEqual([])
      expect(branches(repository)).toContain('feat/n')
    }
  })

  it('deletes the inner members of a worktree also when asked right after it starts', async () => {
    await start()
    const created = await service.create({
      projectRoot: project,
      branch: 'feat/s',
      base: 'main',
      nested: [
        { relativePath: 'inner', base: 'main' },
        { relativePath: 'inner/deep', base: 'main' },
      ],
    })
    if (!created.ok) throw new Error(created.message)
    service.dispose()
    service = new WorktreeService({
      layout: new WorktreeLayout(W, home),
      gitContext: async () => context,
    })
    service.addProject(project)
    await service.listAll()
    expect(await service.delete(project, created.path, true)).toEqual({ ok: true })
    for (const repository of [project, inner, deep]) expect(linkedWorktrees(repository)).toEqual([])
  })

  it('creates worktrees at their real path when the worktree directory is reached through a link', async () => {
    const elsewhere = path.join(root, 'elsewhere')
    fs.mkdirSync(elsewhere)
    fs.symlinkSync(elsewhere, path.join(home, '.hoot'))
    await start()
    expect((await service.previewPath(project, 'feat/l'))?.displayPath).toBe(
      '~/.hoot/worktrees/project/feat-l',
    )
    const result = await service.create({
      projectRoot: project,
      branch: 'feat/l',
      base: 'main',
      nested: [{ relativePath: 'inner', base: 'main' }],
    })
    const R = path.join(elsewhere, 'worktrees', 'project', 'feat-l')
    expect(result).toEqual({ ok: true, path: R, warning: null })
    expect(linkedWorktrees(project)).toEqual([{ path: R, prunable: false }])
    expect(linkedWorktrees(inner)).toEqual([{ path: path.join(R, 'inner'), prunable: false }])
    expect((await listed()).map((worktree) => [worktree.path, worktree.innerMembers])).toEqual([
      [R, ['inner']],
    ])
  })

  it('leaves the registration of a missing worktree alone when creating at its path fails', async () => {
    await start()
    const first = await service.create({
      projectRoot: project,
      branch: 'a/x',
      base: 'main',
      nested: [],
    })
    if (!first.ok) throw new Error(first.message)
    fs.rmSync(first.path, { recursive: true })
    // `a-x` is also the folder of `a/x`, whose worktree Git still registers there.
    const result = await service.create({
      projectRoot: project,
      branch: 'a-x',
      base: 'main',
      nested: [],
    })
    expect(result).toMatchObject({ ok: false, reason: 'failed' })
    expect(result.ok === false && result.message).toContain('missing but already registered')
    expect(linkedWorktrees(project)).toEqual([{ path: first.path, prunable: true }])
    expect(branches(project)).toContain('a/x')
    expect(branches(project)).not.toContain('a-x')
  })

  it('deleting a worktree clears the registrations of the linked worktrees made inside it', async () => {
    await start()
    const created = await service.create({
      projectRoot: project,
      branch: 'feat/a',
      base: 'main',
      nested: [{ relativePath: 'inner', base: 'main' }],
    })
    if (!created.ok) throw new Error(created.message)
    const R = created.path
    // Worktrees an agent made inside it, of the project repository and of the inner one.
    git(R, 'worktree', 'add', '-q', '-b', 'agent', path.join(R, '.claude', 'worktrees', 'agent'))
    git(
      path.join(R, 'inner'),
      'worktree',
      'add',
      '-q',
      '-b',
      'agent',
      path.join(R, 'inner', 'agent'),
    )
    const inspected = await service.inspect(project, R)
    expect(inspected.ok && inspected.inspection.foreignRepositories).toEqual([
      '.claude/worktrees/agent',
      'inner/agent',
    ])

    expect(await service.delete(project, R, true)).toEqual({ ok: true })
    expect(fs.existsSync(R)).toBe(false)
    for (const repository of [project, inner]) {
      expect(linkedWorktrees(repository)).toEqual([])
      expect(branches(repository)).toContain('agent')
    }
    expect(await listed()).toEqual([])
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

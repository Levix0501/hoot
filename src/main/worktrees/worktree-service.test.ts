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
import {
  WorktreeService,
  affectsInnerRepositories,
  deepestFirst,
  isRegistrationChange,
} from './worktree-service'

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

describe('affectsInnerRepositories', () => {
  it('tells the changes in a main worktree that can make or remove an inner repository', () => {
    // A `.git` entry made or removed, at any depth.
    expect(affectsInnerRepositories('rename', 'later/.git', [])).toBe(true)
    expect(affectsInnerRepositories('rename', 'a/b/.git', [])).toBe(true)
    // Not what happens inside Git directories or dependency directories.
    expect(affectsInnerRepositories('rename', 'later/.git/index.lock', [])).toBe(false)
    expect(affectsInnerRepositories('rename', '.git/worktrees/feat/locked', [])).toBe(false)
    expect(affectsInnerRepositories('rename', 'node_modules/pkg/.git', [])).toBe(false)
    expect(affectsInnerRepositories('rename', 'vendor/x', [])).toBe(false)
    // The folder of a known inner repository, or one holding it, moved or removed.
    expect(affectsInnerRepositories('rename', 'inner', ['inner/deep'])).toBe(true)
    expect(affectsInnerRepositories('rename', 'inner/deep', ['inner/deep'])).toBe(true)
    expect(affectsInnerRepositories('change', 'inner/deep', ['inner/deep'])).toBe(false)
    expect(affectsInnerRepositories('change', 'inner/deep/file.txt', ['inner/deep'])).toBe(false)
    // Anything else made or moved in may be a repository.
    expect(affectsInnerRepositories('rename', 'moved', ['inner'])).toBeNull()
    expect(affectsInnerRepositories('rename', 'inner/deep/file.txt', ['inner/deep'])).toBeNull()
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

  it('follows the repositories made in, moved into or deleted from the project while it runs', async () => {
    await start()
    const created = await service.create({
      projectRoot: project,
      branch: 'feat/t',
      base: 'main',
      nested: [],
    })
    if (!created.ok) throw new Error(created.message)
    const R = created.path
    const members = async () =>
      (await listed()).find((worktree) => worktree.path === R)?.innerMembers
    const within = { timeout: 2_000, interval: 50 }

    // Made in the project, with its worktree in the root: nothing else asks to look.
    const later = makeRepository(path.join(project, 'later'))
    git(later, 'worktree', 'add', '-q', '-b', 'feat/t', path.join(R, 'later'))
    await expect.poll(members, within).toEqual(['later'])

    // Moved into the project, then with its worktree in the root.
    const moved = path.join(project, 'moved')
    fs.renameSync(makeRepository(path.join(root, 'elsewhere')), moved)
    git(moved, 'worktree', 'add', '-q', '-b', 'feat/t', path.join(R, 'moved'))
    await expect.poll(members, within).toEqual(['later', 'moved'])

    // Its later registration changes are followed as an inner repository's.
    git(later, 'worktree', 'remove', path.join(R, 'later'))
    await expect.poll(members, within).toEqual(['moved'])

    // Deleted from the project, it is no inner repository anymore.
    fs.rmSync(moved, { recursive: true })
    await expect.poll(members, within).toEqual([])
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

  it('removes a missing worktree that is locked, and its locked inner members', async () => {
    const gone = path.join(root, 'gone')
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

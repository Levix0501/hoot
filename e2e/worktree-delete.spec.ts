import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from './support/test'
import {
  createG,
  createO,
  createP,
  createWorktree,
  deleteDialog,
  git,
  listedChanges,
  localBranches,
  menuEntries,
  openWorktreeActions,
  openWorktreeContextMenu,
  recordGitRuns,
  registeredPaths,
  registrations,
  requestDelete,
  startWorktreeSession,
  worktreeItem,
  worktreeSessionIds,
} from './support/worktrees'

/** The labels of the open confirmation's buttons. */
async function confirmationButtons(app: Parameters<typeof deleteDialog>[0]) {
  return [
    await app.page.getByTestId('worktree-delete-cancel').textContent(),
    await app.page.getByTestId('worktree-delete-confirm').textContent(),
  ]
}

async function cancelDeletion(app: Parameters<typeof deleteDialog>[0]) {
  await app.page.getByTestId('worktree-delete-cancel').click()
  await expect(deleteDialog(app)).toBeHidden()
}

async function confirmDeletion(app: Parameters<typeof deleteDialog>[0]) {
  await app.page.getByTestId('worktree-delete-confirm').click()
  await expect(deleteDialog(app)).toBeHidden({ timeout: 30_000 })
}

test.describe('deleting worktrees', () => {
  test('a worktree with a running session cannot be deleted; deleting it closes its ended sessions', async ({
    launch,
    world,
  }) => {
    const G = createG(world)
    const app = await launch({ projects: [G] })
    const R = await createWorktree(app, G, 'feat/del')
    const s1 = await startWorktreeSession(app, R, 'shell')
    await app.waitForPrompt(20_000, s1)
    const s2 = await startWorktreeSession(app, R, 'shell')
    await app.waitForPrompt(20_000, s2)
    await app.run('exit 3', { waitForPrompt: false })
    await expect(app.sessionItem(s2)).toHaveAttribute('data-status', 'exited')

    await openWorktreeActions(app, R)
    expect(await menuEntries(app)).toContainEqual(['Delete', false])
    await expect(app.page.getByTestId('worktree-running-note')).toHaveText(
      'End the running sessions in this worktree before deleting it.',
    )
    await app.closeMenus()
    await openWorktreeContextMenu(app, R)
    expect(await menuEntries(app)).toContainEqual(['Delete', false])
    await expect(app.page.getByTestId('worktree-running-note')).toBeVisible()
    await app.expectEnglishUi()
    await app.closeMenus()
    // Asked directly, without the interface, Hoot refuses as well.
    for (const discard of [false, true]) {
      const result = await app.page.evaluate(
        ([root, worktree, value]) => window.hoot.deleteWorktree(root!, worktree!, value === 'yes'),
        [G, R, discard ? 'yes' : 'no'],
      )
      expect(result).toMatchObject({ ok: false, reason: 'running' })
    }
    expect(fs.existsSync(R)).toBe(true)
    expect(registeredPaths(G)).toEqual([R])

    await app.selectSession(s1)
    await app.run('exit 4', { waitForPrompt: false })
    await expect(app.sessionItem(s1)).toHaveAttribute('data-status', 'exited')
    await requestDelete(app, R)
    await expect(deleteDialog(app)).toHaveAttribute('data-dirty', 'false')
    await expect(deleteDialog(app).getByTestId('worktree-delete-folder')).toHaveText([R])
    await expect(deleteDialog(app).getByTestId('worktree-delete-branches')).toHaveText(
      'The branch feat/del will be kept.',
    )
    expect(await confirmationButtons(app)).toEqual(['Cancel', 'Delete'])
    await app.expectEnglishUi()
    await cancelDeletion(app)
    expect(fs.existsSync(R)).toBe(true)
    expect(registeredPaths(G)).toEqual([R])
    expect(localBranches(G)).toContain('feat/del')
    expect(await worktreeSessionIds(app, R)).toEqual([s1, s2])

    await requestDelete(app, R)
    await confirmDeletion(app)
    expect(fs.existsSync(R)).toBe(false)
    expect(registrations(G)).toEqual([])
    expect(localBranches(G)).toContain('feat/del')
    await expect(app.sessionItem(s1)).toHaveCount(0)
    await expect(app.sessionItem(s2)).toHaveCount(0)
    await expect(worktreeItem(app, R)).toHaveCount(0)
  })

  test('the changes of each repository are listed, and inner members are deleted first', async ({
    launch,
    world,
  }) => {
    const { O, inner, deep, loose } = createO(world)
    const repositories = [O, inner, deep, loose]
    const recorder = recordGitRuns(world, repositories)
    const app = await launch({ projects: [O] })
    const R = await createWorktree(app, O, 'feat/x', { base: 'develop' })

    fs.appendFileSync(path.join(R, 'inner', 'inner.txt'), 'changed\n')
    fs.writeFileSync(path.join(R, 'inner', 'added.txt'), 'added\n')
    git(path.join(R, 'inner'), 'add', 'added.txt')
    fs.writeFileSync(path.join(R, 'inner', 'deep', 'untracked.txt'), 'new\n')
    for (let index = 0; index < 200; index++) {
      fs.writeFileSync(path.join(R, 'loose', `file-${String(index).padStart(3, '0')}.txt`), 'x\n')
    }
    const status = (directory: string) => git(directory, 'status', '--porcelain')
    const before = [R, path.join(R, 'inner'), path.join(R, 'inner', 'deep'), path.join(R, 'loose')]
    const statuses = before.map(status)
    const branches = repositories.map(localBranches)

    await requestDelete(app, R)
    await expect(deleteDialog(app)).toHaveAttribute('data-dirty', 'true')
    const listed = await listedChanges(app)
    expect(listed.map((entry) => entry.repository)).toEqual(['inner', 'inner/deep', 'loose'])
    expect(listed[0]).toMatchObject({ total: 2, detached: false })
    expect(listed[0]!.files.toSorted()).toEqual(['added.txt', 'inner.txt'])
    expect(listed[1]).toMatchObject({ total: 1, files: ['untracked.txt'] })
    expect(listed[2]!.total).toBe(200)
    expect(listed[2]!.files.length).toBeLessThan(200)
    expect(listed[2]!.files.length).toBeGreaterThan(0)
    await expect(
      deleteDialog(app).locator('[data-testid="worktree-changes"][data-repository="inner"]'),
    ).toContainText('2 changed files')
    expect(await confirmationButtons(app)).toEqual(['Cancel', 'Discard Changes and Delete'])
    await app.expectEnglishUi()

    await cancelDeletion(app)
    expect(before.map(status)).toEqual(statuses)
    expect(repositories.map(localBranches)).toEqual(branches)

    await requestDelete(app, R)
    await expect(deleteDialog(app)).toHaveAttribute('data-dirty', 'true')
    await confirmDeletion(app)
    expect(fs.existsSync(R)).toBe(false)
    for (const repository of repositories) {
      expect(registrations(repository).filter((entry) => entry.path.startsWith(R))).toEqual([])
      expect(registrations(repository).filter((entry) => entry.prunable)).toEqual([])
      expect(localBranches(repository)).toContain('feat/x')
    }
    const cleared = {
      deep: recorder.clearedAt(deep, path.join(R, 'inner', 'deep')),
      inner: recorder.clearedAt(inner, path.join(R, 'inner')),
      loose: recorder.clearedAt(loose, path.join(R, 'loose')),
      outer: recorder.clearedAt(O, R),
    }
    for (const index of Object.values(cleared)) expect(index).toBeGreaterThan(-1)
    expect(cleared.deep).toBeLessThan(cleared.inner)
    expect(cleared.inner).toBeLessThan(cleared.outer)
    expect(cleared.loose).toBeLessThan(cleared.outer)
  })

  test('a worktree is deleted all the same when an inner member is locked or its folder is gone', async ({
    launch,
    world,
  }) => {
    const { O, inner, deep, loose } = createO(world)
    const repositories = [O, inner, deep, loose]
    const app = await launch({ projects: [O] })
    const R = await createWorktree(app, O, 'feat/x')
    git(inner, 'worktree', 'lock', '--reason', 'kept', path.join(R, 'inner'))
    fs.rmSync(path.join(R, 'loose'), { recursive: true, force: true })
    await expect(worktreeItem(app, R)).toHaveAttribute('data-locked', 'false')

    await requestDelete(app, R)
    await expect(deleteDialog(app)).toHaveAttribute('data-dirty', 'false')
    await expect(deleteDialog(app).getByTestId('worktree-delete-folder')).toHaveText([
      R,
      path.join(R, 'inner'),
      path.join(R, 'inner', 'deep'),
    ])
    expect(await confirmationButtons(app)).toEqual(['Cancel', 'Delete'])
    await confirmDeletion(app)
    expect(fs.existsSync(R)).toBe(false)
    for (const repository of repositories) {
      expect(registrations(repository).filter((entry) => entry.path.startsWith(R))).toEqual([])
      expect(registrations(repository).filter((entry) => entry.prunable)).toEqual([])
      expect(localBranches(repository)).toContain('feat/x')
    }
    await expect(worktreeItem(app, R)).toHaveCount(0)
  })

  test('commits on no branch and repositories that are not part of the worktree are listed', async ({
    launch,
    world,
  }) => {
    const G = createG(world)
    const { O, inner, deep, loose } = createO(world)
    const app = await launch({ projects: [G, O] })

    const F = await createWorktree(app, G, 'feat/f')
    git(F, 'checkout', '-q', '--detach')
    fs.writeFileSync(path.join(F, 'detached.txt'), 'x\n')
    git(F, 'add', '.')
    git(F, 'commit', '-q', '-m', 'on no branch')
    await requestDelete(app, F)
    await expect(deleteDialog(app)).toHaveAttribute('data-dirty', 'true')
    expect(await listedChanges(app)).toEqual([
      { repository: 'G', total: 0, files: [], detached: true },
    ])
    await expect(deleteDialog(app).getByTestId('worktree-detached-commits')).toHaveText(
      'It has commits that are not on any branch.',
    )
    expect(await confirmationButtons(app)).toEqual(['Cancel', 'Discard Changes and Delete'])
    await cancelDeletion(app)

    const R = await createWorktree(app, O, 'feat/g')
    const clone = (target: string) => {
      const source = path.join(world.root, `source-${path.basename(target)}`)
      fs.mkdirSync(source, { recursive: true })
      git(source, 'init', '-q', '-b', 'main')
      fs.writeFileSync(path.join(source, 'README.md'), 'source\n')
      git(source, 'add', '.')
      git(source, 'commit', '-q', '-m', 'initial')
      fs.cpSync(source, target, { recursive: true })
    }
    clone(path.join(R, 'build', 'cloned'))
    clone(path.join(R, 'node_modules', 'dep'))
    await requestDelete(app, R)
    await expect(deleteDialog(app)).toHaveAttribute('data-dirty', 'true')
    await expect(deleteDialog(app).getByTestId('worktree-foreign-repository')).toHaveText([
      'build/cloned',
    ])
    expect(await listedChanges(app)).toEqual([])
    expect(await confirmationButtons(app)).toEqual(['Cancel', 'Discard Changes and Delete'])
    await app.expectEnglishUi()
    await confirmDeletion(app)
    expect(fs.existsSync(R)).toBe(false)
    for (const repository of [O, inner, deep, loose]) {
      expect(registrations(repository).filter((entry) => entry.path.startsWith(R))).toEqual([])
      expect(registrations(repository).filter((entry) => entry.prunable)).toEqual([])
    }
  })

  test('changes in a populated submodule are listed for its member', async ({ launch, world }) => {
    const { P } = createP(world)
    const app = await launch({ projects: [P] })
    const R = await createWorktree(app, P, 'feat/s')
    git(R, '-c', 'protocol.file.allow=always', 'submodule', 'update', '--init', '-q')
    fs.appendFileSync(path.join(R, 'mod', 'module.txt'), 'changed\n')

    await requestDelete(app, R)
    await expect(deleteDialog(app)).toHaveAttribute('data-dirty', 'true')
    expect(await listedChanges(app)).toEqual([
      { repository: 'P', total: 1, files: ['mod'], detached: false },
    ])
    expect(await confirmationButtons(app)).toEqual(['Cancel', 'Discard Changes and Delete'])
    await cancelDeletion(app)

    git(path.join(R, 'mod'), 'checkout', '--', 'module.txt')
    await requestDelete(app, R)
    await expect(deleteDialog(app)).toHaveAttribute('data-dirty', 'false')
    expect(await confirmationButtons(app)).toEqual(['Cancel', 'Delete'])
    await expect(deleteDialog(app)).not.toContainText('Discard')
    await confirmDeletion(app)
    expect(fs.existsSync(R)).toBe(false)
    expect(registrations(P)).toEqual([])
  })
})

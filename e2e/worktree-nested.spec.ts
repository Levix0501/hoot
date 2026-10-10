import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from './support/test'
import {
  baseSelect,
  branchOptions,
  chooseBranch,
  commitOf,
  createG,
  createO,
  createWorktree,
  entriesOf,
  git,
  hoverWorktree,
  localBranches,
  nestedRow,
  newWorktreeDialog,
  openNewWorktreeDialog,
  registeredPaths,
  registrations,
  selectedBranch,
  startWorktreeSession,
  typeBranch,
  worktreeItem,
  worktreeItems,
  worktreeNames,
  worktreesDir,
} from './support/worktrees'

/** The inner repositories the dialog lists, with whether each is included and can be. */
async function nestedList(app: Parameters<typeof nestedRow>[0]) {
  return app.page.getByTestId('worktree-nested').evaluateAll((rows) =>
    rows.map((row) => {
      const checkbox = row.querySelector('[data-testid="worktree-nested-checkbox"]')!
      return {
        path: row.getAttribute('data-relative-path'),
        included: checkbox.getAttribute('aria-checked') === 'true',
        enabled:
          !checkbox.hasAttribute('data-disabled') &&
          checkbox.getAttribute('aria-disabled') !== 'true',
        reason: row.querySelector('[data-testid="worktree-nested-reason"]')?.textContent ?? null,
      }
    }),
  )
}

/** The base branch each listed inner repository that can be included starts from. */
async function nestedBases(app: Parameters<typeof nestedRow>[0]) {
  const bases: Record<string, string | null> = {}
  for (const relativePath of ['inner', 'inner/deep', 'loose']) {
    bases[relativePath] = await selectedBranch(baseSelect(app, relativePath))
  }
  return bases
}

test.describe('worktrees with inner repositories', () => {
  test('the dialog lists the inner repositories, each with a base branch that follows the project’s until picked', async ({
    launch,
    world,
  }) => {
    const { O } = createO(world)
    const app = await launch({ projects: [O] })
    await openNewWorktreeDialog(app, O)

    expect(await nestedList(app)).toEqual([
      {
        path: 'empty',
        included: false,
        enabled: false,
        reason: 'No commits yet, so it cannot be included.',
      },
      { path: 'inner', included: true, enabled: true, reason: null },
      { path: 'inner/deep', included: true, enabled: true, reason: null },
      { path: 'loose', included: true, enabled: true, reason: null },
    ])
    expect(await selectedBranch(baseSelect(app))).toBe('main')
    expect(await nestedBases(app)).toEqual({ inner: 'main', 'inner/deep': 'main', loose: 'trunk' })
    expect(await branchOptions(app, baseSelect(app, 'inner'))).toEqual(['develop', 'main'])
    expect(await branchOptions(app, baseSelect(app, 'loose'))).toEqual(['trunk'])
    await app.expectEnglishUi()

    await chooseBranch(app, baseSelect(app), 'develop')
    expect(await nestedBases(app)).toEqual({
      inner: 'develop',
      'inner/deep': 'main',
      loose: 'trunk',
    })

    // Picked by hand, inner keeps its base branch from then on.
    await chooseBranch(app, baseSelect(app, 'inner'), 'main')
    for (const base of ['main', 'develop']) {
      await chooseBranch(app, baseSelect(app), base)
      expect(await nestedBases(app)).toEqual({
        inner: 'main',
        'inner/deep': 'main',
        loose: 'trunk',
      })
    }
  })

  test('a worktree with inner repositories: one row, the same branch at the same paths', async ({
    launch,
    world,
  }) => {
    const { O, inner, deep, loose, empty, pkg, side } = createO(world)
    const W = worktreesDir(world)
    const app = await launch({ projects: [O] })
    // O's own linked worktree in .claude/worktrees is not in its project folder.
    await expect(worktreeItem(app, side)).toHaveCount(0)

    const R = await createWorktree(app, O, 'feat/x', { base: 'develop' })
    expect(R).toBe(path.join(W, 'O', 'feat-x'))
    const member = (repository: string, worktree: string) =>
      registrations(repository).find((entry) => entry.path === worktree)
    expect(member(O, R)).toMatchObject({ branch: 'feat/x' })
    expect(commitOf(O, 'feat/x')).toBe(commitOf(O, 'develop'))
    expect(member(inner, path.join(R, 'inner'))).toMatchObject({ branch: 'feat/x' })
    expect(commitOf(inner, 'feat/x')).toBe(commitOf(inner, 'develop'))
    expect(member(deep, path.join(R, 'inner', 'deep'))).toMatchObject({ branch: 'feat/x' })
    expect(commitOf(deep, 'feat/x')).toBe(commitOf(deep, 'main'))
    expect(member(loose, path.join(R, 'loose'))).toMatchObject({ branch: 'feat/x' })
    expect(commitOf(loose, 'feat/x')).toBe(commitOf(loose, 'trunk'))
    expect(fs.existsSync(path.join(R, 'empty'))).toBe(false)
    expect(fs.existsSync(path.join(R, 'node_modules'))).toBe(false)
    expect(registrations(empty)).toEqual([])
    expect(registrations(pkg)).toEqual([])

    // One row for the worktree; its inner members have none, and side has none either.
    expect(await worktreeNames(app, O)).toEqual(['feat/x'])
    await expect(worktreeItems(app)).toHaveCount(1)
    await expect(worktreeItem(app, side)).toHaveCount(0)
    expect(await hoverWorktree(app, R)).toEqual({
      path: R,
      members: ['inner', 'inner/deep', 'loose'],
    })

    const session = await startWorktreeSession(app, R, 'shell')
    await app.waitForPrompt(20_000, session)
    await app.run('pwd')
    expect(await app.outputOf('pwd')).toEqual([R])
    await expect(app.page.getByTestId('session-project')).toHaveText('O · feat/x')
  })

  test('an inner repository left out is not in the worktree, which shows as usual', async ({
    launch,
    world,
  }) => {
    const { O, inner, deep, loose } = createO(world)
    const app = await launch({ projects: [O] })
    const looseRegistered = registeredPaths(loose)

    const R = await createWorktree(app, O, 'feat/y', { exclude: ['loose'] })
    expect(fs.existsSync(path.join(R, 'loose'))).toBe(false)
    expect(localBranches(loose)).not.toContain('feat/y')
    expect(registeredPaths(loose)).toEqual(looseRegistered)
    expect(registeredPaths(inner)).toEqual([path.join(R, 'inner')])
    expect(registeredPaths(deep)).toEqual([path.join(R, 'inner', 'deep')])

    const row = worktreeItem(app, R)
    await expect(row).toHaveAttribute('data-missing', 'false')
    await expect(row.getByTestId('worktree-missing')).toHaveCount(0)
    expect(await hoverWorktree(app, R)).toEqual({ path: R, members: ['inner', 'inner/deep'] })
    // Nothing offers to add the inner member that was left out.
    await row.getByTestId('worktree-actions-button').click()
    await expect(app.page.locator('[role="menu"]')).toBeVisible()
    expect(
      await app.page
        .locator('[role="menu"] [role="menuitem"]')
        .evaluateAll((items) => items.map((item) => item.textContent?.trim())),
    ).toEqual(['Reveal in Finder', 'Copy Path', 'Delete'])
    await app.closeMenus()
  })

  test('a branch that exists in an inner repository, and base branches that are not chosen', async ({
    launch,
    world,
  }) => {
    const { O, inner, deep, loose } = createO(world)
    const G = createG(world)
    const W = worktreesDir(world)
    git(deep, 'branch', 'taken')
    const app = await launch({ projects: [O, G] })
    const repositories = [O, inner, deep, loose]
    const registered = repositories.map(registrations)

    await openNewWorktreeDialog(app, O)
    await typeBranch(app, 'taken')
    await app.page.getByTestId('worktree-create').click()
    await expect(app.page.getByTestId('worktree-create-error')).toHaveText(
      'A branch named taken already exists in inner/deep.',
    )
    expect(repositories.map(registrations)).toEqual(registered)
    for (const repository of [O, inner, loose]) {
      expect(localBranches(repository)).not.toContain('taken')
    }
    expect(entriesOf(W)).toEqual([])
    await app.page.getByTestId('worktree-cancel').click()
    await expect(newWorktreeDialog(app)).toBeHidden()

    // An inner repository on a detached HEAD has no base branch until one is chosen.
    git(loose, 'checkout', '-q', '--detach')
    await openNewWorktreeDialog(app, O)
    await typeBranch(app, 'feat/d')
    expect(await selectedBranch(baseSelect(app))).toBe('main')
    expect(await selectedBranch(baseSelect(app, 'loose'))).toBeNull()
    const create = app.page.getByTestId('worktree-create')
    await expect(app.page.getByTestId('worktree-location')).toHaveText('~/.hoot/worktrees/O/feat-d')
    await expect(create).toBeDisabled()
    await chooseBranch(app, baseSelect(app, 'loose'), 'trunk')
    await expect(create).toBeEnabled()
    await app.page.getByTestId('worktree-cancel').click()
    await expect(newWorktreeDialog(app)).toBeHidden()

    // So has the project when its main worktree is on a detached HEAD.
    git(G, 'checkout', '-q', '--detach')
    await openNewWorktreeDialog(app, G)
    await typeBranch(app, 'feat/e')
    expect(await selectedBranch(baseSelect(app))).toBeNull()
    await expect(app.page.getByTestId('worktree-location')).toHaveText('~/.hoot/worktrees/G/feat-e')
    await expect(create).toBeDisabled()
    await chooseBranch(app, baseSelect(app), 'main')
    await expect(create).toBeEnabled()
    await app.expectEnglishUi()
  })
})

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from './support/test'
import {
  createK,
  createL,
  createO,
  createP,
  localBranches,
  newWorktreeDialog,
  openNewWorktreeDialog,
  recordGitRuns,
  registrations,
  typeBranch,
  worktreeNamed,
  worktreesDir,
} from './support/worktrees'

test.describe('creating worktrees with what Git does along the way', () => {
  test('submodules are listed and left empty', async ({ launch, world }) => {
    const { P } = createP(world)
    const app = await launch({ projects: [P] })
    await openNewWorktreeDialog(app, P)
    await typeBranch(app, 'feat/s')
    const notice = app.page.getByTestId('worktree-submodules')
    await expect(notice).toContainText('will not be populated')
    await expect(notice.getByTestId('worktree-submodule')).toHaveText(['mod'])
    await app.expectEnglishUi()
    await app.page.getByTestId('worktree-create').click()
    await expect(newWorktreeDialog(app)).toBeHidden()

    const R = path.join(worktreesDir(world), 'P', 'feat-s')
    await expect(worktreeNamed(app, P, 'feat/s')).toHaveAttribute('data-worktree-path', R)
    expect(fs.statSync(path.join(R, 'mod')).isDirectory()).toBe(true)
    expect(fs.readdirSync(path.join(R, 'mod'))).toEqual([])
  })

  test('a failing post-checkout hook keeps the worktree and shows its output as a warning', async ({
    launch,
    world,
  }) => {
    const { K, inRepository } = createK(world)
    const app = await launch({ projects: [K] })
    await openNewWorktreeDialog(app, K)
    await typeBranch(app, 'feat/h')
    await expect(
      app.page.locator('[data-testid="worktree-nested"][data-relative-path="in"]'),
    ).toBeVisible()
    await app.page.getByTestId('worktree-create').click()
    await expect(newWorktreeDialog(app)).toBeHidden({ timeout: 30_000 })

    const R = path.join(worktreesDir(world), 'K', 'feat-h')
    expect(registrations(K)).toMatchObject([{ path: R, branch: 'feat/h' }])
    expect(registrations(inRepository)).toMatchObject([
      { path: path.join(R, 'in'), branch: 'feat/h' },
    ])
    await expect(worktreeNamed(app, K, 'feat/h')).toHaveAttribute('data-worktree-path', R)
    const warning = app.toasts('Git reported a problem')
    await expect(warning).toHaveCount(1)
    await expect(warning.getByTestId('worktree-warning')).toContainText('hook says no')
    await app.expectEnglishUi()
  })

  test('when a member cannot be created, what was created is undone, inner members first', async ({
    launch,
    world,
  }) => {
    const { O, inner, deep, loose } = createO(world)
    const repositories = [O, inner, deep, loose]
    const recorder = recordGitRuns(world, repositories)
    const app = await launch({ projects: [O] })
    const registered = repositories.map(registrations)
    const branches = repositories.map(localBranches)

    await openNewWorktreeDialog(app, O)
    await typeBranch(app, 'feat/z')
    await expect(app.page.getByTestId('worktree-create')).toBeEnabled()
    const deepGitDir = path.join(deep, '.git')
    execFileSync('chmod', ['-R', 'a-w', deepGitDir])
    try {
      await app.page.getByTestId('worktree-create').click()
      const error = app.page.getByTestId('worktree-create-error')
      await expect(error).toBeVisible({ timeout: 30_000 })
      await expect(error).toContainText('fatal:')
      await expect(error).toContainText('feat/z')
    } finally {
      execFileSync('chmod', ['-R', 'u+w', deepGitDir])
    }
    await app.expectEnglishUi()

    for (const [index, repository] of repositories.entries()) {
      expect(localBranches(repository)).toEqual(branches[index])
      expect(localBranches(repository)).not.toContain('feat/z')
      expect(registrations(repository)).toEqual(registered[index])
      expect(registrations(repository).filter((entry) => entry.prunable)).toEqual([])
    }
    const R = path.join(worktreesDir(world), 'O', 'feat-z')
    expect(fs.existsSync(R)).toBe(false)
    await expect(worktreeNamed(app, O, 'feat/z')).toHaveCount(0)

    // inner's member was created and removed again before O's was.
    const innerCleared = recorder.clearedAt(inner, path.join(R, 'inner'))
    const outerCleared = recorder.clearedAt(O, R)
    expect(innerCleared).toBeGreaterThan(-1)
    expect(outerCleared).toBeGreaterThan(-1)
    expect(innerCleared).toBeLessThan(outerCleared)
  })

  test('while the worktree is created, the dialog says so and Create cannot be clicked again', async ({
    launch,
    world,
  }) => {
    const L = createL(world)
    const app = await launch({ projects: [L] })
    await openNewWorktreeDialog(app, L)
    await typeBranch(app, 'feat/p')
    const create = app.page.getByTestId('worktree-create')
    await expect(create).toBeEnabled()
    await create.click()
    const started = Date.now()
    await expect(newWorktreeDialog(app)).toHaveAttribute('data-creating', 'true')
    await expect(create).toHaveText('Creating…')
    await expect(create).toBeDisabled()
    await create.click({ force: true })
    await app.page.waitForTimeout(1_000)
    await expect(newWorktreeDialog(app)).toBeVisible()
    await expect(create).toBeDisabled()

    await expect(newWorktreeDialog(app)).toBeHidden({ timeout: 30_000 })
    expect(Date.now() - started).toBeGreaterThanOrEqual(2_500)
    await expect(worktreeNamed(app, L, 'feat/p')).toHaveCount(1)
    expect(registrations(L)).toHaveLength(1)
  })
})

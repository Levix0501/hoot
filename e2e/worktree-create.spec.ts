import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from './support/test'
import {
  baseSelect,
  branchOptions,
  chooseBranch,
  commitOf,
  createApps,
  createG,
  createH,
  createM,
  createWorktree,
  entriesOf,
  hoverWorktree,
  localBranches,
  newWorktreeDialog,
  openNewWorktreeDialog,
  registeredPaths,
  registrations,
  selectedBranch,
  sidebarRows,
  startWorktreeSession,
  typeBranch,
  worktreeItem,
  worktreeItems,
  worktreeNamed,
  worktreeSessionIds,
  worktreesDir,
} from './support/worktrees'

test.describe('creating worktrees', () => {
  test('the new session menu and the context menu of a project offer New Worktree…', async ({
    launch,
    world,
  }) => {
    const G = createG(world)
    const app = await launch({ projects: [G] })

    await app.openToolMenu(G)
    await expect(app.page.getByTestId('new-worktree')).toHaveText('New Worktree…')
    await app.closeMenus()
    await app.projectItem(G).click({ button: 'right' })
    await expect(app.page.getByTestId('context-new-worktree')).toHaveText('New Worktree…')
    await app.page.getByTestId('context-new-worktree').click()
    await expect(newWorktreeDialog(app)).toBeVisible()
    await expect(app.page.getByTestId('new-worktree-title')).toHaveText('New Worktree in G')
    await expect(app.page.getByTestId('worktree-branch-input')).toBeVisible()
    await app.expectEnglishUi()
    await app.page.getByTestId('worktree-cancel').click()
    await expect(newWorktreeDialog(app)).toBeHidden()

    await openNewWorktreeDialog(app, G, 'button')
    await expect(app.page.getByTestId('new-worktree-title')).toHaveText('New Worktree in G')
  })

  test('the dialog offers the local branches, shows where the worktree goes, and checks the name', async ({
    launch,
    world,
  }) => {
    const G = createG(world)
    const W = worktreesDir(world)
    const app = await launch({ projects: [G] })
    await openNewWorktreeDialog(app, G)

    // Only the local branches, with the branch of the main worktree chosen.
    expect(await branchOptions(app, baseSelect(app))).toEqual(['develop', 'main'])
    expect(await selectedBranch(baseSelect(app))).toBe('main')

    const location = app.page.getByTestId('worktree-location')
    const create = app.page.getByTestId('worktree-create')
    await typeBranch(app, 'feat/login')
    await expect(location).toHaveText('~/.hoot/worktrees/G/feat-login')
    expect(path.join(world.home, '.hoot/worktrees/G/feat-login')).toBe(path.join(W, 'G/feat-login'))
    await expect(create).toBeEnabled()
    await expect(app.page.getByTestId('worktree-branch-error')).toHaveCount(0)

    await typeBranch(app, 'bad..name')
    await expect(app.page.getByTestId('worktree-branch-error')).toHaveText(
      'This is not a valid branch name.',
    )
    await expect(create).toBeDisabled()
    await app.expectEnglishUi()

    const registered = registrations(G)
    const branches = localBranches(G)
    await typeBranch(app, 'main')
    await expect(create).toBeEnabled()
    await create.click()
    await expect(app.page.getByTestId('worktree-create-error')).toHaveText(
      'A branch named main already exists in G.',
    )
    await expect(newWorktreeDialog(app)).toBeVisible()
    expect(registrations(G)).toEqual(registered)
    expect(localBranches(G)).toEqual(branches)
    expect(entriesOf(W)).toEqual([])
  })

  test('a worktree of a single repository, and a session in it', async ({ launch, world }) => {
    const H = createH(world)
    const G = createG(world)
    const W = worktreesDir(world)
    const app = await launch({ projects: [H, G] })
    const s0 = await app.startSession(G, 'shell')
    await app.waitForPrompt(20_000, s0)
    await expect(app.session()).toHaveAttribute('data-session-id', s0)

    const root = await createWorktree(app, G, 'feat/login', { base: 'develop' })
    expect(root).toBe(path.join(W, 'G', 'feat-login'))
    const [entry] = registrations(G)
    expect(entry).toMatchObject({ path: root, branch: 'feat/login' })
    expect(registrations(G)).toHaveLength(1)
    expect(commitOf(G, 'feat/login')).toBe(commitOf(G, 'develop'))
    expect(await sidebarRows(app)).toEqual([
      `project:${H}`,
      `project:${G}`,
      `session:${s0}`,
      'worktree:feat/login',
    ])
    // No session started, and S0 is still shown.
    expect(await app.sessionIds()).toEqual([s0])
    await expect(app.session()).toHaveAttribute('data-session-id', s0)
    await expect(worktreeItems(app, H)).toHaveCount(0)

    // Clicking the row itself changes nothing; it cannot be collapsed.
    const rowsBefore = await sidebarRows(app)
    await worktreeItem(app, root).getByTestId('worktree-row').click()
    await app.page.waitForTimeout(300)
    await expect(app.session()).toHaveAttribute('data-session-id', s0)
    expect(await sidebarRows(app)).toEqual(rowsBefore)
    // Its only buttons open menus.
    await expect(
      worktreeItem(app, root).locator('[aria-expanded]:not([aria-haspopup])'),
    ).toHaveCount(0)
    await expect(worktreeItem(app, root).locator('[data-slot="collapsible-trigger"]')).toHaveCount(
      0,
    )

    const s1 = await startWorktreeSession(app, root, 'shell')
    await app.waitForPrompt(20_000, s1)
    expect(await worktreeSessionIds(app, root)).toEqual([s1])
    expect(await sidebarRows(app)).toEqual([
      `project:${H}`,
      `project:${G}`,
      `session:${s0}`,
      'worktree:feat/login',
      `session:${s1}`,
    ])
    await app.run('pwd')
    expect(await app.outputOf('pwd')).toEqual([root])
    await app.run('git branch --show-current')
    expect(await app.outputOf('git branch --show-current')).toEqual(['feat/login'])
    await expect(app.page.getByTestId('session-project')).toHaveText('G · feat/login')
    await expect(app.page.getByTestId('session-project')).toHaveAttribute('title', root)
    expect(await hoverWorktree(app, root)).toEqual({ path: root, members: [] })
    await app.expectEnglishUi()

    // Sessions in the main worktree still show the project name alone.
    await app.selectSession(s0)
    await expect(app.page.getByTestId('session-project')).toHaveText('G')
  })

  test('folder names are safe names of the branch, under one folder per project', async ({
    launch,
    world,
  }) => {
    const G = createG(world)
    const M = createM(world)
    const { app1, app2 } = createApps(world)
    const W = worktreesDir(world)
    fs.mkdirSync(path.join(W, 'G', 'fix-1'), { recursive: true })
    const app = await launch({ projects: [G, M, app1, app2] })

    expect(await createWorktree(app, G, 'fix/1')).toBe(path.join(W, 'G', 'fix-1-2'))
    expect(await createWorktree(app, G, 'fix#12')).toBe(path.join(W, 'G', 'fix-12'))
    expect(await createWorktree(app, G, '功能/登录')).toBe(path.join(W, 'G', '功能-登录'))
    expect(await createWorktree(app, M, 'x')).toBe(path.join(W, 'My-App', 'x'))

    const w1 = await createWorktree(app, app1, 'w1')
    const w2 = await createWorktree(app, app2, 'w2')
    const w3 = await createWorktree(app, app1, 'w3')
    expect(path.dirname(w1)).toBe(path.dirname(w3))
    expect(path.dirname(w2)).not.toBe(path.dirname(w1))
    for (const folder of [path.dirname(w1), path.dirname(w2)]) {
      expect(path.dirname(folder)).toBe(W)
      expect(path.basename(folder)).toMatch(/^app/)
    }
    expect([path.basename(w1), path.basename(w2), path.basename(w3)]).toEqual(['w1', 'w2', 'w3'])
    expect(registeredPaths(app1)).toEqual([w1, w3].toSorted())
    expect(registeredPaths(app2)).toEqual([w2])
    await expect(worktreeNamed(app, G, '功能/登录')).toHaveCount(1)
    await app.expectEnglishUi()
  })
})

test('choosing a branch keeps the dialog usable with the keyboard', async ({ launch, world }) => {
  const G = createG(world)
  const app = await launch({ projects: [G] })
  await openNewWorktreeDialog(app, G)
  await expect(app.page.getByTestId('worktree-branch-input')).toBeFocused()
  await chooseBranch(app, baseSelect(app), 'develop')
  await typeBranch(app, 'kb')
  await app.page.getByTestId('worktree-branch-input').press('Enter')
  await expect(newWorktreeDialog(app)).toBeHidden()
  await expect(worktreeNamed(app, G, 'kb')).toHaveCount(1)
  expect(commitOf(G, 'kb')).toBe(commitOf(G, 'develop'))
})

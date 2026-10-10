import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from './support/test'
import {
  createG,
  createO,
  createWorktree,
  deleteDialog,
  emitWindowFocus,
  localBranches,
  openWorktreeActions,
  registrations,
  requestDelete,
  startWorktreeSession,
  worktreeItem,
  worktreeNamed,
  worktreesDir,
} from './support/worktrees'

test.describe('worktrees and their projects', () => {
  test('a project with a running session in a worktree cannot be removed; removing it keeps its worktrees', async ({
    launch,
    world,
  }) => {
    const { O, inner, deep, loose } = createO(world)
    const repositories = [O, inner, deep, loose]
    const app = await launch({ projects: [O] })
    const R = await createWorktree(app, O, 'feat/keep')
    const S = await startWorktreeSession(app, R, 'shell')
    await app.waitForPrompt(20_000, S)
    expect(await app.sessionIds(O)).toEqual([])

    await app.projectItem(O).getByTestId('project-actions-button').click()
    await expect(app.page.getByTestId('remove-project')).toHaveAttribute('data-disabled', '')
    await app.closeMenus()
    await app.projectItem(O).click({ button: 'right' })
    await expect(app.page.getByTestId('context-remove-project')).toHaveAttribute(
      'data-disabled',
      '',
    )
    await app.closeMenus()
    const refused = await app.page.evaluate((root) => window.hoot.removeProject(root), O)
    expect(refused.ok).toBe(false)
    expect(await app.projectRoots()).toEqual([O])

    const registered = repositories.map(registrations)
    const branches = repositories.map(localBranches)
    await app.run('exit 3', { waitForPrompt: false })
    await expect(app.sessionItem(S)).toHaveAttribute('data-status', 'exited')
    await app.projectItem(O).getByTestId('project-actions-button').click()
    await app.page.getByTestId('remove-project').click()
    await expect(app.projectItems()).toHaveCount(0)
    await expect(app.sessionItem(S)).toHaveCount(0)
    for (const directory of [R, path.join(R, 'inner'), path.join(R, 'inner', 'deep')]) {
      expect(fs.existsSync(directory)).toBe(true)
    }
    expect(fs.existsSync(path.join(R, 'loose'))).toBe(true)
    expect(repositories.map(registrations)).toEqual(registered)
    expect(repositories.map(localBranches)).toEqual(branches)
  })

  test('creating, listing, deleting and removing worktrees leave the coding tools’ settings alone', async ({
    launch,
    world,
  }) => {
    const claude = path.join(world.home, '.claude.json')
    const codex = path.join(world.home, '.codex', 'config.toml')
    fs.writeFileSync(claude, '{"projects":{}}\n')
    fs.mkdirSync(path.dirname(codex), { recursive: true })
    fs.writeFileSync(codex, 'model = "known"\n')
    const state = () =>
      [claude, codex].map((file) => ({
        content: fs.readFileSync(file, 'utf8'),
        modified: fs.statSync(file).mtimeMs,
      }))
    const before = state()

    const G = createG(world)
    const app = await launch({ projects: [G] })
    const R = await createWorktree(app, G, 'feat/tools')
    const session = await startWorktreeSession(app, R, 'shell')
    await app.waitForPrompt(20_000, session)
    await app.closeSession(session)
    await requestDelete(app, R)
    await app.page.getByTestId('worktree-delete-confirm').click()
    await expect(deleteDialog(app)).toBeHidden()
    await expect(worktreeItem(app, R)).toHaveCount(0)

    // Another worktree, whose root is deleted outside Hoot: Missing once the window has the focus.
    const gone = await createWorktree(app, G, 'beta')
    fs.rmSync(gone, { recursive: true, force: true })
    await emitWindowFocus(app)
    await expect(worktreeItem(app, gone)).toHaveAttribute('data-missing', 'true')
    await openWorktreeActions(app, gone)
    await app.page.getByTestId('worktree-remove').click()
    await expect(worktreeItem(app, gone)).toHaveCount(0)
    expect(registrations(G)).toEqual([])

    expect(state()).toEqual(before)
  })

  test('Copy Path copies the root’s path, and Reveal in Finder shows the root', async ({
    launch,
    world,
  }) => {
    const G = createG(world)
    const app = await launch({ projects: [G] })
    const R = await createWorktree(app, G, 'feat/r')
    const saved = await app.readClipboard()
    try {
      await app.writeClipboard('before')
      await openWorktreeActions(app, R)
      await app.page.getByTestId('worktree-copy-path').click()
      await expect.poll(() => app.readClipboard()).toBe(R)
    } finally {
      await app.writeClipboard(saved)
    }

    // Finder itself is not opened in the tests: Hoot asks macOS to show the root in it.
    await app.electronApp.evaluate(({ shell }) => {
      const shown: string[] = []
      ;(globalThis as { shownInFinder?: string[] }).shownInFinder = shown
      shell.showItemInFolder = (file: string) => {
        shown.push(file)
      }
    })
    await openWorktreeActions(app, R)
    await app.page.getByTestId('worktree-reveal').click()
    await expect
      .poll(() =>
        app.electronApp.evaluate(
          () => (globalThis as { shownInFinder?: string[] }).shownInFinder ?? [],
        ),
      )
      .toEqual([R])
  })

  test('Hoot runs with any user data share one worktree directory', async ({ launch, world }) => {
    const G = createG(world)
    const W = worktreesDir(world)

    let app = await launch({ projects: [G] })
    const u1 = await createWorktree(app, G, 'u1')
    await app.quit()
    await app.waitForExit()

    app = await launch({ projects: [G], userData: path.join(world.root, 'other-user-data') })
    await expect(worktreeNamed(app, G, 'u1')).toHaveCount(1)
    const u2 = await createWorktree(app, G, 'u2')
    expect(u1).toBe(path.join(W, 'G', 'u1'))
    expect(u2).toBe(path.join(W, 'G', 'u2'))
    expect(path.dirname(u1)).toBe(path.dirname(u2))
  })
})

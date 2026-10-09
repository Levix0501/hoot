import { snapshotTree } from './support/fs-snapshot'
import { expect, test } from './support/test'
import { createOtherLayouts } from './support/world'

test.describe('projects', () => {
  test('a subdirectory, a linked worktree and the repository itself add one project', async ({
    app,
    world,
  }) => {
    const { G, Gsub, W } = world.repos
    await expect(app.page.getByTestId('no-projects')).toBeVisible()
    await app.expectEnglishUi()

    await app.addProject(Gsub)
    await expect(app.toasts('Project added.')).toHaveCount(1)
    await expect(app.projectItems()).toHaveCount(1)
    expect(await app.projectRoots()).toEqual([G])
    await expect(app.projectItem(G).getByTestId('project-name')).toHaveText('G')

    const duplicates = app.toasts('already in the list')
    await app.addProject(W)
    await expect(duplicates).toHaveCount(1)
    await expect(app.projectItems()).toHaveCount(1)

    await app.addProject(G)
    await expect(duplicates).toHaveCount(2)
    await expect(app.projectItems()).toHaveCount(1)
    expect(await app.projectRoots()).toEqual([G])
    await app.expectEnglishUi()
  })

  test('folders outside Git and bare repositories are refused with an explanation', async ({
    app,
    world,
  }) => {
    const { N, B, BW } = world.repos
    await app.addProject(N)
    await expect(app.toasts('The selected folder is not in a Git repository.')).toHaveCount(1)
    await app.expectEnglishUi()

    const bare = app.toasts('Bare repositories are not supported yet.')
    await app.addProject(B)
    await expect(bare).toHaveCount(1)
    await app.addProject(BW)
    await expect(bare).toHaveCount(2)
    await app.expectEnglishUi()

    await expect(app.projectItems()).toHaveCount(0)
    await expect(app.page.getByTestId('no-projects')).toBeVisible()
  })

  test('removing a project leaves its files untouched', async ({ app, world }) => {
    const { G } = world.repos
    await app.addProject(G)
    await expect(app.projectItems()).toHaveCount(1)
    const before = await snapshotTree(G)
    expect(before.children.map((child) => child.name)).toContain('.git')

    await app.projectItem(G).click({ button: 'right' })
    const remove = app.page.getByTestId('context-remove-project')
    await expect(remove).toBeVisible()
    await app.expectEnglishUi()
    await remove.click()
    await expect(app.projectItems()).toHaveCount(0)
    expect(await snapshotTree(G)).toEqual(before)
  })

  test('a project with a running session cannot be removed; removing it closes its ended sessions', async ({
    app,
    world,
  }) => {
    const { G, H } = world.repos
    await app.addProject(G)
    await expect(app.projectItems()).toHaveCount(1)
    await app.addProject(H)
    await expect(app.projectItems()).toHaveCount(2)
    const s1 = await app.startSession(G, 'shell')
    await app.waitForPrompt()
    const s2 = await app.startSession(G, 'shell')
    await app.waitForPrompt()
    await app.run('exit 3', { waitForPrompt: false })
    await expect(app.sessionItem(s2)).toHaveAttribute('data-status', 'exited')
    const h1 = await app.startSession(H, 'shell')
    await app.waitForPrompt()

    await app.projectItem(G).getByTestId('project-actions-button').click()
    const menuRemove = app.page.getByTestId('remove-project')
    await expect(menuRemove).toBeVisible()
    await expect(menuRemove).toHaveAttribute('data-disabled', '')
    await menuRemove.click({ force: true })
    await app.closeMenus()

    await app.projectItem(G).click({ button: 'right' })
    const remove = app.page.getByTestId('context-remove-project')
    await expect(remove).toHaveAttribute('data-disabled', '')
    await remove.click({ force: true })
    await app.closeMenus()

    // Asked directly, without the interface, Hoot refuses as well.
    const result = await app.page.evaluate((root) => window.hoot.removeProject(root), G)
    expect(result.ok).toBe(false)
    await expect(app.projectItems()).toHaveCount(2)
    expect(await app.projectRoots()).toEqual([G, H])
    await expect(app.sessionItem(s1)).toHaveAttribute('data-status', 'running')
    await app.expectEnglishUi()

    await app.closeSession(s1)
    await app.projectItem(G).getByTestId('project-actions-button').click()
    await expect(menuRemove).not.toHaveAttribute('data-disabled')
    await menuRemove.click()
    await expect(app.projectItems()).toHaveCount(1)
    expect(await app.projectRoots()).toEqual([H])
    await expect(app.sessionItem(s2)).toHaveCount(0)
    expect(await app.sessionIds()).toEqual([h1])
    await expect(app.session()).toHaveAttribute('data-session-id', h1)
  })

  test('the project list is the same after quitting and starting again', async ({
    launch,
    world,
  }) => {
    const { G, H } = world.repos
    let app = await launch()
    await app.addProject(G)
    await expect(app.projectItems()).toHaveCount(1)
    await app.addProject(H)
    await expect(app.projectItems()).toHaveCount(2)
    await app.projectItem(H).getByTestId('project-actions-button').click()
    await app.page.getByTestId('remove-project').click()
    await expect(app.projectItems()).toHaveCount(1)

    await app.quit()
    await app.waitForExit()

    app = await launch()
    await expect(app.projectItems()).toHaveCount(1)
    expect(await app.projectRoots()).toEqual([G])
    await app.expectEnglishUi()
  })

  test('a submodule and a repository with a separate Git directory are added by their working directories', async ({
    app,
    world,
  }) => {
    const { M, Msub, S, SW } = createOtherLayouts(world)

    // The submodule's checkout, not its Git directory under P/.git/modules and not P.
    await app.addProject(Msub)
    await expect(app.toasts('Project added.')).toHaveCount(1)
    await expect(app.projectItems()).toHaveCount(1)
    expect(await app.projectRoots()).toEqual([M])
    await app.addProject(M)
    await expect(app.toasts('already in the list')).toHaveCount(1)
    await expect(app.projectItems()).toHaveCount(1)
    await app.expectEnglishUi()

    // The working directory, not the separate Git directory.
    await app.addProject(S)
    await expect(app.projectItems()).toHaveCount(2)
    expect(await app.projectRoots()).toEqual([M, S])
    await app.startSession(S, 'shell')
    await expect(app.session()).toHaveAttribute('data-status', 'running')
    await app.waitForPrompt()
    await app.run('pwd')
    expect(await app.outputOf('pwd')).toEqual([S])
    const status = 'git status > /dev/null; echo "git-status=$?"'
    await app.run(status)
    expect(await app.outputOf(status)).toEqual(['git-status=0'])

    await app.addProject(SW)
    await expect(
      app.toasts('The main worktree of this repository cannot be determined'),
    ).toHaveCount(1)
    await expect(app.projectItems()).toHaveCount(2)
    expect(await app.projectRoots()).toEqual([M, S])
    await app.expectEnglishUi()
  })
})

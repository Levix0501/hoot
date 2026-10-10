import { sameCssColor } from './support/layout'
import {
  databaseFile,
  readDatabase,
  storedIssues,
  storedProjects,
  tableShape,
} from './support/database'
import {
  clickProjectRow,
  createIssue,
  deleteShownIssue,
  expectList,
  expectListed,
  expectShown,
  issueTab,
  openIssueCount,
  projectRowButton,
  setShownIssueState,
} from './support/issues'
import { expect, test } from './support/test'

test.describe('the project row', () => {
  test('shows how many issues are open, shows the issue list when clicked, and is selected then', async ({
    launch,
    world,
  }) => {
    const { G, H } = world.repos
    const app = await launch({
      projects: [G, H],
      issues: [
        { root: G, title: 'A' },
        { root: G, title: 'B' },
        { root: G, title: 'C', closed: true },
      ],
    })
    const s = await app.startSession(G, 'shell')
    await app.waitForPrompt(20_000, s)
    await expectShown(app, `session:${s}`)

    // 1: the count, then the row selected instead of the session's.
    await expect.poll(() => openIssueCount(app, G)).toBe(2)
    expect(await openIssueCount(app, H)).toBeNull()
    await expect(app.sessionItem(s).getByTestId('session-item-button')).toHaveAttribute(
      'data-active',
      '',
    )
    await clickProjectRow(app, G)
    await expectList(app, G)
    await expect(projectRowButton(app, G)).toHaveAttribute('data-active', '')
    await expect(projectRowButton(app, H)).not.toHaveAttribute('data-active')
    await expect(app.page.locator('[data-testid="session-item-button"][data-active]')).toHaveCount(
      0,
    )
    // In the look of the sidebar's selected item: the sidebar's accent color.
    await app.page.mouse.move(700, 700)
    const look = await projectRowButton(app, G).evaluate((element) => ({
      background: getComputedStyle(element).backgroundColor,
      accent: getComputedStyle(document.documentElement).getPropertyValue('--sidebar-accent'),
      other: getComputedStyle(document.querySelector('[data-testid="session-item-button"]')!)
        .backgroundColor,
    }))
    expect(sameCssColor(look.background, look.accent)).toBe(true)
    expect(sameCssColor(look.other, look.accent)).toBe(false)

    // 2: the count follows creating, closing, reopening and deleting.
    await createIssue(app, G, 'D')
    await expect.poll(() => openIssueCount(app, G)).toBe(3)
    await setShownIssueState(app, 'closed')
    await expect.poll(() => openIssueCount(app, G)).toBe(2)
    await setShownIssueState(app, 'open')
    await expect.poll(() => openIssueCount(app, G)).toBe(3)
    await deleteShownIssue(app)
    await expect.poll(() => openIssueCount(app, G)).toBe(2)

    // 3: the row's buttons and context menu open their menus, and show no other page.
    for (const shown of [`list:${G}`, `session:${s}`]) {
      if (shown.startsWith('session:')) await app.selectSession(s)
      await expectShown(app, shown)
      await app.newSessionButton(G).click()
      await expect(app.toolItem('shell')).toBeVisible()
      await expect(app.page.getByTestId('new-worktree')).toBeVisible()
      await app.closeMenus()
      await expectShown(app, shown)
      await app.projectItem(G).getByTestId('project-actions-button').click()
      await expect(app.page.getByTestId('remove-project')).toBeVisible()
      await app.closeMenus()
      await expectShown(app, shown)
      await app.projectItem(G).click({ button: 'right' })
      await expect(app.page.getByTestId('context-remove-project')).toBeVisible()
      await app.closeMenus()
      await expectShown(app, shown)
    }
    await app.expectEnglishUi()
  })
})

test.describe('removing and adding a project again', () => {
  test('keeps its id and its issues, which come back with it', async ({ launch, world }) => {
    const { G, Gsub, H } = world.repos
    const app = await launch({
      projects: [G, H],
      issues: [
        { root: G, title: 'Open one', description: 'first' },
        { root: G, title: 'Closed one', description: 'second', closed: true },
      ],
    })

    // 1: what the database holds, then G removed.
    const projectsBefore = storedProjects(world.userData)
    const issuesBefore = storedIssues(world.userData)
    const g = projectsBefore.find((project) => project.root === G)!
    expect(issuesBefore.map((issue) => [issue.title, issue.project_id])).toEqual([
      ['Open one', g.id],
      ['Closed one', g.id],
    ])
    await app.projectItem(G).getByTestId('project-actions-button').click()
    await app.page.getByTestId('remove-project').click()
    await expect(app.projectItems()).toHaveCount(1)
    expect(await app.projectRoots()).toEqual([H])

    // 2: added again from a folder inside it, at the end, with its issues.
    await app.addProject(Gsub)
    await expect(app.projectItems()).toHaveCount(2)
    expect(await app.projectRoots()).toEqual([H, G])
    await clickProjectRow(app, G)
    await expectList(app, G, 'open')
    await expectListed(app, ['Open one'])
    await issueTab(app, 'closed').click()
    await expectListed(app, ['Closed one'])
    expect(storedProjects(world.userData).find((project) => project.root === G)?.id).toBe(g.id)
    expect(storedIssues(world.userData)).toEqual(issuesBefore)

    // 3: a project in the list is not added twice.
    await app.addProject(H)
    await expect(app.toasts('This project is already in the list.')).toHaveCount(1)
    expect(await app.projectRoots()).toEqual([H, G])

    // 4: issues refer to their project by its id, not by its root.
    const issues = tableShape(databaseFile(world.userData), 'issues')
    expect(issues.references).toEqual([{ from: 'project_id', table: 'projects', to: 'id' }])
    expect(issues.columns.filter((column) => /root|path|folder|dir/i.test(column))).toEqual([])
    const values = readDatabase(databaseFile(world.userData), (db) =>
      db.prepare('SELECT * FROM issues').all(),
    ).flatMap((row) => Object.values(row))
    expect(values).not.toContain(G)

    // 5: a project with a running session still cannot be removed.
    await app.startSession(G, 'shell')
    await app.waitForPrompt()
    await app.projectItem(G).getByTestId('project-actions-button').click()
    await expect(app.page.getByTestId('remove-project')).toHaveAttribute('data-disabled', '')
    await app.closeMenus()
    await app.projectItem(G).click({ button: 'right' })
    await expect(app.page.getByTestId('context-remove-project')).toHaveAttribute(
      'data-disabled',
      '',
    )
    await app.closeMenus()
    await app.expectEnglishUi()
  })
})

import { storedIssues, storedProjects } from './support/database'
import {
  clickIssuesButton,
  expectList,
  expectShown,
  issueGroup,
  issueRow,
  newIssueDialog,
  openNewIssueDialog,
  pickWith,
  showList,
} from './support/issues'
import { expect, test } from './support/test'

test.describe('the new issue dialog', () => {
  test('creates an issue in the project of the page shown, with the title trimmed, and says so without leaving the page', async ({
    launch,
    world,
  }) => {
    const { G } = world.repos
    const app = await launch({ projects: [G] })
    const s = await app.startSession(G, 'shell')
    await app.waitForPrompt(20_000, s)
    await clickIssuesButton(app, G)
    await expectList(app, G)
    const dialog = newIssueDialog(app)
    const title = app.page.getByTestId('new-issue-title')
    const description = app.page.getByTestId('new-issue-description')
    const create = app.page.getByTestId('new-issue-create')

    // 1: the dialog, from the list's button.
    await app.page.getByTestId('new-issue-button').click()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('new-issue-project')).toHaveText('G')
    await expect(dialog).toContainText('New issue')
    await expect(title).toBeFocused()
    await expect(title).toHaveAttribute('placeholder', 'Issue title')
    await expect(app.page.getByTestId('new-issue-status')).toHaveAttribute('data-status', 'backlog')
    await expect(app.page.getByTestId('new-issue-priority')).toHaveAttribute('data-priority', '0')
    // The description is edited as on an issue's page, not as plain text.
    await expect(description).toHaveAttribute('contenteditable', 'true')
    await app.expectEnglishUi()

    // 2: nothing is created without a title.
    await expect(create).toBeDisabled()
    await title.fill(' \t ')
    await expect(create).toBeDisabled()
    await title.press('Meta+Enter')
    await app.page.waitForTimeout(300)
    await expect(dialog).toBeVisible()
    expect(storedIssues(world.userData)).toEqual([])

    // 3: the title trimmed, the description as typed, the status and the priority picked.
    await title.fill('  Restore sessions  ')
    await title.press('Enter')
    await expect(description).toBeFocused()
    await app.page.keyboard.type('Keep them across restarts')
    await pickWith(app, app.page.getByTestId('new-issue-status'), 'todo')
    await pickWith(app, app.page.getByTestId('new-issue-priority'), 2)
    await create.click()
    await expect(dialog).toBeHidden()
    await expectList(app, G)
    await expect(app.page.getByText('G-1 created')).toBeVisible()
    expect(storedIssues(world.userData)).toMatchObject([
      {
        number: 1,
        title: 'Restore sessions',
        description: 'Keep them across restarts',
        status: 'todo',
        priority: 2,
        completed_at: null,
      },
    ])
    await expect(issueRow(app, 'Restore sessions')).toHaveAttribute('data-status', 'todo')

    // 4: the dialog is not a page: back shows what was shown before the list.
    await app.backButton().click()
    await expectShown(app, `session:${s}`)
    await app.forwardButton().click()
    await expectList(app, G)
    await expect(app.forwardButton()).toBeDisabled()

    // 5: C opens the dialog, ⌘ Enter creates the issue, and the message shows it.
    await openNewIssueDialog(app, G, 'key')
    await expect(title).toHaveValue('')
    await title.fill('Second')
    await title.press('Meta+Enter')
    await expect(dialog).toBeHidden()
    const second = storedIssues(world.userData).find((issue) => issue.title === 'Second')!
    expect(second).toMatchObject({ number: 2, status: 'backlog', priority: 0 })
    await app.page
      .locator('[data-sonner-toast]')
      .filter({ hasText: 'G-2 created' })
      .getByRole('button', { name: 'View issue' })
      .click()
    await expectShown(app, `issue:${second.id}`)

    // 6: a group's + starts the issue with the group's status; ⌘⌥ Enter shows the new issue.
    await showList(app, G)
    await issueGroup(app, 'todo').getByTestId('issue-group-add').click()
    await expect(dialog).toBeVisible()
    await expect(app.page.getByTestId('new-issue-status')).toHaveAttribute('data-status', 'todo')
    await title.fill('Third')
    await description.click()
    await app.page.keyboard.type('From the group')
    await app.page.keyboard.press('Meta+Alt+Enter')
    await expect(dialog).toBeHidden()
    const third = storedIssues(world.userData).find((issue) => issue.title === 'Third')!
    expect(third).toMatchObject({ number: 3, status: 'todo', description: 'From the group' })
    await expectShown(app, `issue:${third.id}`)

    // 7: on an issue's page, C creates an issue in its project.
    await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await app.page.keyboard.press('c')
    await expect(dialog).toBeVisible()
    const g = storedProjects(world.userData).find((project) => project.root === G)!
    await expect(dialog).toHaveAttribute('data-project-id', String(g.id))
    await app.page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    // 8: no other way to create an issue: no menu item about issues anywhere.
    await app.newSessionButton(G).click()
    await expect(app.toolItem('shell')).toBeVisible()
    const plusMenu = await app.page.locator('[role="menu"] [role="menuitem"]').allTextContents()
    expect(plusMenu.length).toBeGreaterThan(0)
    await app.closeMenus()
    await app.openContextToolMenu(G)
    await expect(app.page.locator('[role="menu"]')).toHaveCount(2)
    const contextMenu = await app.page.locator('[role="menu"] [role="menuitem"]').allTextContents()
    await app.page.keyboard.press('Escape')
    await expect(app.page.locator('[role="menu"]')).toHaveCount(1)
    await app.closeMenus()
    const menuBar = await app.menuLabels()
    expect(
      [...plusMenu, ...contextMenu, ...menuBar].filter((label) => /issue/i.test(label)),
    ).toEqual([])
  })

  test('with Create more, stays open for the next issue, keeping the status and the priority', async ({
    launch,
    world,
  }) => {
    const { G } = world.repos
    const app = await launch({ projects: [G] })
    const dialog = newIssueDialog(app)
    const title = app.page.getByTestId('new-issue-title')
    const description = app.page.getByTestId('new-issue-description')
    const createMore = app.page.getByTestId('new-issue-create-more')

    await openNewIssueDialog(app, G)
    await expect(createMore).toHaveAttribute('aria-checked', 'false')
    await createMore.click()
    await expect(createMore).toHaveAttribute('aria-checked', 'true')
    await title.fill('One')
    await description.click()
    await app.page.keyboard.type('First body')
    await pickWith(app, app.page.getByTestId('new-issue-status'), 'in_progress')
    await pickWith(app, app.page.getByTestId('new-issue-priority'), 1)
    await app.page.getByTestId('new-issue-create').click()
    await expect(app.page.getByText('G-1 created')).toBeVisible()
    await expect(dialog).toBeVisible()
    await expect(title).toHaveValue('')
    await expect(title).toBeFocused()
    await expect(description).toHaveText('')
    await expect(app.page.getByTestId('new-issue-status')).toHaveAttribute(
      'data-status',
      'in_progress',
    )
    await expect(app.page.getByTestId('new-issue-priority')).toHaveAttribute('data-priority', '1')

    await app.page.keyboard.type('Two')
    await app.page.keyboard.press('Meta+Enter')
    await expect(app.page.getByText('G-2 created')).toBeVisible()
    await expect(title).toHaveValue('')
    expect(
      storedIssues(world.userData).map((issue) => ({
        title: issue.title,
        description: issue.description,
        status: issue.status,
        priority: issue.priority,
      })),
    ).toEqual([
      { title: 'One', description: 'First body', status: 'in_progress', priority: 1 },
      { title: 'Two', description: '', status: 'in_progress', priority: 1 },
    ])

    // Until Hoot quits, the dialog opens with Create more as it was left.
    await app.page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await openNewIssueDialog(app, G)
    await expect(createMore).toHaveAttribute('aria-checked', 'true')
  })

  test('keeps what is entered for each project when it closes, until the issue is created, the project is removed or Hoot quits', async ({
    launch,
    world,
  }) => {
    const { G, H } = world.repos
    let app = await launch({ projects: [G, H] })
    const s = await app.startSession(G, 'shell')
    await app.waitForPrompt(20_000, s)
    // Of the app running now, which changes when Hoot is opened again.
    const dialog = () => newIssueDialog(app)
    const title = () => app.page.getByTestId('new-issue-title')
    const description = () => app.page.getByTestId('new-issue-description')
    const expectDraft = async (root: string, draft: { title: string; description: string }) => {
      await openNewIssueDialog(app, root)
      await expect(title()).toHaveValue(draft.title)
      await expect(description()).toHaveText(draft.description)
    }

    // 1: closed with Esc, with its close button, or by showing another page.
    await openNewIssueDialog(app, G)
    await title().fill('Draft title')
    await description().click()
    await app.page.keyboard.type('Draft body')
    await app.page.keyboard.press('Escape')
    await expect(dialog()).toBeHidden()
    await expectDraft(G, { title: 'Draft title', description: 'Draft body' })
    await app.page.getByTestId('new-issue-close').click()
    await expect(dialog()).toBeHidden()
    await expectDraft(G, { title: 'Draft title', description: 'Draft body' })
    await app.page.keyboard.press('Meta+1')
    await expectShown(app, `session:${s}`)
    await expect(dialog()).toBeHidden()
    await app.page.keyboard.press('Meta+BracketLeft')
    await expectList(app, G)
    await expectDraft(G, { title: 'Draft title', description: 'Draft body' })
    await app.page.keyboard.press('Escape')

    // 2: each project has its own.
    await expectDraft(H, { title: '', description: '' })
    await title().fill('H draft')
    await app.page.keyboard.press('Escape')
    await expectDraft(G, { title: 'Draft title', description: 'Draft body' })

    // 3: gone once the issue is created.
    await app.page.getByTestId('new-issue-create').click()
    await expect(dialog()).toBeHidden()
    await expectDraft(G, { title: '', description: '' })
    await app.page.keyboard.press('Escape')

    // 4: removing a project drops its draft.
    await app.projectItem(H).getByTestId('project-actions-button').click()
    await app.page.getByTestId('remove-project').click()
    await expect(app.projectItems()).toHaveCount(1)
    await app.addProject(H)
    await expect(app.projectItems()).toHaveCount(2)
    await expectDraft(H, { title: '', description: '' })
    await app.page.keyboard.press('Escape')

    // 5: quitting drops drafts, without asking about them.
    await app.closeSession(s)
    await openNewIssueDialog(app, G)
    await title().fill('Left behind')
    await app.page.keyboard.press('Escape')
    await app.quit()
    await app.waitForExit()
    app = await launch()
    await expectDraft(G, { title: '', description: '' })
  })
})

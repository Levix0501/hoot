import type { AppDriver } from './support/app'
import { storedIssues, type SeedIssue } from './support/database'
import {
  clickIssuesButton,
  createIssue,
  expectList,
  expectShown,
  issueGroup,
  issueListPage,
  issueRow,
  issuesTopRow,
  listedGroups,
  openIssueCount,
  openRowMenu,
  viewTab,
} from './support/issues'
import { boxOf, TOP_ROW_HEIGHT } from './support/layout'
import { expect, test } from './support/test'

/** Issues of every status and priority, created a second apart in this order. */
function issuesOf(G: string, H: string): SeedIssue[] {
  return [
    { root: G, title: 'Write docs', status: 'backlog' },
    { root: G, title: 'Fix crash', status: 'todo', priority: 1 },
    { root: G, title: 'Polish', status: 'todo', priority: 3 },
    { root: G, title: 'Refactor', status: 'todo', priority: 3 },
    { root: G, title: 'Build it', status: 'in_progress', priority: 2 },
    { root: G, title: 'Shipped', status: 'done' },
    { root: G, title: 'Dropped', status: 'canceled' },
    { root: G, title: 'Old idea', status: 'backlog', priority: 4 },
    { root: H, title: 'Other', status: 'todo' },
  ]
}

/** The text in the clipboard, read in the main process. */
async function clipboardText(app: AppDriver): Promise<string> {
  return app.electronApp.evaluate(({ clipboard }) => clipboard.readText())
}

test.describe('the issue list', () => {
  test('groups the issues by status, the closest to done first, and orders each group by priority; its views and groups are remembered', async ({
    launch,
    world,
  }) => {
    const { G, H } = world.repos
    let app = await launch({ projects: [G, H], issues: issuesOf(G, H) })
    const s = await app.startSession(G, 'shell')
    await app.waitForPrompt(20_000, s)

    // The title row, and all of G's issues.
    await clickIssuesButton(app, G)
    await expectList(app, G, 'all')
    const row = await boxOf(issuesTopRow(app))
    expect(row.top).toBe(0)
    expect(row.bottom).toBeLessThanOrEqual(TOP_ROW_HEIGHT)
    await expect(issuesTopRow(app).getByTestId('issues-project-name')).toHaveText('G')
    await expect(issuesTopRow(app).getByText('Issues', { exact: true })).toBeVisible()
    await expect(issuesTopRow(app).getByRole('button', { name: 'New issue' })).toBeVisible()
    expect(await listedGroups(app)).toEqual([
      { status: 'in_progress', count: 1, titles: ['Build it'] },
      { status: 'todo', count: 3, titles: ['Fix crash', 'Refactor', 'Polish'] },
      { status: 'backlog', count: 2, titles: ['Old idea', 'Write docs'] },
      { status: 'done', count: 1, titles: ['Shipped'] },
      { status: 'canceled', count: 1, titles: ['Dropped'] },
    ])

    // A row: its priority, identifier, status, title and when it was created.
    const fix = issueRow(app, 'Fix crash')
    await expect(fix).toHaveAttribute('data-priority', '1')
    await expect(fix).toHaveAttribute('data-status', 'todo')
    await expect(fix.getByTestId('issue-row-identifier')).toHaveText('G-2')
    const created = storedIssues(world.userData).find((issue) => issue.title === 'Fix crash')!
    await expect(fix.getByTestId('issue-row-created')).toHaveAttribute(
      'dateTime',
      new Date(created.created_at).toISOString(),
    )
    await expect(fix.getByTestId('issue-row-created')).toHaveText(/^[A-Z][a-z]{2} \d{1,2}$/)

    // The active issues, and the backlog.
    await viewTab(app, 'active').click()
    expect((await listedGroups(app)).map((group) => group.status)).toEqual(['in_progress', 'todo'])
    await viewTab(app, 'backlog').click()
    expect(await listedGroups(app)).toEqual([
      { status: 'backlog', count: 2, titles: ['Old idea', 'Write docs'] },
    ])

    // Each project's list shows the view it showed last, also after a session was shown.
    await clickIssuesButton(app, H)
    await expectList(app, H, 'all')
    await viewTab(app, 'backlog').click()
    await expect(issueListPage(app).getByTestId('issues-empty')).toContainText(
      'No issues in the backlog.',
    )
    await expect(issueListPage(app).getByTestId('issues-empty-create')).toBeVisible()
    await app.selectSession(s)
    await clickIssuesButton(app, G)
    await expectList(app, G, 'backlog')

    // Changing views is not recorded in the history.
    for (const view of ['all', 'active', 'all'] as const) {
      await viewTab(app, view).click()
      await expectList(app, G, view)
    }
    await app.backButton().click()
    await expectShown(app, `session:${s}`)
    await app.forwardButton().click()
    await expectList(app, G, 'all')

    // A collapsed group shows its count but not its issues, and stays collapsed.
    await issueGroup(app, 'todo').getByTestId('issue-group-toggle').click()
    await expect(issueGroup(app, 'todo').getByTestId('issue-row')).toHaveCount(0)
    await expect(issueGroup(app, 'todo').getByTestId('issue-group-count')).toHaveText('3')
    await clickIssuesButton(app, H)
    await clickIssuesButton(app, G)
    await expectList(app, G, 'all')
    await expect(issueGroup(app, 'todo').getByTestId('issue-row')).toHaveCount(0)
    await issueGroup(app, 'todo').getByTestId('issue-group-toggle').click()
    await expect(issueGroup(app, 'todo').getByTestId('issue-row')).toHaveCount(3)
    await issueGroup(app, 'done').getByTestId('issue-group-toggle').click()
    await expect(issueGroup(app, 'done').getByTestId('issue-row')).toHaveCount(0)
    await app.expectEnglishUi()

    // Views and collapsed groups start over with Hoot.
    await app.quit()
    await expect(app.page.getByTestId('quit-dialog')).toBeVisible()
    await app.page.getByTestId('quit-confirm').click()
    await app.waitForExit()
    app = await launch()
    await clickIssuesButton(app, H)
    await expectList(app, H, 'all')
    await clickIssuesButton(app, G)
    await expectList(app, G, 'all')
    await expect(issueGroup(app, 'done').getByTestId('issue-row')).toHaveCount(1)
  })

  test('a row’s context menu changes its status and priority, copies its identifier and title, and deletes it', async ({
    launch,
    world,
  }) => {
    const { G, H } = world.repos
    const app = await launch({ projects: [G, H], issues: issuesOf(G, H) })
    await clickIssuesButton(app, G)
    await expectList(app, G)
    expect(await openIssueCount(app, G)).toBe(6)

    // The menu, and the status submenu with the issue's status picked.
    await openRowMenu(app, 'Polish')
    const menu = app.page.locator('[data-slot="context-menu-content"]').first()
    await expect(menu).toContainText('Status')
    await expect(menu).toContainText('Priority')
    await expect(menu).toContainText('Copy ID')
    await expect(menu).toContainText('Copy title')
    await expect(menu).toContainText('Delete…')
    await app.page.getByTestId('issue-menu-status').hover()
    const todo = app.page.locator('[role="menuitemradio"][data-value="todo"]')
    await expect(todo).toHaveAttribute('aria-checked', 'true')
    await app.page.locator('[role="menuitemradio"][data-value="in_progress"]').click()
    await expect(app.page.locator('[role="menu"]')).toHaveCount(0)
    await expect
      .poll(async () => (await listedGroups(app))[0])
      .toEqual({
        status: 'in_progress',
        count: 2,
        // High before medium.
        titles: ['Build it', 'Polish'],
      })
    expect(storedIssues(world.userData).find((issue) => issue.title === 'Polish')?.status).toBe(
      'in_progress',
    )

    // A digit picks a value in a submenu.
    await openRowMenu(app, 'Polish')
    await app.page.getByTestId('issue-menu-priority').hover()
    await expect(app.page.locator('[role="menuitemradio"][data-value="3"]')).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await app.page.locator('[role="menuitemradio"][data-value="3"]').focus()
    await app.page.keyboard.press('1')
    await expect(app.page.locator('[role="menu"]')).toHaveCount(0)
    await expect(issueRow(app, 'Polish')).toHaveAttribute('data-priority', '1')
    await expect
      .poll(() => storedIssues(world.userData).find((issue) => issue.title === 'Polish')?.priority)
      .toBe(1)

    // Copying.
    await openRowMenu(app, 'Polish')
    await app.page.getByTestId('issue-menu-copy-id').click()
    await expect.poll(() => clipboardText(app)).toBe('G-3')
    await expect(app.page.getByText('Copied to the clipboard.')).toBeVisible()
    await openRowMenu(app, 'Polish')
    await app.page.getByTestId('issue-menu-copy-title').click()
    await expect.poll(() => clipboardText(app)).toBe('Polish')

    // Deleting asks first.
    await openRowMenu(app, 'Old idea')
    await app.page.getByTestId('issue-menu-delete').click()
    await expect(app.page.getByTestId('delete-issue-dialog')).toContainText(
      'will be deleted for good. This cannot be undone.',
    )
    await app.page.getByTestId('delete-issue-cancel').click()
    await expect(app.page.getByTestId('delete-issue-dialog')).toBeHidden()
    await expect(issueRow(app, 'Old idea')).toHaveCount(1)
    await openRowMenu(app, 'Old idea')
    await app.page.getByTestId('issue-menu-delete').click()
    await app.page.getByTestId('delete-issue-confirm').click()
    await expect(issueRow(app, 'Old idea')).toHaveCount(0)
    await expectList(app, G)
    expect(storedIssues(world.userData).map((issue) => issue.title)).not.toContain('Old idea')
    await expect.poll(() => openIssueCount(app, G)).toBe(5)

    // Its number, the last given, is not given again.
    await createIssue(app, G, 'New one')
    await expect(issueRow(app, 'New one').getByTestId('issue-row-identifier')).toHaveText('G-9')
  })
})

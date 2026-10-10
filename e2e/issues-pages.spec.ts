import { storedIssues } from './support/database'
import {
  clickProjectRow,
  createIssue,
  expectList,
  expectListed,
  expectShown,
  issuePage,
  issueRow,
  issueTab,
  issuesTopRow,
  newIssuePage,
  openIssue,
  setShownIssueState,
  shownIssueId,
  tabCount,
} from './support/issues'
import { boxOf, TOP_ROW_HEIGHT } from './support/layout'
import type { AppDriver } from './support/app'
import { expect, test } from './support/test'

/** Checks that the Issues page's title row lies in the window's top row. */
async function expectTitleRowInTopRow(app: AppDriver): Promise<void> {
  const row = await boxOf(issuesTopRow(app))
  expect(row.top).toBe(0)
  expect(row.bottom).toBeLessThanOrEqual(TOP_ROW_HEIGHT)
}

/** Waits a little over a second, so that two issues are created or closed at different times. */
async function aSecondLater(app: AppDriver): Promise<void> {
  await app.page.waitForTimeout(1_100)
}

test.describe('the issue list (A5)', () => {
  test('lists open issues newest first and closed ones most recently closed first, and remembers its tab', async ({
    launch,
    world,
  }) => {
    const { G, H } = world.repos
    let app = await launch({ projects: [G, H] })
    await createIssue(app, G, 'A')
    await aSecondLater(app)
    await createIssue(app, G, 'B')
    await aSecondLater(app)
    await createIssue(app, G, 'C')
    await openIssue(app, G, 'B')
    await setShownIssueState(app, 'closed')
    await aSecondLater(app)
    await openIssue(app, G, 'A')
    await setShownIssueState(app, 'closed')
    await app.quit()
    await app.waitForExit()

    app = await launch()
    const s = await app.startSession(G, 'shell')
    await app.waitForPrompt(20_000, s)

    // 1: the title row, the tabs with their counts, and C with when it was opened.
    await clickProjectRow(app, G)
    await expectList(app, G, 'open')
    await expectTitleRowInTopRow(app)
    await expect(issuesTopRow(app).getByText('Issues', { exact: true })).toBeVisible()
    await expect(issuesTopRow(app).getByTestId('issues-project-name')).toHaveText('G')
    await expect(issuesTopRow(app).getByRole('button', { name: 'New Issue' })).toBeVisible()
    expect([await tabCount(app, 'open'), await tabCount(app, 'closed')]).toEqual([1, 2])
    await expectListed(app, ['C'])
    const created = storedIssues(world.userData).find((issue) => issue.title === 'C')!.created_at
    const opened = issueRow(app, 'C').getByTestId('issue-row-created')
    await expect(opened).toHaveAttribute('dateTime', new Date(created).toISOString())
    await expect(opened).toHaveText(/\S/)

    // 2: the closed issues, the most recently closed first, without when they were opened.
    await issueTab(app, 'closed').click()
    await expectListed(app, ['A', 'B'])
    await expect(app.page.getByTestId('issue-row-created')).toHaveCount(0)
    expect([await tabCount(app, 'open'), await tabCount(app, 'closed')]).toEqual([1, 2])

    // 3: nothing to search, sort, close, reopen, edit or delete with, and no context menu.
    const list = app.page.getByTestId('issue-list-page')
    await expect(list.locator('input, textarea, select, [role="combobox"]')).toHaveCount(0)
    await expect(list.locator('[aria-haspopup]')).toHaveCount(0)
    await expect(
      list.getByRole('button', { name: /close issue|reopen|edit|delete|sort/i }),
    ).toHaveCount(0)
    await issueRow(app, 'A').click({ button: 'right' })
    await app.page.waitForTimeout(300)
    await expect(app.page.locator('[role="menu"]')).toHaveCount(0)

    // 4: an issue's page, and back to the list as it was.
    await issueRow(app, 'A').click()
    const a = await shownIssueId(app)
    await expect(issuePage(app).getByTestId('issue-title')).toHaveText('A')
    await app.backButton().click()
    await expectList(app, G, 'closed')

    // 5: the tab a project's list showed last, also after a session was shown.
    await app.selectSession(s)
    await clickProjectRow(app, G)
    await expectList(app, G, 'closed')
    await clickProjectRow(app, H)
    await expectList(app, H, 'open')

    // 6: changing tabs is not recorded in the history.
    await clickProjectRow(app, G)
    await expectList(app, G, 'closed')
    for (const state of ['open', 'closed', 'open'] as const) {
      await issueTab(app, state).click()
      await expectList(app, G, state)
    }
    await app.backButton().click()
    await expectList(app, H, 'open')
    expect(a).toBeGreaterThan(0)
    await app.expectEnglishUi()

    // 7: the tabs start over with Hoot.
    await app.quit()
    await expect(app.page.getByTestId('quit-dialog')).toBeVisible()
    await app.page.getByTestId('quit-confirm').click()
    await app.waitForExit()
    app = await launch()
    await clickProjectRow(app, G)
    await expectList(app, G, 'open')
  })
})

test.describe('the new issue page (A6)', () => {
  test('creates an issue with its title trimmed and its description as entered, then shows it', async ({
    launch,
    world,
  }) => {
    const { G } = world.repos
    const app = await launch({ projects: [G] })
    const s = await app.startSession(G, 'shell')
    await app.waitForPrompt(20_000, s)
    await clickProjectRow(app, G)
    await expectList(app, G)

    // 1: the page.
    await app.page.getByTestId('new-issue-button').click()
    await expectShown(app, `new:${G}`)
    await expectTitleRowInTopRow(app)
    await expect(issuesTopRow(app).getByRole('button', { name: 'Issues' })).toBeVisible()
    await expect(issuesTopRow(app).getByTestId('issues-project-name')).toHaveText('G')
    await expect(newIssuePage(app).getByText('New Issue', { exact: true })).toBeVisible()
    const title = app.page.getByTestId('new-issue-title')
    const description = app.page.getByTestId('new-issue-description')
    const create = app.page.getByTestId('new-issue-create')
    for (const field of [title, description]) await expect(field).toBeEditable()
    await expect(app.page.getByTestId('new-issue-cancel')).toHaveText('Cancel')
    await expect(create).toHaveText('Create')
    await app.expectEnglishUi()

    // 2: no issue without a title.
    await expect(create).toBeDisabled()
    await title.fill(' \t  \t')
    await expect(create).toBeDisabled()

    // 3: created and shown.
    const entered = '  line one\n\nline two  '
    await title.fill('  Restore sessions  ')
    await description.fill(entered)
    await expect(create).toBeEnabled()
    await create.click()
    await expect(issuePage(app).getByTestId('issue-title')).toHaveText('Restore sessions')
    const id = await shownIssueId(app)
    await expect(issuePage(app).getByTestId('issue-state')).toHaveText('Open')
    await app.page.getByTestId('issue-edit').click()
    await expect(app.page.getByTestId('issue-description-input')).toHaveValue(entered)
    await app.page.getByTestId('issue-cancel-edit').click()
    expect(storedIssues(world.userData).find((issue) => issue.id === id)).toMatchObject({
      title: 'Restore sessions',
      description: entered,
      state: 'open',
    })

    // 4: the new issue page has left the history.
    await app.backButton().click()
    await expectList(app, G, 'open')
    await expect
      .poll(async () => await app.page.getByTestId('issue-row-title').first().textContent())
      .toBe('Restore sessions')
    await app.backButton().click()
    await expectShown(app, `session:${s}`)
    await app.forwardButton().click()
    await expectList(app, G)
    await app.forwardButton().click()
    await expectShown(app, `issue:${id}`)

    // 5: Cancel drops what was entered and shows the list instead.
    await app.page.getByTestId('back-to-issues').click()
    await expectList(app, G)
    await app.page.getByTestId('new-issue-button').click()
    await expectShown(app, `new:${G}`)
    await title.fill('Discard me')
    await app.page.getByTestId('new-issue-cancel').click()
    await expectList(app, G)
    await expectListed(app, ['Restore sessions'])
    await expect(app.forwardButton()).toBeDisabled()
    await app.backButton().click()
    await expectShown(app, `issue:${id}`)
    await app.page.getByTestId('back-to-issues').click()
    await app.page.getByTestId('new-issue-button').click()
    await expectShown(app, `new:${G}`)
    await expect(title).toHaveValue('')
    await expect(description).toHaveValue('')
    await app.page.getByTestId('back-to-issues').click()
    await expectList(app, G)

    // 6: no other way to create an issue: no menu item about issues anywhere.
    await app.newSessionButton(G).click()
    await expect(app.toolItem('shell')).toBeVisible()
    const plusMenu = await app.page.locator('[role="menu"] [role="menuitem"]').allTextContents()
    expect(plusMenu.length).toBeGreaterThan(0)
    await app.closeMenus()
    await app.openContextToolMenu(G)
    await expect(app.page.locator('[role="menu"]')).toHaveCount(2)
    const contextMenu = await app.page.locator('[role="menu"] [role="menuitem"]').allTextContents()
    expect(contextMenu.length).toBeGreaterThan(plusMenu.length - 1)
    // The submenu first, then the context menu.
    await app.page.keyboard.press('Escape')
    await expect(app.page.locator('[role="menu"]')).toHaveCount(1)
    await app.closeMenus()
    const menuBar = await app.menuLabels()
    expect(
      [...plusMenu, ...contextMenu, ...menuBar].filter((label) => /issue/i.test(label)),
    ).toEqual([])
  })
})

test.describe('an issue’s page (A7)', () => {
  test('shows the issue, edits it in place, and closes and reopens it', async ({
    launch,
    world,
  }) => {
    const { G } = world.repos
    let app = await launch({
      projects: [G],
      issues: [
        { root: G, title: 'P' },
        { root: G, title: 'Q' },
        { root: G, title: 'Alpha', description: 'Body' },
      ],
    })
    const alpha = await openIssue(app, G, 'Alpha')
    let page = issuePage(app)
    const created = await page.getByTestId('issue-created').getAttribute('dateTime')

    // 1: what the page shows.
    await expectTitleRowInTopRow(app)
    await expect(issuesTopRow(app).getByRole('button', { name: 'Issues' })).toBeVisible()
    await expect(issuesTopRow(app).getByTestId('issues-project-name')).toHaveText('G')
    await expect(page.getByTestId('issue-title')).toHaveText('Alpha')
    await expect(page.getByTestId('issue-state')).toHaveText('Open')
    await expect(page.getByTestId('issue-created')).toHaveText(/\S/)
    expect(created).toBe(
      new Date(
        storedIssues(world.userData).find(({ id }) => id === alpha)!.created_at,
      ).toISOString(),
    )
    await expect(page.getByTestId('issue-description')).toHaveText('Body')
    for (const name of ['Edit', 'Delete', 'Close Issue']) {
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
    }
    await app.expectEnglishUi()

    // 2: Edit, an empty title, then Save.
    await page.getByTestId('issue-edit').click()
    const titleInput = page.getByTestId('issue-title-input')
    const descriptionInput = page.getByTestId('issue-description-input')
    await expect(titleInput).toHaveValue('Alpha')
    await expect(descriptionInput).toHaveValue('Body')
    await expect(page.getByTestId('issue-cancel-edit')).toBeVisible()
    const save = page.getByTestId('issue-save')
    await expect(save).toBeEnabled()
    await titleInput.fill('')
    await expect(save).toBeDisabled()
    await titleInput.fill(' Beta ')
    await descriptionInput.fill('New body')
    await save.click()
    await expect(page).toHaveAttribute('data-editing', 'false')
    await expect(page.getByTestId('issue-title')).toHaveText('Beta')
    await expect(page.getByTestId('issue-description')).toHaveText('New body')
    await expect(page.getByTestId('issue-state')).toHaveText('Open')
    await expect(page.getByTestId('issue-created')).toHaveAttribute('dateTime', created!)
    await page.getByTestId('back-to-issues').click()
    await expectListed(app, ['Beta', 'Q', 'P'])

    // 3: Edit, then Cancel.
    await issueRow(app, 'Beta').click()
    await page.getByTestId('issue-edit').click()
    await titleInput.fill('Gamma')
    await page.getByTestId('issue-cancel-edit').click()
    await expect(page).toHaveAttribute('data-editing', 'false')
    await expect(page.getByTestId('issue-title')).toHaveText('Beta')
    await app.quit()
    await app.waitForExit()
    app = await launch()
    page = issuePage(app)
    await openIssue(app, G, 'Beta')
    await expect(page.getByTestId('issue-title')).toHaveText('Beta')
    await expect(page.getByTestId('issue-description')).toHaveText('New body')

    // 4: Close Issue.
    await page.getByTestId('back-to-issues').click()
    const counts = async () => [await tabCount(app, 'open'), await tabCount(app, 'closed')]
    expect(await counts()).toEqual([3, 0])
    await issueRow(app, 'Beta').click()
    await page.getByTestId('issue-close').click()
    await expect(page.getByTestId('issue-state')).toHaveText('Closed')
    await expect(page.getByRole('button', { name: 'Reopen Issue' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Close Issue' })).toHaveCount(0)
    for (const name of ['Edit', 'Delete']) {
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
    }
    await expect(page.getByTestId('issue-title')).toHaveText('Beta')
    await expect(page.getByTestId('issue-description')).toHaveText('New body')
    await expect(page.getByTestId('issue-created')).toHaveAttribute('dateTime', created!)
    await page.getByTestId('back-to-issues').click()
    expect(await counts()).toEqual([2, 1])
    await issueTab(app, 'closed').click()
    await expectListed(app, ['Beta'])

    // 5: Reopen Issue.
    await issueRow(app, 'Beta').click()
    await page.getByTestId('issue-reopen').click()
    await expect(page.getByTestId('issue-state')).toHaveText('Open')
    await expect(page.getByRole('button', { name: 'Close Issue' })).toBeVisible()
    await page.getByTestId('back-to-issues').click()
    expect(await counts()).toEqual([3, 0])
    await issueTab(app, 'open').click()
    await expectListed(app, ['Beta', 'Q', 'P'])

    // 6: a closed issue can be edited, and stays closed.
    await issueRow(app, 'Beta').click()
    await setShownIssueState(app, 'closed')
    await page.getByTestId('issue-edit').click()
    await page.getByTestId('issue-title-input').fill('Delta')
    await page.getByTestId('issue-save').click()
    await expect(page.getByTestId('issue-title')).toHaveText('Delta')
    await expect(page.getByTestId('issue-state')).toHaveText('Closed')

    // 7: closed issues, the most recently closed first.
    await openIssue(app, G, 'P')
    await setShownIssueState(app, 'closed')
    await aSecondLater(app)
    await openIssue(app, G, 'Q')
    await setShownIssueState(app, 'closed')
    await page.getByTestId('back-to-issues').click()
    await issueTab(app, 'closed').click()
    await expectListed(app, ['Q', 'P', 'Delta'])
    await aSecondLater(app)
    await issueRow(app, 'P').click()
    await setShownIssueState(app, 'open')
    await setShownIssueState(app, 'closed')
    await page.getByTestId('back-to-issues').click()
    await expectListed(app, ['P', 'Q', 'Delta'])

    // 8: ← Issues.
    await issueRow(app, 'Q').click()
    await expect(page).toBeVisible()
    await page.getByTestId('back-to-issues').click()
    await expectList(app, G)
  })
})

test.describe('deleting an issue (A8)', () => {
  test('asks first, deletes it for good, and shows the list without it', async ({
    launch,
    world,
  }) => {
    const { G } = world.repos
    let app = await launch({
      projects: [G],
      issues: [
        { root: G, title: 'Doomed', closed: true },
        { root: G, title: 'Kept' },
      ],
    })
    const s = await app.startSession(G, 'shell')
    await app.waitForPrompt(20_000, s)
    await clickProjectRow(app, G)
    await expectList(app, G, 'open')
    await issueTab(app, 'closed').click()
    await issueRow(app, 'Doomed').click()
    const doomed = await shownIssueId(app)
    const before = storedIssues(world.userData)

    // 1: asked first; not confirming changes nothing.
    const dialog = app.page.getByTestId('delete-issue-dialog')
    await app.page.getByTestId('issue-delete').click()
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('This cannot be undone.')
    await app.expectEnglishUi()
    await app.page.getByTestId('delete-issue-cancel').click()
    await expect(dialog).toBeHidden()
    await expectShown(app, `issue:${doomed}`)
    expect(storedIssues(world.userData)).toEqual(before)

    // 2: confirmed: the list, still of closed issues, without it.
    await app.page.getByTestId('issue-delete').click()
    await app.page.getByTestId('delete-issue-confirm').click()
    await expectList(app, G, 'closed')
    await expectListed(app, [])
    expect(await tabCount(app, 'closed')).toBe(0)
    await expect(app.forwardButton()).toBeDisabled()
    await app.backButton().click()
    await expectShown(app, `session:${s}`)
    await app.forwardButton().click()
    await expectList(app, G, 'closed')

    // 3: gone for good.
    await app.quit()
    await app.page.getByTestId('quit-confirm').click()
    await app.waitForExit()
    expect(storedIssues(world.userData).map((issue) => issue.title)).toEqual(['Kept'])
    app = await launch()
    await clickProjectRow(app, G)
    await expectListed(app, ['Kept'])
    await issueTab(app, 'closed').click()
    await expectListed(app, [])

    // 4: deleting the issue shown twice since Hoot started leaves only its list.
    await app.quit()
    await app.waitForExit()
    app = await launch()
    await clickProjectRow(app, G)
    await issueRow(app, 'Kept').click()
    await app.page.getByTestId('back-to-issues').click()
    await issueRow(app, 'Kept').click()
    await app.page.getByTestId('issue-delete').click()
    await app.page.getByTestId('delete-issue-confirm').click()
    await expectList(app, G)
    await expectListed(app, [])
    await expect(app.backButton()).toBeDisabled()
    await expect(app.forwardButton()).toBeDisabled()
  })
})

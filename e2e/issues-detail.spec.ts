import type { AppDriver } from './support/app'
import { storedIssues } from './support/database'
import {
  clickIssuesButton,
  expectList,
  expectSaved,
  expectShown,
  issuePage,
  issuesTopRow,
  openIssue,
  openIssueCount,
  openPicker,
  setShownIssueStatus,
  shownIssueId,
  viewTab,
} from './support/issues'
import { boxOf, TOP_ROW_HEIGHT } from './support/layout'
import { expect, test } from './support/test'

/** Takes the keyboard focus off everything, as a click on the page's background does. */
async function blurAll(app: AppDriver): Promise<void> {
  await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
}

test.describe('an issue’s page', () => {
  test('shows the issue as Linear does, and its title is edited where it shows', async ({
    launch,
    world,
  }) => {
    const { G } = world.repos
    let app = await launch({
      projects: [G],
      issues: [
        { root: G, title: 'Alpha', description: 'Body', status: 'todo', priority: 2 },
        { root: G, title: 'Beta' },
      ],
    })
    const alpha = await openIssue(app, G, 'Alpha')
    const page = issuePage(app)
    const title = page.getByTestId('issue-title')

    // 1: the title row, the issue and its properties.
    const row = await boxOf(issuesTopRow(app))
    expect(row.top).toBe(0)
    expect(row.bottom).toBeLessThanOrEqual(TOP_ROW_HEIGHT)
    await expect(issuesTopRow(app).getByTestId('issues-project-name')).toHaveText('G')
    await expect(issuesTopRow(app).getByTestId('issues-breadcrumb-list')).toHaveText('Issues')
    await expect(issuesTopRow(app).getByTestId('issues-breadcrumb-issue')).toHaveText('G-1 Alpha')
    await expect(issuesTopRow(app).getByTestId('issue-menu-button')).toBeVisible()
    await expect(issuesTopRow(app).getByTestId('issue-position')).toHaveText('1 / 2')
    await expect(title).toHaveValue('Alpha')
    await expect(page.getByTestId('issue-status')).toHaveAttribute('data-status', 'todo')
    await expect(page.getByTestId('issue-status')).toHaveText('Todo')
    await expect(page.getByTestId('issue-priority')).toHaveAttribute('data-priority', '2')
    await expect(page.getByTestId('issue-priority')).toHaveText('High')
    await expect(page.getByTestId('issue-description')).toHaveText('Body')
    const created = storedIssues(world.userData).find(({ id }) => id === alpha)!.created_at
    await expect(page.getByTestId('issue-created')).toHaveAttribute(
      'dateTime',
      new Date(created).toISOString(),
    )
    await expect(page.getByTestId('issue-completed')).toHaveCount(0)
    await expect(page.getByTestId('issue-claude-code')).toBeVisible()
    await app.expectEnglishUi()

    // 2: the title is saved as it is typed, without the whitespace around it.
    await title.fill(' Gamma ')
    await expectSaved(app, alpha, { title: 'Gamma' })
    await expect(issuesTopRow(app).getByTestId('issues-breadcrumb-issue')).toHaveText('G-1 Gamma')
    await title.blur()
    await expect(title).toHaveValue('Gamma')

    // 3: a blank title is not saved, and gives way to the saved one.
    await title.fill('   ')
    await title.blur()
    await expect(title).toHaveValue('Gamma')
    await expectSaved(app, alpha, { title: 'Gamma', description: 'Body' })

    // 4: Enter moves on to the description, Esc leaves it, and Esc again goes back to the list.
    await title.focus()
    await title.press('Enter')
    await expect(page.getByTestId('issue-description')).toBeFocused()
    await app.page.keyboard.press('Escape')
    await expect(page.getByTestId('issue-description')).not.toBeFocused()
    await expectShown(app, `issue:${alpha}`)
    await app.page.keyboard.press('Escape')
    await expectList(app, G)
    await app.backButton().click()
    await expectShown(app, `issue:${alpha}`)

    // 5: what was saved is there after Hoot opens again.
    await app.quit()
    await app.waitForExit()
    app = await launch()
    await openIssue(app, G, 'Gamma')
    await expect(issuePage(app).getByTestId('issue-title')).toHaveValue('Gamma')
    await expect(issuePage(app).getByTestId('issue-description')).toHaveText('Body')
  })

  test('its status and priority change from its properties, and with S and P', async ({
    launch,
    world,
  }) => {
    const { G } = world.repos
    const app = await launch({
      projects: [G],
      issues: [{ root: G, title: 'Alpha', status: 'todo' }],
    })
    const alpha = await openIssue(app, G, 'Alpha')
    const page = issuePage(app)
    expect(await openIssueCount(app, G)).toBe(1)

    // Done: completed now, which its activity says, and no longer open.
    await setShownIssueStatus(app, 'done')
    await expect.poll(() => storedIssues(world.userData)[0]?.completed_at).not.toBeNull()
    await expectSaved(app, alpha, { status: 'done' })
    await expect(page.getByTestId('issue-completed')).toContainText('Completed the issue')
    await expect(page.getByTestId('issue-claude-code')).toHaveCount(0)
    await expect.poll(() => openIssueCount(app, G)).toBeNull()

    // S opens the status picker, which searches its values.
    await blurAll(app)
    await app.page.keyboard.press('s')
    await expect(openPicker(app)).toBeVisible()
    await expect(openPicker(app).getByRole('combobox')).toBeFocused()
    await app.page.keyboard.type('prog')
    await expect(openPicker(app).getByRole('option')).toHaveText(['In Progress3'])
    await app.page.keyboard.press('Enter')
    await expect(openPicker(app)).toHaveCount(0)
    await expect(page.getByTestId('issue-status')).toHaveAttribute('data-status', 'in_progress')
    await expectSaved(app, alpha, { status: 'in_progress', completed_at: null })
    await expect(page.getByTestId('issue-completed')).toHaveCount(0)

    // P opens the priority picker, where a digit picks a priority at once.
    await blurAll(app)
    await app.page.keyboard.press('p')
    await expect(openPicker(app)).toBeVisible()
    await app.page.keyboard.press('4')
    await expect(openPicker(app)).toHaveCount(0)
    await expect(page.getByTestId('issue-priority')).toHaveAttribute('data-priority', '4')
    await expectSaved(app, alpha, { priority: 4 })

    // Esc closes a picker without changing anything.
    await blurAll(app)
    await app.page.keyboard.press('p')
    await expect(openPicker(app)).toBeVisible()
    await app.page.keyboard.press('Escape')
    await expect(openPicker(app)).toHaveCount(0)
    await expectShown(app, `issue:${alpha}`)
    await expectSaved(app, alpha, { priority: 4, status: 'in_progress' })
  })

  test('J and K, and the arrows of its title row, show the next and previous issue of its list', async ({
    launch,
    world,
  }) => {
    const { G } = world.repos
    const app = await launch({
      projects: [G],
      issues: [
        { root: G, title: 'A', status: 'todo', priority: 1 },
        { root: G, title: 'B', status: 'todo', priority: 2 },
        { root: G, title: 'C', status: 'backlog' },
        { root: G, title: 'D', status: 'done' },
      ],
    })
    const position = issuesTopRow(app).getByTestId('issue-position')
    const title = issuePage(app).getByTestId('issue-title')
    await openIssue(app, G, 'A')
    await expect(position).toHaveText('1 / 4')
    await expect(issuesTopRow(app).getByTestId('issue-previous')).toBeDisabled()
    await blurAll(app)
    await app.page.keyboard.press('j')
    await expect(title).toHaveValue('B')
    await expect(position).toHaveText('2 / 4')
    await app.page.keyboard.press('j')
    await expect(title).toHaveValue('C')
    await app.page.keyboard.press('k')
    await expect(title).toHaveValue('B')
    await issuesTopRow(app).getByTestId('issue-next').click()
    await expect(title).toHaveValue('C')
    await issuesTopRow(app).getByTestId('issue-next').click()
    await expect(title).toHaveValue('D')
    await expect(position).toHaveText('4 / 4')
    await expect(issuesTopRow(app).getByTestId('issue-next')).toBeDisabled()
    // Each issue shown is a page in the history.
    await app.backButton().click()
    await expect(title).toHaveValue('C')

    // In the list's view; an issue outside it moves through all the issues.
    await clickIssuesButton(app, G)
    await viewTab(app, 'active').click()
    await app.page.getByTestId('issue-row').nth(1).click()
    await expect(title).toHaveValue('B')
    await expect(position).toHaveText('2 / 2')
    await blurAll(app)
    await app.page.keyboard.press('j')
    await expect(title).toHaveValue('B')
    await app.page.keyboard.press('k')
    await expect(title).toHaveValue('A')
    await app.backButton().click()
    await app.backButton().click()
    await app.backButton().click()
    await expect(title).toHaveValue('C')
    await expect(position).toHaveText('3 / 4')
  })

  test('deleting an issue asks first, deletes it for good, and shows its list without it', async ({
    launch,
    world,
  }) => {
    const { G } = world.repos
    let app = await launch({
      projects: [G],
      issues: [
        { root: G, title: 'Doomed', status: 'done' },
        { root: G, title: 'Kept', status: 'todo' },
      ],
    })
    const s = await app.startSession(G, 'shell')
    await app.waitForPrompt(20_000, s)
    const doomed = await openIssue(app, G, 'Doomed')
    const before = storedIssues(world.userData)

    // 1: from its menu, asking first; not confirming changes nothing.
    await issuePage(app).getByTestId('issue-menu-button').click()
    await app.page.getByTestId('issue-menu-delete').click()
    const dialog = app.page.getByTestId('delete-issue-dialog')
    await expect(dialog).toContainText('Doomed')
    await expect(dialog).toContainText('This cannot be undone.')
    await app.page.getByTestId('delete-issue-cancel').click()
    await expect(dialog).toBeHidden()
    await expectShown(app, `issue:${doomed}`)
    expect(storedIssues(world.userData)).toEqual(before)

    // 2: with ⌘⌫, confirmed: its list shows instead, and the issue leaves the history.
    await blurAll(app)
    await app.page.keyboard.press('Meta+Backspace')
    await expect(dialog).toBeVisible()
    await app.page.getByTestId('delete-issue-confirm').click()
    await expectList(app, G, 'all')
    await expect(app.page.getByTestId('issue-row')).toHaveCount(1)
    await expect(app.forwardButton()).toBeDisabled()
    await app.backButton().click()
    await expectShown(app, `session:${s}`)
    await app.forwardButton().click()
    await expectList(app, G)

    // 3: gone for good.
    expect(storedIssues(world.userData).map(({ title }) => title)).toEqual(['Kept'])
    await app.closeSession(s)
    await app.quit()
    await app.waitForExit()
    app = await launch()

    // 4: an issue shown twice leaves nothing to go back or forward to.
    await openIssue(app, G, 'Kept')
    await issuesTopRow(app).getByTestId('issues-breadcrumb-list').click()
    const kept = await openIssue(app, G, 'Kept')
    expect(kept).toBe(await shownIssueId(app))
    await blurAll(app)
    await app.page.keyboard.press('Meta+Backspace')
    await app.page.getByTestId('delete-issue-confirm').click()
    await expectList(app, G)
    await expect(app.backButton()).toBeDisabled()
    await expect(app.forwardButton()).toBeDisabled()
  })
})

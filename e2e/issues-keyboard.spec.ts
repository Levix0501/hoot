import type { AppDriver } from './support/app'
import { storedIssues } from './support/database'
import {
  clickIssuesButton,
  expectList,
  expectShown,
  issuePage,
  issueRow,
  listedGroups,
  newIssueDialog,
  openIssue,
  openPicker,
  openRowMenu,
} from './support/issues'
import { boxOf } from './support/layout'
import { expect, test } from './support/test'

/** The issue whose row has the keyboard focus, by title, or `null`. */
async function focusedRow(app: AppDriver): Promise<string | null> {
  return app.page.evaluate(
    () =>
      document.activeElement
        ?.closest('[data-testid="issue-row"]')
        ?.querySelector('[data-testid="issue-row-title"]')?.textContent ?? null,
  )
}

/** Takes the keyboard focus off everything, as a click on the page's background does. */
async function blurAll(app: AppDriver): Promise<void> {
  await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
}

test.describe('the keys of Issues pages', () => {
  test('on a list, J and K move through the issues, Enter shows one, and S, P, ⌘⌫ and C act on the one moved to', async ({
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
      ],
    })
    await clickIssuesButton(app, G)
    await expectList(app, G)
    await blurAll(app)

    // Moving: J and ↓ down, K and ↑ up, from the first issue on.
    for (const [key, title] of [
      ['j', 'A'],
      ['j', 'B'],
      ['k', 'A'],
      ['ArrowDown', 'B'],
      ['ArrowDown', 'C'],
      ['ArrowDown', 'C'],
      ['ArrowUp', 'B'],
    ] as const) {
      await app.page.keyboard.press(key)
      await expect.poll(() => focusedRow(app), { message: key }).toBe(title)
    }

    // Enter shows the issue, Esc goes back to the list.
    await app.page.keyboard.press('Enter')
    const b = storedIssues(world.userData).find(({ title }) => title === 'B')!.id
    await expectShown(app, `issue:${b}`)
    await blurAll(app)
    await app.page.keyboard.press('Escape')
    await expectList(app, G)

    // S opens the status picker next to the issue; a digit picks a status, and the issue keeps the focus.
    await blurAll(app)
    await app.page.keyboard.press('j')
    await expect.poll(() => focusedRow(app)).toBe('A')
    await app.page.keyboard.press('s')
    await expect(openPicker(app)).toBeVisible()
    const row = await boxOf(issueRow(app, 'A'))
    const picker = await boxOf(openPicker(app))
    expect(picker.top).toBeGreaterThanOrEqual(row.top)
    expect(picker.left).toBeLessThan(row.left + 160)
    await app.page.keyboard.press('3')
    await expect(openPicker(app)).toHaveCount(0)
    await expect.poll(async () => (await listedGroups(app))[0]?.titles).toEqual(['A'])
    await expect.poll(() => focusedRow(app)).toBe('A')

    // P opens the priority picker; Esc closes it without a change.
    await app.page.keyboard.press('p')
    await expect(openPicker(app)).toBeVisible()
    await app.page.keyboard.press('Escape')
    await expect(openPicker(app)).toHaveCount(0)
    expect(storedIssues(world.userData).find(({ title }) => title === 'A')?.priority).toBe(1)

    // ⌘⌫ asks before deleting it.
    await expect.poll(() => focusedRow(app)).toBe('A')
    await app.page.keyboard.press('Meta+Backspace')
    await expect(app.page.getByTestId('delete-issue-dialog')).toContainText('A')
    await app.page.getByTestId('delete-issue-cancel').click()
    await expect(issueRow(app, 'A')).toHaveCount(1)

    // C opens the new issue dialog, whose title gets nothing of it.
    await blurAll(app)
    await app.page.keyboard.press('c')
    await expect(newIssueDialog(app)).toBeVisible()
    await expect(app.page.getByTestId('new-issue-title')).toHaveValue('')
  })

  test('do nothing while typing, in menus and dialogs, and on a session’s page', async ({
    launch,
    world,
  }) => {
    const { G } = world.repos
    const app = await launch({
      projects: [G],
      issues: [{ root: G, title: 'Alpha', status: 'todo' }],
    })

    // Typed into the new issue dialog's title.
    await clickIssuesButton(app, G)
    await expectList(app, G)
    await blurAll(app)
    await app.page.keyboard.press('c')
    const title = app.page.getByTestId('new-issue-title')
    await expect(title).toBeFocused()
    await app.page.keyboard.type('cjksp')
    await expect(title).toHaveValue('cjksp')
    await expect(openPicker(app)).toHaveCount(0)
    await app.page.keyboard.press('Escape')
    await expect(newIssueDialog(app)).toBeHidden()

    // In a row's context menu.
    await openRowMenu(app, 'Alpha')
    await app.page.keyboard.press('c')
    await app.page.waitForTimeout(300)
    await expect(newIssueDialog(app)).toBeHidden()
    await app.page.keyboard.press('Escape')

    // Typed into an issue's description.
    const alpha = await openIssue(app, G, 'Alpha')
    const description = issuePage(app).getByTestId('issue-description')
    await description.click()
    await app.page.keyboard.type('jks')
    await expect(description).toHaveText('jks')
    await expectShown(app, `issue:${alpha}`)
    await expect(openPicker(app)).toHaveCount(0)

    // In a picker's search field.
    await blurAll(app)
    await app.page.keyboard.press('s')
    await expect(openPicker(app)).toBeVisible()
    await app.page.keyboard.type('p')
    await expect(openPicker(app)).toHaveCount(1)
    await expect(openPicker(app).getByRole('combobox')).toHaveValue('p')
    await app.page.keyboard.press('Escape')
    await expect(openPicker(app)).toHaveCount(0)

    // On a session's page, the keys reach its program.
    const s = await app.startSession(G, 'shell')
    await app.waitForPrompt(20_000, s)
    await app.page.keyboard.type('cjk')
    await expect.poll(() => app.cursorLine(s)).toBe(`${world.prompt}cjk`)
    await expect(newIssueDialog(app)).toBeHidden()
  })
})

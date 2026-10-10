import {
  clickProjectRow,
  expectList,
  expectShown,
  issuePage,
  issueRow,
  openIssue,
} from './support/issues'
import { expect, test } from './support/test'

test.describe('what is entered but not saved', () => {
  test('stays while other pages are shown, until it is saved or dropped, the project is removed or Hoot quits', async ({
    launch,
    world,
  }) => {
    const { G, H } = world.repos
    let app = await launch({
      projects: [G, H],
      issues: [
        { root: G, title: 'Alpha' },
        { root: H, title: 'Eta' },
      ],
    })
    const s = await app.startSession(G, 'shell')
    await app.waitForPrompt(20_000, s)
    const title = app.page.getByTestId('new-issue-title')
    const description = app.page.getByTestId('new-issue-description')
    const newIssue = async (root: string) => {
      await clickProjectRow(app, root)
      await expectList(app, root)
      await app.page.getByTestId('new-issue-button').click()
      await expectShown(app, `new:${root}`)
    }

    // 1: a new issue page's draft, after a session was shown.
    await newIssue(G)
    await title.fill('Draft title')
    await description.fill('Draft body')
    await app.selectSession(s)
    await newIssue(G)
    await expect(title).toHaveValue('Draft title')
    await expect(description).toHaveValue('Draft body')

    // 2: also going back to it.
    await app.selectSession(s)
    await app.backButton().click()
    await expectShown(app, `new:${G}`)
    await expect(title).toHaveValue('Draft title')
    await expect(description).toHaveValue('Draft body')

    // 3: an issue's page stays in the edit state, with what was entered.
    const alpha = await openIssue(app, G, 'Alpha')
    const page = issuePage(app)
    await page.getByTestId('issue-edit').click()
    await page.getByTestId('issue-title-input').fill('Alpha edited')
    await clickProjectRow(app, H)
    await expectList(app, H)
    await clickProjectRow(app, G)
    await issueRow(app, 'Alpha').click()
    await expectShown(app, `issue:${alpha}`)
    await expect(page).toHaveAttribute('data-editing', 'true')
    await expect(page.getByTestId('issue-title-input')).toHaveValue('Alpha edited')
    await page.getByTestId('issue-cancel-edit').click()
    await expect(page).toHaveAttribute('data-editing', 'false')
    await expect(page.getByTestId('issue-title')).toHaveText('Alpha')

    // 4: gone once created, cancelled, saved or cancelled.
    await newIssue(G)
    await expect(title).toHaveValue('Draft title')
    await app.page.getByTestId('new-issue-create').click()
    await expect(page.getByTestId('issue-title')).toHaveText('Draft title')
    await newIssue(G)
    await expect(title).toHaveValue('')
    await expect(description).toHaveValue('')
    await title.fill('Dropped')
    await description.fill('Dropped body')
    await app.page.getByTestId('new-issue-cancel').click()
    await newIssue(G)
    await expect(title).toHaveValue('')
    await expect(description).toHaveValue('')
    for (const [shown, entered, end] of [
      ['Alpha', 'Alpha again', 'issue-save'],
      ['Alpha again', 'Not kept', 'issue-cancel-edit'],
    ] as const) {
      await openIssue(app, G, shown)
      await page.getByTestId('issue-edit').click()
      await page.getByTestId('issue-title-input').fill(entered)
      await page.getByTestId(end).click()
      await expect(page).toHaveAttribute('data-editing', 'false')
      await app.selectSession(s)
      await openIssue(app, G, 'Alpha again')
      await expect(page).toHaveAttribute('data-editing', 'false')
      await expect(page.getByTestId('issue-title')).toHaveText('Alpha again')
    }

    // 5: removing a project drops its drafts.
    await newIssue(H)
    await title.fill('H draft')
    const eta = await openIssue(app, H, 'Eta')
    await page.getByTestId('issue-edit').click()
    await page.getByTestId('issue-title-input').fill('Eta edited')
    await app.projectItem(H).getByTestId('project-actions-button').click()
    await app.page.getByTestId('remove-project').click()
    await expect(app.projectItems()).toHaveCount(1)
    await app.addProject(H)
    await expect(app.projectItems()).toHaveCount(2)
    await newIssue(H)
    await expect(title).toHaveValue('')
    await expect(description).toHaveValue('')
    await openIssue(app, H, 'Eta')
    await expectShown(app, `issue:${eta}`)
    await expect(page).toHaveAttribute('data-editing', 'false')
    await expect(page.getByTestId('issue-title')).toHaveText('Eta')

    // 6: quitting drops drafts, without asking about them.
    await app.closeSession(s)
    await newIssue(G)
    await title.fill('Left behind')
    await description.fill('Not saved')
    await app.quit()
    await app.waitForExit()
    app = await launch()
    await newIssue(G)
    await expect(app.page.getByTestId('new-issue-title')).toHaveValue('')
    await expect(app.page.getByTestId('new-issue-description')).toHaveValue('')
  })
})

import type { AppDriver } from './support/app'
import { clickProjectRow, expectList, expectShown, issueRow, shownIssueId } from './support/issues'
import { expect, test, type Launch } from './support/test'
import type { World } from './support/world'

/** Starts Hoot with G and H in the list, G with the issue X and H with the issue Y. */
async function start(launch: Launch, world: World): Promise<AppDriver> {
  const { G, H } = world.repos
  return launch({
    projects: [G, H],
    issues: [
      { root: G, title: 'X' },
      { root: H, title: 'Y' },
    ],
  })
}

/** Shows the page of an issue listed on the project's list, by clicking the project's row and then the issue. */
async function showIssue(app: AppDriver, root: string, title: string): Promise<number> {
  await clickProjectRow(app, root)
  await expectList(app, root)
  await issueRow(app, title).click()
  await expect(app.page.getByTestId('issue-page')).toBeVisible()
  return shownIssueId(app)
}

async function expectNoWayBackOrForward(app: AppDriver): Promise<void> {
  await expect(app.backButton()).toBeDisabled()
  await expect(app.forwardButton()).toBeDisabled()
}

/** Starts a Shell session in a project and waits for its prompt; it is shown then. */
async function startShell(app: AppDriver, root: string): Promise<string> {
  const id = await app.startSession(root, 'shell')
  await app.waitForPrompt(20_000, id)
  await expectShown(app, `session:${id}`)
  return id
}

async function removeProject(app: AppDriver, root: string): Promise<void> {
  const count = await app.projectItems().count()
  await app.projectItem(root).getByTestId('project-actions-button').click()
  await app.page.getByTestId('remove-project').click()
  await expect(app.projectItems()).toHaveCount(count - 1)
}

test.describe('going back and forward among pages', () => {
  test('1–2: through issue lists and an issue, like a browser through pages', async ({
    launch,
    world,
  }) => {
    const { G, H } = world.repos
    const app = await start(launch, world)
    await expectNoWayBackOrForward(app)
    const x = await showIssue(app, G, 'X')
    await clickProjectRow(app, H)
    await expectList(app, H)

    // 1
    await app.backButton().click()
    await expectShown(app, `issue:${x}`)
    await app.backButton().click()
    await expectList(app, G)
    await expect(app.backButton()).toBeDisabled()
    await app.page.keyboard.press('Meta+BracketLeft')
    await app.page.waitForTimeout(300)
    await expectList(app, G)
    await app.forwardButton().click()
    await expectShown(app, `issue:${x}`)
    await app.forwardButton().click()
    await expectList(app, H)
    await expect(app.forwardButton()).toBeDisabled()

    // 2: showing a page another way drops the pages gone back from.
    await app.backButton().click()
    await expectShown(app, `issue:${x}`)
    await app.page.getByTestId('back-to-issues').click()
    await expectList(app, G)
    await expect(app.forwardButton()).toBeDisabled()
    await app.backButton().click()
    await expectShown(app, `issue:${x}`)
  })

  test('3: a session that closes by itself gives way to the page before it', async ({
    launch,
    world,
  }) => {
    const { G } = world.repos
    const app = await start(launch, world)
    const x = await showIssue(app, G, 'X')
    const s = await startShell(app, G)
    await clickProjectRow(app, G)
    await expectList(app, G)
    await app.selectSession(s)
    await app.run('exit 0', { waitForPrompt: false })
    await expect(app.sessionItem(s)).toHaveCount(0)
    await expectList(app, G)
    await expect(app.forwardButton()).toBeDisabled()
    await app.backButton().click()
    await expectShown(app, `issue:${x}`)
  })

  test('4: closing the only session, shown first, leaves the empty page', async ({
    launch,
    world,
  }) => {
    const app = await start(launch, world)
    const s = await startShell(app, world.repos.G)
    await app.closeSession(s)
    await expectShown(app, 'empty')
    await expectNoWayBackOrForward(app)
  })

  test('5: removing a project takes its pages out of the history', async ({ launch, world }) => {
    const { G, H } = world.repos
    const app = await start(launch, world)
    const s = await startShell(app, G)
    await showIssue(app, H, 'Y')
    await removeProject(app, H)
    await expectShown(app, `session:${s}`)
    await expectNoWayBackOrForward(app)

    await app.addProject(H)
    await expect(app.projectItems()).toHaveCount(2)
    await clickProjectRow(app, H)
    await expectList(app, H)
    await clickProjectRow(app, G)
    await expectList(app, G)
    await removeProject(app, H)
    await expectList(app, G)
    await app.backButton().click()
    await expectShown(app, `session:${s}`)
  })

  test('6: removing the project whose list is shown leaves the empty page', async ({
    launch,
    world,
  }) => {
    const { H } = world.repos
    const app = await start(launch, world)
    await clickProjectRow(app, H)
    await expectList(app, H)
    await removeProject(app, H)
    await expectShown(app, 'empty')
    await expectNoWayBackOrForward(app)
  })

  test('7: removing a project closes its ended session, which gives way to the page before it', async ({
    launch,
    world,
  }) => {
    const { G, H } = world.repos
    const app = await start(launch, world)
    await clickProjectRow(app, G)
    await expectList(app, G)
    const sh = await startShell(app, H)
    await app.run('exit 3', { waitForPrompt: false })
    await expect(app.sessionItem(sh)).toHaveAttribute('data-status', 'exited')
    await removeProject(app, H)
    await expect(app.sessionItem(sh)).toHaveCount(0)
    await expectList(app, G)
    await expectNoWayBackOrForward(app)
  })

  test('8: ⌘[ and ⌘] work in a text field, which they type nothing into', async ({
    launch,
    world,
  }) => {
    const { G } = world.repos
    const app = await start(launch, world)
    await clickProjectRow(app, G)
    await app.page.getByTestId('new-issue-button').click()
    await expectShown(app, `new:${G}`)
    const description = app.page.getByTestId('new-issue-description')
    await description.click()
    await app.page.keyboard.type('abc')
    await app.page.keyboard.press('Meta+BracketLeft')
    await expectList(app, G)
    await app.page.keyboard.press('Meta+BracketRight')
    await expectShown(app, `new:${G}`)
    await expect(description).toHaveValue('abc')
    // Also with the keyboard focus in the field.
    await description.focus()
    await app.page.keyboard.press('Meta+BracketLeft')
    await expectList(app, G)
    await app.page.keyboard.press('Meta+BracketRight')
    await expectShown(app, `new:${G}`)
    await expect(description).toHaveValue('abc')
    await expect(app.page.getByTestId('new-issue-title')).toHaveValue('')
  })

  test('9: the Window menu’s Back and Forward', async ({ launch, world }) => {
    const { G } = world.repos
    const app = await start(launch, world)
    const x = await showIssue(app, G, 'X')
    await app.chooseMenuItem('Window', 'Back')
    await expectList(app, G)
    await app.chooseMenuItem('Window', 'Forward')
    await expectShown(app, `issue:${x}`)
  })

  test('10: the history starts over with Hoot', async ({ launch, world }) => {
    const { G } = world.repos
    let app = await start(launch, world)
    await showIssue(app, G, 'X')
    await expect(app.backButton()).toBeEnabled()
    await app.quit()
    await app.waitForExit()
    app = await launch()
    await expectShown(app, 'empty')
    await expectNoWayBackOrForward(app)
  })
})

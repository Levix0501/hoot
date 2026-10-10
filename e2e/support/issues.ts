import { expect, type Locator } from '@playwright/test'
import type { IssueState } from '../../src/shared/issues'
import type { AppDriver } from './app'

/** A project row's own button, which shows the project's issue list. */
export function projectRowButton(app: AppDriver, root: string): Locator {
  return app.projectItem(root).getByTestId('project-item-button')
}

/** The number of open issues a project's row shows, or `null` when it shows none. */
export async function openIssueCount(app: AppDriver, root: string): Promise<number | null> {
  const count = app.projectItem(root).getByTestId('project-open-issues')
  return (await count.count()) === 0 ? null : Number(await count.textContent())
}

/** Clicks the project's name in its row, which shows its issue list. */
export async function clickProjectRow(app: AppDriver, root: string): Promise<void> {
  await app.projectItem(root).getByTestId('project-name').click()
}

export function issueListPage(app: AppDriver): Locator {
  return app.page.getByTestId('issue-list-page')
}

export function newIssuePage(app: AppDriver): Locator {
  return app.page.getByTestId('new-issue-page')
}

export function issuePage(app: AppDriver): Locator {
  return app.page.getByTestId('issue-page')
}

/** The title row of the Issues page shown. */
export function issuesTopRow(app: AppDriver): Locator {
  return app.page.getByTestId('issues-top-row')
}

export function issueTab(app: AppDriver, state: IssueState): Locator {
  return app.page.getByTestId(`issues-tab-${state}`)
}

/** The number an Open or Closed tab of the issue list shows. */
export async function tabCount(app: AppDriver, state: IssueState): Promise<number> {
  return Number(await issueTab(app, state).getByTestId('issues-tab-count').textContent())
}

/** Which tab of the issue list is selected. */
export async function selectedTab(app: AppDriver): Promise<IssueState | null> {
  for (const state of ['open', 'closed'] as const) {
    if ((await issueTab(app, state).getAttribute('aria-selected')) === 'true') return state
  }
  return null
}

/**
 * The titles of the issues the list shows, in order. Only those on screen:
 * the list of the tab selected before stays a moment while it fades out.
 */
export async function listedTitles(app: AppDriver): Promise<string[]> {
  return issueListPage(app)
    .getByTestId('issue-row-title')
    .filter({ visible: true })
    .allTextContents()
}

/** Waits until the list shows these issues, in this order. */
export async function expectListed(app: AppDriver, titles: string[]): Promise<void> {
  await expect.poll(() => listedTitles(app)).toEqual(titles)
}

/** The row of a listed issue, by its title. */
export function issueRow(app: AppDriver, title: string): Locator {
  return issueListPage(app)
    .getByTestId('issue-row')
    .filter({ visible: true })
    .filter({ has: app.page.getByTestId('issue-row-title').getByText(title, { exact: true }) })
}

/**
 * What the main area shows, in short: `session:<id>`, `list:<root>`,
 * `new:<root>`, `issue:<id>`, or `empty`.
 */
export async function shownPage(app: AppDriver): Promise<string> {
  return app.page.evaluate(() => {
    const main = document.querySelector('[data-slot="sidebar-inset"]')
    const find = (testId: string) => main?.querySelector(`[data-testid="${testId}"]`) ?? null
    const project = find('issues-project-name')?.getAttribute('title')
    const session = find('session')
    if (session) return `session:${session.getAttribute('data-session-id')}`
    if (find('issue-list-page')) return `list:${project}`
    if (find('new-issue-page')) return `new:${project}`
    const issue = find('issue-page')
    if (issue) return `issue:${issue.getAttribute('data-issue-id')}`
    if (find('no-session')) return 'empty'
    return 'unknown'
  })
}

/** Waits until the main area shows a page, as `shownPage` says it. */
export async function expectShown(app: AppDriver, page: string): Promise<void> {
  await expect.poll(() => shownPage(app)).toBe(page)
}

/** Waits until the main area shows a project's issue list, with its open or closed issues. */
export async function expectList(app: AppDriver, root: string, state?: IssueState): Promise<void> {
  await expectShown(app, `list:${root}`)
  if (state) await expect.poll(() => selectedTab(app)).toBe(state)
}

/** The id of the issue whose page is shown. */
export async function shownIssueId(app: AppDriver): Promise<number> {
  return Number(await issuePage(app).getAttribute('data-issue-id'))
}

/**
 * Creates an issue the way the tests' scenarios do: on the project's issue
 * list, shown by clicking its row unless it is shown already, "+ New Issue",
 * the title and description, then Create. Returns the new issue's id, once
 * its page is shown.
 */
export async function createIssue(
  app: AppDriver,
  root: string,
  title: string,
  description?: string,
): Promise<number> {
  if ((await shownPage(app)) !== `list:${root}`) await clickProjectRow(app, root)
  await expectList(app, root)
  await app.page.getByTestId('new-issue-button').click()
  await expect(newIssuePage(app)).toBeVisible()
  await app.page.getByTestId('new-issue-title').fill(title)
  if (description !== undefined) {
    await app.page.getByTestId('new-issue-description').fill(description)
  }
  await app.page.getByTestId('new-issue-create').click()
  await expect(issuePage(app).getByTestId('issue-title')).toHaveText(title.trim())
  return shownIssueId(app)
}

/** Shows a listed issue's page from its project's list, by its title. */
export async function openIssue(app: AppDriver, root: string, title: string): Promise<number> {
  if ((await shownPage(app)) !== `list:${root}`) await clickProjectRow(app, root)
  await expectList(app, root)
  for (const state of ['open', 'closed'] as const) {
    if ((await issueRow(app, title).count()) > 0) break
    await issueTab(app, state).click()
  }
  await issueRow(app, title).click()
  await expect(issuePage(app)).toBeVisible()
  return shownIssueId(app)
}

/** Closes or reopens the issue whose page is shown, and waits until its state says so. */
export async function setShownIssueState(app: AppDriver, state: IssueState): Promise<void> {
  await app.page.getByTestId(state === 'closed' ? 'issue-close' : 'issue-reopen').click()
  await expect(issuePage(app).getByTestId('issue-state')).toHaveAttribute('data-state', state)
}

/** Deletes the issue whose page is shown, confirming, and waits until its list is shown. */
export async function deleteShownIssue(app: AppDriver): Promise<void> {
  await app.page.getByTestId('issue-delete').click()
  await expect(app.page.getByTestId('delete-issue-dialog')).toBeVisible()
  await app.page.getByTestId('delete-issue-confirm').click()
  await expect(issueListPage(app)).toBeVisible()
}

/** Goes back with the navigation's Back button. */
export async function goBack(app: AppDriver): Promise<void> {
  await app.backButton().click()
}

/** Goes forward with the navigation's Forward button. */
export async function goForward(app: AppDriver): Promise<void> {
  await app.forwardButton().click()
}

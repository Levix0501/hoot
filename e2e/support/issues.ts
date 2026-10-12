import { expect, type Locator } from '@playwright/test'
import type { IssuePriority, IssueStatus, IssueView } from '../../src/shared/issues'
import { PRIORITY_OPTIONS, STATUS_OPTIONS } from '../../src/renderer/lib/issue-properties'
import type { AppDriver } from './app'
import { storedIssues } from './database'

/** A project row's own button, which expands and collapses the project. */
export function projectRowButton(app: AppDriver, root: string): Locator {
  return app.projectItem(root).getByTestId('project-item-button')
}

/** The Issues button of a project's row, which shows the project's issue list. */
export function issuesButton(app: AppDriver, root: string): Locator {
  return app.projectItem(root).getByTestId('project-issues-button')
}

/** The number of open issues a project's row shows, or `null` when it shows none. */
export async function openIssueCount(app: AppDriver, root: string): Promise<number | null> {
  const count = app.projectItem(root).getByTestId('project-open-issues')
  return (await count.count()) === 0 ? null : Number(await count.textContent())
}

/**
 * Clicks the Issues button of the project's row, which shows its issue list,
 * then moves the pointer off the row, before the row's card shows.
 */
export async function clickIssuesButton(app: AppDriver, root: string): Promise<void> {
  await issuesButton(app, root).click()
  await app.page.mouse.move(1, 1)
}

export function issueListPage(app: AppDriver): Locator {
  return app.page.getByTestId('issue-list-page')
}

export function issuePage(app: AppDriver): Locator {
  return app.page.getByTestId('issue-page')
}

export function newIssueDialog(app: AppDriver): Locator {
  return app.page.getByTestId('new-issue-dialog')
}

/** The title row of the Issues page shown. */
export function issuesTopRow(app: AppDriver): Locator {
  return app.page.getByTestId('issues-top-row')
}

/** The tab of a view of the issue list. */
export function viewTab(app: AppDriver, view: IssueView): Locator {
  return app.page.getByTestId(`issues-view-${view}`)
}

/** Which view the issue list shows. */
export async function selectedView(app: AppDriver): Promise<IssueView | null> {
  for (const view of ['all', 'active', 'backlog'] as const) {
    if ((await viewTab(app, view).getAttribute('aria-selected')) === 'true') return view
  }
  return null
}

/** A status group of the issue list. */
export function issueGroup(app: AppDriver, status: IssueStatus): Locator {
  return issueListPage(app).locator(`[data-testid="issue-group"][data-status="${status}"]`)
}

/** The groups the issue list shows, in order: their statuses, counts, and the titles of their issues. */
export async function listedGroups(
  app: AppDriver,
): Promise<Array<{ status: string; count: number; titles: string[] }>> {
  return issueListPage(app)
    .getByTestId('issue-group')
    .evaluateAll((groups) =>
      groups.map((group) => ({
        status: group.getAttribute('data-status') ?? '',
        count: Number(group.querySelector('[data-testid="issue-group-count"]')?.textContent),
        titles: Array.from(group.querySelectorAll('[data-testid="issue-row-title"]')).map(
          (title) => title.textContent ?? '',
        ),
      })),
    )
}

/** The titles of the issues the list shows, in order. */
export async function listedTitles(app: AppDriver): Promise<string[]> {
  return issueListPage(app).getByTestId('issue-row-title').allTextContents()
}

/** Waits until the list shows these issues, in this order. */
export async function expectListed(app: AppDriver, titles: string[]): Promise<void> {
  await expect.poll(() => listedTitles(app)).toEqual(titles)
}

/** The row of a listed issue, by its title. */
export function issueRow(app: AppDriver, title: string): Locator {
  return issueListPage(app)
    .getByTestId('issue-row')
    .filter({ has: app.page.getByTestId('issue-row-title').getByText(title, { exact: true }) })
}

/**
 * What the main area shows, in short: `session:<id>`, `list:<root>`,
 * `issue:<id>`, or `empty`.
 */
export async function shownPage(app: AppDriver): Promise<string> {
  return app.page.evaluate(() => {
    const main = document.querySelector('[data-slot="sidebar-inset"]')
    const find = (testId: string) => main?.querySelector(`[data-testid="${testId}"]`) ?? null
    const project = find('issues-project-name')?.getAttribute('title')
    const session = find('session')
    if (session) return `session:${session.getAttribute('data-session-id')}`
    if (find('issue-list-page')) return `list:${project}`
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

/** Waits until the main area shows a project's issue list, in one of its views. */
export async function expectList(app: AppDriver, root: string, view?: IssueView): Promise<void> {
  await expectShown(app, `list:${root}`)
  if (view) await expect.poll(() => selectedView(app)).toBe(view)
}

/** The id of the issue whose page is shown. */
export async function shownIssueId(app: AppDriver): Promise<number> {
  return Number(await issuePage(app).getAttribute('data-issue-id'))
}

/** Shows a project's issue list with its row's Issues button, unless it is shown already. */
export async function showList(app: AppDriver, root: string): Promise<void> {
  if ((await shownPage(app)) !== `list:${root}`) await clickIssuesButton(app, root)
  await expectList(app, root)
}

/**
 * Opens a project's new issue dialog from its issue list: with the list's New
 * issue button, or with C.
 */
export async function openNewIssueDialog(
  app: AppDriver,
  root: string,
  via: 'button' | 'key' = 'button',
): Promise<void> {
  await showList(app, root)
  if (via === 'button') await app.page.getByTestId('new-issue-button').click()
  else await app.page.keyboard.press('c')
  await expect(newIssueDialog(app)).toBeVisible()
  await expect(app.page.getByTestId('new-issue-title')).toBeFocused()
}

/** The label a picker or menu gives a status or a priority. */
export function optionLabel(value: IssueStatus | IssuePriority): string {
  const options = [...STATUS_OPTIONS, ...PRIORITY_OPTIONS] as Array<{
    value: IssueStatus | IssuePriority
    label: string
  }>
  return options.find((option) => option.value === value)!.label
}

/** The popup of the picker open now. */
export function openPicker(app: AppDriver): Locator {
  return app.page.locator('[data-slot="combobox-content"]:visible')
}

/** Opens a picker with its button, picks a value by clicking it, and waits until the picker is gone. */
export async function pickWith(
  app: AppDriver,
  trigger: Locator,
  value: IssueStatus | IssuePriority,
): Promise<void> {
  await trigger.click()
  await expect(openPicker(app)).toBeVisible()
  await openPicker(app).locator(`[role="option"][data-value="${value}"]`).click()
  await expect(openPicker(app)).toHaveCount(0)
}

/** Types Markdown into a description's editor in place of what it has, as if pasted. */
export async function fillDescription(editor: Locator, text: string): Promise<void> {
  await editor.fill(text)
}

/**
 * Creates an issue the way the tests' scenarios do: in the project's new
 * issue dialog, opened from its issue list, with Create issue (or ⌘⌥ Enter
 * with `open`). Returns the new issue's id, once the dialog is gone.
 */
export async function createIssue(
  app: AppDriver,
  root: string,
  title: string,
  options: {
    description?: string
    status?: IssueStatus
    priority?: IssuePriority
    open?: boolean
  } = {},
): Promise<number> {
  const before = new Set(storedIssues(app.userData).map((issue) => issue.id))
  await openNewIssueDialog(app, root)
  await app.page.getByTestId('new-issue-title').fill(title)
  if (options.description !== undefined) {
    await fillDescription(app.page.getByTestId('new-issue-description'), options.description)
  }
  if (options.status !== undefined) {
    await pickWith(app, app.page.getByTestId('new-issue-status'), options.status)
  }
  if (options.priority !== undefined) {
    await pickWith(app, app.page.getByTestId('new-issue-priority'), options.priority)
  }
  if (options.open) {
    await app.page.getByTestId('new-issue-title').press('Meta+Alt+Enter')
  } else {
    await app.page.getByTestId('new-issue-create').click()
  }
  await expect(newIssueDialog(app)).toBeHidden()
  let id = 0
  await expect
    .poll(() => {
      id = storedIssues(app.userData).find((issue) => !before.has(issue.id))?.id ?? 0
      return id
    })
    .toBeGreaterThan(0)
  if (options.open) await expectShown(app, `issue:${id}`)
  return id
}

/**
 * Shows a listed issue's page from its project's list, by its title: in the
 * list of all issues, its group expanded.
 */
export async function openIssue(app: AppDriver, root: string, title: string): Promise<number> {
  await showList(app, root)
  if ((await selectedView(app)) !== 'all') await viewTab(app, 'all').click()
  for (const group of await issueListPage(app).getByTestId('issue-group').all()) {
    const toggle = group.getByTestId('issue-group-toggle')
    if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
  }
  await issueRow(app, title).click()
  await expect(issuePage(app)).toBeVisible()
  return shownIssueId(app)
}

/** Changes the status of the issue whose page is shown with its Status button. */
export async function setShownIssueStatus(app: AppDriver, status: IssueStatus): Promise<void> {
  const button = issuePage(app).getByTestId('issue-status')
  await pickWith(app, button, status)
  await expect(button).toHaveAttribute('data-status', status)
}

/** Changes the priority of the issue whose page is shown with its Priority button. */
export async function setShownIssuePriority(
  app: AppDriver,
  priority: IssuePriority,
): Promise<void> {
  const button = issuePage(app).getByTestId('issue-priority')
  await pickWith(app, button, priority)
  await expect(button).toHaveAttribute('data-priority', String(priority))
}

/** Waits until the database has an issue as the given fields say. */
export async function expectSaved(
  app: AppDriver,
  id: number,
  fields: Partial<ReturnType<typeof storedIssues>[number]>,
): Promise<void> {
  await expect
    .poll(() => storedIssues(app.userData).find((issue) => issue.id === id))
    .toMatchObject(fields)
}

/** Types a new title for the issue whose page is shown, leaves the field, and waits until it is saved. */
export async function editShownIssueTitle(app: AppDriver, title: string): Promise<void> {
  const id = await shownIssueId(app)
  const field = issuePage(app).getByTestId('issue-title')
  await field.fill(title)
  await field.blur()
  await expectSaved(app, id, { title: title.trim() })
}

/** Puts a description in place of the shown issue's, leaves the editor, and waits until it is saved. */
export async function setShownIssueDescription(app: AppDriver, text: string): Promise<void> {
  const id = await shownIssueId(app)
  const editor = issuePage(app).getByTestId('issue-description')
  await fillDescription(editor, text)
  await editor.blur()
  await expectSaved(app, id, { description: text })
}

/** Deletes the issue whose page is shown from its menu, confirming, and waits until its list is shown. */
export async function deleteShownIssue(app: AppDriver): Promise<void> {
  await issuePage(app).getByTestId('issue-menu-button').click()
  await app.page.getByTestId('issue-menu-delete').click()
  await expect(app.page.getByTestId('delete-issue-dialog')).toBeVisible()
  await app.page.getByTestId('delete-issue-confirm').click()
  await expect(issueListPage(app)).toBeVisible()
}

/** Opens the context menu of a listed issue's row, once any menu before it has gone. */
export async function openRowMenu(app: AppDriver, title: string): Promise<void> {
  await expect(app.page.locator('[role="menu"]')).toHaveCount(0)
  await issueRow(app, title).click({ button: 'right' })
  await expect(app.page.getByTestId('issue-menu-status')).toBeVisible()
}

/** Goes back with the navigation's Back button. */
export async function goBack(app: AppDriver): Promise<void> {
  await app.backButton().click()
}

/** Goes forward with the navigation's Forward button. */
export async function goForward(app: AppDriver): Promise<void> {
  await app.forwardButton().click()
}

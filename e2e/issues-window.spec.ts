import type { Locator } from '@playwright/test'
import type { AppDriver } from './support/app'
import type { SeedIssue } from './support/database'
import {
  clickProjectRow,
  expectList,
  expectShown,
  issuePage,
  issueRow,
  issuesTopRow,
  newIssueDialog,
  openIssue,
  openNewIssueDialog,
  shownIssueId,
  shownPage,
  viewTab,
} from './support/issues'
import {
  blankPointsOutsideDragArea,
  boxOf,
  dragElementBoxes,
  drawnElements,
  inDragArea,
  navigationBoxes,
  sameCssColor,
  TOP_ROW_HEIGHT,
  type Box,
} from './support/layout'
import { expect, test } from './support/test'

type SidebarState = 'expanded' | 'collapsed'
type IssuesPageName = 'list' | 'issue'

async function setSidebar(app: AppDriver, state: SidebarState): Promise<void> {
  if ((await app.sidebarState()) !== state) await app.page.keyboard.press('Meta+b')
  await app.expectSidebar(state)
}

const center = (box: Box) => ({ x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 })

/** Issues enough to fill more than the smallest window, and one with a long description. */
function manyIssues(root: string): SeedIssue[] {
  return [
    ...Array.from({ length: 14 }, (_, index) => ({
      root,
      title: `Issue ${index + 1}`,
      status: index % 2 === 0 ? ('todo' as const) : ('backlog' as const),
      priority: (index % 5) as SeedIssue['priority'],
    })),
    { root, title: 'Done', status: 'done' },
    {
      root,
      title: 'Alpha',
      status: 'in_progress',
      description: Array.from({ length: 30 }, (_, index) => `Paragraph ${index + 1}.`).join('\n\n'),
    },
  ]
}

/** Keeps the pointer off the buttons, which hovering colors. */
async function movePointerAway(app: AppDriver): Promise<void> {
  const { innerWidth, innerHeight } = await app.page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
  }))
  await app.page.mouse.move(innerWidth - 4, innerHeight - 4)
}

/** Shows one of G's Issues pages from the sidebar: its list, or Alpha's page. */
async function showPage(app: AppDriver, page: IssuesPageName): Promise<void> {
  const { G } = app.world.repos
  if (page === 'list') {
    if ((await shownPage(app)) !== `list:${G}`) await clickProjectRow(app, G)
    await expectList(app, G)
  } else {
    await openIssue(app, G, 'Alpha')
  }
  await movePointerAway(app)
}

/** What the title row of the page shown draws. */
async function titleRowContent(app: AppDriver) {
  const row = await boxOf(issuesTopRow(app))
  return drawnElements(app, row, '[data-testid="issues-top-row"]')
}

/**
 * Checks the title row of the page shown: in the top row; its blank parts,
 * such as the space between the breadcrumb and the buttons at its end, drag
 * the window; its buttons do not.
 */
async function expectTitleRow(app: AppDriver, state: SidebarState): Promise<void> {
  const row = await boxOf(issuesTopRow(app))
  expect(row.top).toBe(0)
  expect(row.bottom).toBeLessThanOrEqual(TOP_ROW_HEIGHT)
  const content = await titleRowContent(app)
  expect(content.length).toBeGreaterThan(0)
  expect(await blankPointsOutsideDragArea(app), state).toEqual([])
  const buttons = issuesTopRow(app).getByRole('button')
  expect(await buttons.count()).toBeGreaterThan(0)
  for (const button of await buttons.all()) {
    const { x, y } = center(await boxOf(button))
    expect(await inDragArea(app, x, y), (await button.getAttribute('aria-label')) ?? '').toBe(false)
  }
  // Nothing below the top row drags the window.
  for (const box of await dragElementBoxes(app)) {
    expect(box.bottom, box.description).toBeLessThanOrEqual(TOP_ROW_HEIGHT)
  }
}

/** Checks that the title row's content is all right of the navigation. */
async function expectClearOfNavigation(app: AppDriver): Promise<void> {
  const { forward } = (await navigationBoxes(app)) as Record<string, Box>
  const content = await titleRowContent(app)
  expect(content.length).toBeGreaterThan(0)
  expect(content.filter((element) => element.box.left < forward!.right)).toEqual([])
}

/**
 * Checks that each button, field, editor, tab, switch and listed issue in
 * `scope` can be reached: scrolled into view, it is what is at the center of
 * the part of it in the window.
 */
async function expectAllReachable(scope: Locator): Promise<void> {
  const controls = scope
    .locator(
      // Not the hidden fields that pickers and switches keep for forms.
      'button, input:not([aria-hidden="true"]), textarea, [role="tab"], [role="switch"], [contenteditable="true"], [data-testid="issue-row"]',
    )
    .filter({ visible: true })
  const count = await controls.count()
  expect(count).toBeGreaterThan(0)
  for (let index = 0; index < count; index++) {
    const control = controls.nth(index)
    await control.scrollIntoViewIfNeeded()
    const hit = await control.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      const top = Math.max(rect.top, 0)
      const bottom = Math.min(rect.bottom, window.innerHeight)
      const found = document.elementFromPoint((rect.left + rect.right) / 2, (top + bottom) / 2)
      return {
        reachable: found !== null && (found === element || element.contains(found)),
        description: `${element.tagName} ${element.getAttribute('data-testid') ?? ''} ${element.textContent?.slice(0, 20) ?? ''}`,
        found: found ? `${found.tagName} ${found.getAttribute('data-testid') ?? ''}` : null,
      }
    })
    expect(hit.reachable, `${hit.description} is covered by ${hit.found}`).toBe(true)
  }
}

for (const [width, height] of [
  [1200, 780],
  [720, 480],
] as const) {
  test(`Issues pages have their title row in the window's top row, clear of the navigation, and all of them can be used (${width}×${height})`, async ({
    launch,
    world,
  }) => {
    const { G } = world.repos
    const app = await launch({ projects: [G], issues: manyIssues(G), deviceScaleFactor: 2 })
    await app.resizeWindow(width, height)
    for (const page of ['list', 'issue'] as const) {
      // Pages are shown from the sidebar, then looked at with it shown and hidden.
      await setSidebar(app, 'expanded')
      await showPage(app, page)
      for (const state of ['expanded', 'collapsed'] as const) {
        await setSidebar(app, state)
        await movePointerAway(app)
        await expectTitleRow(app, state)
        if (state === 'collapsed') await expectClearOfNavigation(app)
        if (width === 720) await expectAllReachable(app.mainArea())

        // In full screen.
        await app.emitWindowEvent('enter-full-screen')
        await expect(app.page.getByTestId('window-navigation')).toHaveAttribute(
          'data-full-screen',
          'true',
        )
        await app.settle()
        await expectClearOfNavigation(app)
        await app.emitWindowEvent('leave-full-screen')
        await expect(app.page.getByTestId('window-navigation')).toHaveAttribute(
          'data-full-screen',
          'false',
        )
        await app.settle()
      }
    }

    // The new issue dialog stays below the top row, and all of it can be used.
    for (const state of ['expanded', 'collapsed'] as const) {
      await setSidebar(app, state)
      await openNewIssueDialog(app, G)
      const dialog = newIssueDialog(app)
      expect((await boxOf(dialog)).top).toBeGreaterThanOrEqual(TOP_ROW_HEIGHT)
      if (width === 720) await expectAllReachable(dialog)
      await app.page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
    }

    // The title row's buttons do what they say.
    await setSidebar(app, 'expanded')
    await showPage(app, 'list')
    await issuesTopRow(app).getByTestId('new-issue-button').click()
    await expect(newIssueDialog(app)).toBeVisible()
    await app.page.keyboard.press('Escape')
    await expect(newIssueDialog(app)).toBeHidden()
    await issueRow(app, 'Alpha').click()
    const alpha = await shownIssueId(app)
    await issuesTopRow(app).getByTestId('issue-next').click()
    await expect.poll(() => shownIssueId(app)).not.toBe(alpha)
    await issuesTopRow(app).getByTestId('issue-previous').click()
    await expectShown(app, `issue:${alpha}`)
    await issuesTopRow(app).getByTestId('issues-breadcrumb-list').click()
    await expectList(app, G)
    await app.expectEnglishUi()
  })
}

test('the properties of an issue are a row under its title on a narrow page, and a column beside it on a wide one', async ({
  launch,
  world,
}) => {
  const { G } = world.repos
  const app = await launch({ projects: [G], issues: manyIssues(G) })
  await showPage(app, 'issue')
  for (const [width, sidebar, beside] of [
    [1200, 'expanded', true],
    [720, 'collapsed', true],
    [720, 'expanded', false],
  ] as const) {
    await app.resizeWindow(width, 480)
    await setSidebar(app, sidebar)
    const box = (testId: string) => boxOf(issuePage(app).getByTestId(testId))
    const title = await box('issue-title')
    const status = await box('issue-status')
    const priority = await box('issue-priority')
    const description = await box('issue-description')
    const where = `${width} ${sidebar}`
    if (beside) {
      expect(status.left, where).toBeGreaterThan(title.right)
      expect(priority.top, where).toBeGreaterThan(status.top)
    } else {
      expect(status.top, where).toBeGreaterThan(title.bottom)
      expect(status.bottom, where).toBeLessThan(description.top)
      expect(priority.top, where).toBe(status.top)
    }
  }
})

test('Issues pages follow the system appearance', async ({ launch, world }) => {
  const { G } = world.repos
  const app = await launch({ projects: [G], issues: manyIssues(G) })
  const textColors: Record<string, { title: string; description: string }> = {}
  for (const appearance of ['light', 'dark'] as const) {
    await app.setSystemAppearance(appearance)
    await expect
      .poll(() => app.page.evaluate(() => document.documentElement.classList.contains('dark')))
      .toBe(appearance === 'dark')
    for (const page of ['list', 'issue'] as const) {
      await showPage(app, page)
      const testId = { list: 'issue-list-page', issue: 'issue-page' }[page]
      const colors = await app.page.getByTestId(testId).evaluate((element) => ({
        page: getComputedStyle(element).backgroundColor,
        background: getComputedStyle(document.documentElement).getPropertyValue('--background'),
      }))
      expect(sameCssColor(colors.page, colors.background), `${appearance} ${page}`).toBe(true)
    }
    textColors[appearance] = {
      title: await issuePage(app)
        .getByTestId('issue-title')
        .evaluate((element) => getComputedStyle(element).color),
      description: await issuePage(app)
        .getByTestId('issue-description')
        .locator('p')
        .first()
        .evaluate((element) => getComputedStyle(element).color),
    }
  }
  expect(sameCssColor(textColors.light!.title, textColors.dark!.title)).toBe(false)
  expect(sameCssColor(textColors.light!.description, textColors.dark!.description)).toBe(false)
})

test.describe('session commands on Issues pages', () => {
  test('⌘W closes nothing, and ⌘1–⌘9 and the next and previous session commands show sessions, also from a text field', async ({
    launch,
    world,
  }) => {
    const { G, H } = world.repos
    const app = await launch({ projects: [G, H] })
    const s1 = await app.startSession(G, 'shell')
    await app.waitForPrompt(20_000, s1)
    const s2 = await app.startSession(H, 'shell')
    await app.waitForPrompt(20_000, s2)
    const title = app.page.getByTestId('new-issue-title')

    /**
     * Shows G's list with the keyboard focus on its Backlog tab, or its new
     * issue dialog with the focus in its title field.
     */
    const situations = {
      list: async () => {
        await clickProjectRow(app, G)
        await expectList(app, G)
        await viewTab(app, 'backlog').focus()
        await expect(viewTab(app, 'backlog')).toBeFocused()
      },
      dialog: async () => {
        const dialog = newIssueDialog(app)
        // Still open after a command that left the page as it was; otherwise gone once it has faded out.
        if ((await dialog.count()) === 0 || (await dialog.getAttribute('data-closed')) !== null) {
          await expect(dialog).toHaveCount(0)
          await openNewIssueDialog(app, G)
        }
        await title.focus()
        await expect(title).toBeFocused()
      },
    }

    for (const prepare of Object.values(situations)) {
      // 1: ⌘W and File > Close Session close nothing.
      for (const command of ['key', 'menu'] as const) {
        await prepare()
        if (command === 'key') await app.page.keyboard.press('Meta+w')
        else await app.chooseMenuItem('File', 'Close Session')
        await app.page.waitForTimeout(300)
        await expect(app.closeSessionDialog()).toBeHidden()
        await expectShown(app, `list:${G}`)
        expect(await app.sessionIds()).toEqual([s1, s2])
        for (const id of [s1, s2]) {
          await expect(app.sessionItem(id)).toHaveAttribute('data-status', 'running')
        }
      }

      // 2: ⌘1 and ⌘2 show the first and second session in the sidebar.
      for (const [keys, id] of [
        ['Meta+1', s1],
        ['Meta+2', s2],
      ] as const) {
        await prepare()
        await app.page.keyboard.press(keys)
        await expectShown(app, `session:${id}`)
        // The new issue dialog goes, and the terminal has the focus.
        await expect(newIssueDialog(app)).toBeHidden()
        await expect
          .poll(() =>
            app.page.evaluate(
              () => document.activeElement?.classList.contains('xterm-helper-textarea') ?? false,
            ),
          )
          .toBe(true)
      }

      // 3: the next and previous session commands show one of the sessions.
      for (const command of [
        'Meta+Shift+BracketRight',
        'Meta+Shift+BracketLeft',
        'Select Next Session',
        'Select Previous Session',
      ]) {
        await prepare()
        if (command.startsWith('Meta')) await app.page.keyboard.press(command)
        else await app.chooseMenuItem('Window', command)
        await expect
          .poll(() => shownPage(app), { message: command })
          .toMatch(new RegExp(`^session:(${s1}|${s2})$`))
      }
    }

    // 4: nothing was typed into the title field.
    for (const keys of [
      'Meta+w',
      'Meta+1',
      'Meta+2',
      'Meta+Shift+BracketRight',
      'Meta+Shift+BracketLeft',
    ]) {
      await situations.dialog()
      await app.page.keyboard.press(keys)
      await situations.dialog()
      await expect(title, keys).toHaveValue('')
    }
    // The shells received nothing either.
    for (const id of [s1, s2]) await expect.poll(() => app.cursorLine(id)).toBe(world.prompt.trim())
  })
})

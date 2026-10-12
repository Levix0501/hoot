import type { AppDriver } from './support/app'
import type { SeedIssue } from './support/database'
import {
  clickProjectRow,
  expectList,
  expectShown,
  issuePage,
  issueRow,
  issueTab,
  issuesTopRow,
  shownPage,
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
type IssuesPageName = 'list' | 'new' | 'issue' | 'editing'

async function setSidebar(app: AppDriver, state: SidebarState): Promise<void> {
  if ((await app.sidebarState()) !== state) await app.page.keyboard.press('Meta+b')
  await app.expectSidebar(state)
}

const center = (box: Box) => ({ x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 })

/** Issues enough to fill more than the smallest window, and one with a long description. */
function manyIssues(root: string): SeedIssue[] {
  return [
    ...Array.from({ length: 14 }, (_, index) => ({ root, title: `Issue ${index + 1}` })),
    { root, title: 'Done', status: 'done' },
    {
      root,
      title: 'Alpha',
      description: Array.from({ length: 30 }, (_, index) => `Paragraph ${index + 1}.`).join('\n\n'),
    },
  ]
}

/** Shows one of G's Issues pages from the sidebar: its list, its new issue page, or Alpha's page. */
async function showPage(app: AppDriver, page: IssuesPageName): Promise<void> {
  const { G } = app.world.repos
  if ((await shownPage(app)) !== `list:${G}`) await clickProjectRow(app, G)
  await expectList(app, G)
  if (page === 'new') {
    await app.page.getByTestId('new-issue-button').click()
    await expectShown(app, `new:${G}`)
  } else if (page === 'issue' || page === 'editing') {
    await issueRow(app, 'Alpha').click()
    const shown = issuePage(app)
    await expect(shown).toBeVisible()
    if (page === 'editing' && (await shown.getAttribute('data-editing')) !== 'true') {
      await shown.getByTestId('issue-edit').click()
    }
    if (page === 'issue' && (await shown.getAttribute('data-editing')) === 'true') {
      await shown.getByTestId('issue-cancel-edit').click()
    }
    await expect(shown).toHaveAttribute('data-editing', String(page === 'editing'))
  }
  // Keep the pointer off the buttons, which hovering colors.
  const { innerWidth, innerHeight } = await app.page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
  }))
  await app.page.mouse.move(innerWidth - 4, innerHeight - 4)
}

/** What the title row of the page shown draws. */
async function titleRowContent(app: AppDriver) {
  const row = await boxOf(issuesTopRow(app))
  return drawnElements(app, row, '[data-testid="issues-top-row"]')
}

/**
 * Checks the title row of the page shown: in the top row; its blank parts,
 * and the point midway between what it shows last and the main area's right
 * edge, drag the window; its buttons do not.
 */
async function expectTitleRow(app: AppDriver, state: SidebarState): Promise<void> {
  const row = await boxOf(issuesTopRow(app))
  expect(row.top).toBe(0)
  expect(row.bottom).toBeLessThanOrEqual(TOP_ROW_HEIGHT)
  const content = await titleRowContent(app)
  expect(content.length).toBeGreaterThan(0)
  const main = await boxOf(app.mainArea())
  const last = Math.max(...content.map((element) => element.box.right))
  expect(await inDragArea(app, (last + main.right) / 2, 22)).toBe(true)
  expect(await blankPointsOutsideDragArea(app), state).toEqual([])
  for (const testId of ['back-to-issues', 'new-issue-button']) {
    const button = issuesTopRow(app).getByTestId(testId)
    if ((await button.count()) === 0) continue
    const { x, y } = center(await boxOf(button))
    expect(await inDragArea(app, x, y), testId).toBe(false)
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
 * Checks that each button, field, tab and listed issue of the page shown can
 * be reached: scrolled into view, it is what is at its center.
 */
async function expectAllReachable(app: AppDriver): Promise<void> {
  const controls = app
    .mainArea()
    .locator('button, input, textarea, [role="tab"], [data-testid="issue-row"]')
  const count = await controls.count()
  expect(count).toBeGreaterThan(0)
  for (let index = 0; index < count; index++) {
    const control = controls.nth(index)
    await control.scrollIntoViewIfNeeded()
    const hit = await control.evaluate((element) => {
      const { left, top, right, bottom } = element.getBoundingClientRect()
      const found = document.elementFromPoint((left + right) / 2, (top + bottom) / 2)
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
    for (const page of ['list', 'new', 'issue', 'editing'] as const) {
      // Pages are shown from the sidebar, then looked at with it shown and hidden.
      await setSidebar(app, 'expanded')
      await showPage(app, page)
      for (const state of ['expanded', 'collapsed'] as const) {
        await setSidebar(app, state)
        await expectTitleRow(app, state)
        if (state === 'collapsed') await expectClearOfNavigation(app)
        if (width === 720) await expectAllReachable(app)

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

    // The title row's buttons do what they say.
    await setSidebar(app, 'expanded')
    await showPage(app, 'list')
    await issuesTopRow(app).getByTestId('new-issue-button').click()
    await expectShown(app, `new:${G}`)
    await issuesTopRow(app).getByTestId('back-to-issues').click()
    await expectList(app, G)
    await issueRow(app, 'Alpha').click()
    await issuesTopRow(app).getByTestId('back-to-issues').click()
    await expectList(app, G)
    await app.expectEnglishUi()
  })
}

test('Issues pages follow the system appearance', async ({ launch, world }) => {
  const { G } = world.repos
  const app = await launch({ projects: [G], issues: manyIssues(G) })
  const textColors: Record<string, { title: string; description: string }> = {}
  for (const appearance of ['light', 'dark'] as const) {
    await app.setSystemAppearance(appearance)
    await expect
      .poll(() => app.page.evaluate(() => document.documentElement.classList.contains('dark')))
      .toBe(appearance === 'dark')
    for (const page of ['list', 'new', 'issue'] as const) {
      await showPage(app, page)
      const testId = { list: 'issue-list-page', new: 'new-issue-page', issue: 'issue-page' }[page]
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

    /** Shows G's list with the keyboard focus on its Closed tab, or its new issue page with the focus in its title field. */
    const situations = {
      list: async () => {
        await clickProjectRow(app, G)
        await expectList(app, G)
        await issueTab(app, 'closed').focus()
        await expect(issueTab(app, 'closed')).toBeFocused()
      },
      new: async () => {
        await clickProjectRow(app, G)
        await expectList(app, G)
        await app.page.getByTestId('new-issue-button').click()
        await expectShown(app, `new:${G}`)
        await title.focus()
        await expect(title).toBeFocused()
      },
    }

    for (const [name, prepare] of Object.entries(situations)) {
      const page = name === 'list' ? `list:${G}` : `new:${G}`

      // 1: ⌘W and File > Close Session close nothing.
      for (const command of ['key', 'menu'] as const) {
        await prepare()
        if (command === 'key') await app.page.keyboard.press('Meta+w')
        else await app.chooseMenuItem('File', 'Close Session')
        await app.page.waitForTimeout(300)
        await expect(app.closeSessionDialog()).toBeHidden()
        await expectShown(app, page)
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
    await situations.new()
    await expect(title).toHaveValue('')
    for (const keys of [
      'Meta+w',
      'Meta+1',
      'Meta+2',
      'Meta+Shift+BracketRight',
      'Meta+Shift+BracketLeft',
    ]) {
      await situations.new()
      await app.page.keyboard.press(keys)
      await situations.new()
      await expect(title, keys).toHaveValue('')
    }
    // The shells received nothing either.
    for (const id of [s1, s2]) await expect.poll(() => app.cursorLine(id)).toBe(world.prompt.trim())
  })
})

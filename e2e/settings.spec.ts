import path from 'node:path'
import type { AppDriver } from './support/app'
import { clickIssuesButton, createIssue, expectList, expectShown } from './support/issues'
import {
  blankPointsOutsideDragArea,
  boxOf,
  dragElementBoxes,
  inDragArea,
  TOP_ROW_HEIGHT,
  type Box,
} from './support/layout'
import {
  appearancePage,
  backToApp,
  expectAppShown,
  expectSettingsShown,
  pressSettingsShortcut,
  projectSidebar,
  settingsEntry,
  settingsNavigation,
} from './support/settings'
import { expect, test } from './support/test'

const SIDEBAR_WIDTH = 288
/** The right edge of the traffic lights' zoom button, with the traffic lights at x 15, y 15. */
const TRAFFIC_LIGHTS_RIGHT = 75

/**
 * The sidebar's last row, Re-detect Tools, as measured in Hoot before it had
 * settings, in a 1200 × 780 window with the sidebar expanded: its place from
 * the sidebar's left and bottom edges, its size, its text and its icon.
 */
const REDETECT_TOOLS_ROW = {
  left: 8,
  bottom: 8,
  width: 271,
  height: 32,
  fontSize: '14px',
  lineHeight: '20px',
  padding: ['8px', '8px', '8px', '8px'],
  icon: { left: 8, top: 8, width: 16, height: 16 },
  textLeft: 32,
  textFontSize: '14px',
}
/** Its background while the pointer was on it, in either appearance. */
const REDETECT_TOOLS_HOVER = { light: 'oklch(0.97 0 0)', dark: 'oklch(0.269 0 0)' }

/** Starts a Shell session in project G, which is in the list, and waits for its prompt. */
async function startShell(app: AppDriver): Promise<string> {
  const id = await app.startSession(app.world.repos.G, 'shell')
  await app.waitForPrompt(20_000, id)
  return id
}

/** Waits until the window shows a session, with the keyboard focus in its terminal. */
async function expectSessionFocused(app: AppDriver, id: string): Promise<void> {
  await expectAppShown(app)
  await expect(app.session()).toHaveAttribute('data-session-id', id)
  await expect
    .poll(() =>
      app.page.evaluate(
        () =>
          document.activeElement
            ?.closest('[data-testid="session"]')
            ?.getAttribute('data-session-id') ?? null,
      ),
    )
    .toBe(id)
  expect(
    await app.page.evaluate(() =>
      document.activeElement?.classList.contains('xterm-helper-textarea'),
    ),
  ).toBe(true)
}

/** Where the settings row is in the sidebar, how big it is, and what it shows. */
async function settingsRow(app: AppDriver) {
  return settingsEntry(app).evaluate((row) => {
    const container = document
      .querySelector('[data-slot="sidebar-container"]')!
      .getBoundingClientRect()
    const box = row.getBoundingClientRect()
    const style = getComputedStyle(row)
    const icon = row.querySelector('svg')!
    const iconBox = icon.getBoundingClientRect()
    const text = row.querySelector('span')!
    return {
      layout: {
        left: box.left - container.left,
        bottom: container.bottom - box.bottom,
        width: box.width,
        height: box.height,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
        icon: {
          left: iconBox.left - box.left,
          top: iconBox.top - box.top,
          width: iconBox.width,
          height: iconBox.height,
        },
        textLeft: text.getBoundingClientRect().left - box.left,
        textFontSize: getComputedStyle(text).fontSize,
      },
      iconClass: icon.getAttribute('class'),
      text: row.textContent,
    }
  })
}

const center = (box: Box) => ({ x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 })

test('the sidebar ends with Settings, where Re-detect Tools was, which shows the settings', async ({
  launch,
  world,
}) => {
  const app = await launch({ projects: [world.repos.G], systemAppearance: 'light' })
  await app.resizeWindow(1200, 780)
  await app.expectSidebar('expanded')

  // 1: a gear and "Settings"; no row of the sidebar re-detects tools.
  const row = await settingsRow(app)
  expect(row.text).toBe('Settings')
  expect(row.iconClass).toContain('lucide-settings')
  await expect(projectSidebar(app).getByText(/Re-detect Tools|Detecting tools…/)).toHaveCount(0)

  // 2: in the place, at the size and with the look of the row it replaces.
  expect(row.layout).toEqual(REDETECT_TOOLS_ROW)
  for (const appearance of ['light', 'dark'] as const) {
    await app.setSystemAppearance(appearance)
    await expect(app.page.locator('html')).toHaveClass(appearance)
    const box = center(await boxOf(settingsEntry(app)))
    await app.page.mouse.move(box.x, box.y)
    await expect
      .poll(() => settingsEntry(app).evaluate((entry) => getComputedStyle(entry).backgroundColor))
      .toBe(REDETECT_TOOLS_HOVER[appearance])
    await app.page.mouse.move(800, 700)
  }

  // 3: clicking it shows the settings.
  await settingsEntry(app).click()
  await expectSettingsShown(app)
  await app.expectEnglishUi()
})

test('Settings… in the Hoot menu and ⌘, show the settings, also from a terminal', async ({
  launch,
  world,
}) => {
  const app = await launch({ projects: [world.repos.G] })

  // 1: the Hoot menu, with Settings… after About Hoot.
  const hootMenu = (await app.applicationMenu()).find((item) => item.label === 'Hoot')
  expect(
    (hootMenu?.submenu ?? []).map((item) => [item.label, item.type, item.accelerator]),
  ).toEqual([
    ['About Hoot', 'normal', null],
    ['', 'separator', null],
    ['Settings…', 'normal', 'CmdOrCtrl+,'],
    ['', 'separator', null],
    ['Services', 'normal', null],
    ['', 'separator', null],
    ['Hide Hoot', 'normal', 'Command+H'],
    ['Hide Others', 'normal', 'Command+Alt+H'],
    ['Show All', 'normal', null],
    ['', 'separator', null],
    ['Quit Hoot', 'normal', 'CommandOrControl+Q'],
  ])

  // 2: Settings… while S1 is shown.
  const s1 = await startShell(app)
  // `cat -v` shows every byte the terminal sends it.
  await app.run('cat -v', { waitForPrompt: false })
  await expect.poll(() => app.cursorLine()).toBe('')
  await app.chooseMenuItem('Hoot', 'Settings…')
  await expectSettingsShown(app)
  await backToApp(app).click()
  await expectSessionFocused(app, s1)

  // 3: ⌘, with the keyboard focus in S1's terminal, whose program receives nothing.
  await pressSettingsShortcut(app)
  await backToApp(app).click()
  await expectSessionFocused(app, s1)
  expect((await app.outputOf('cat -v', s1)).join('')).toBe('')
})

test('the settings take the place of the sidebar and the main area, below Back and Forward', async ({
  launch,
  world,
}) => {
  const app = await launch({ projects: [world.repos.G], deviceScaleFactor: 2 })
  await app.resizeWindow(1200, 780)
  const s1 = await startShell(app)
  await startShell(app)
  await app.selectSession(s1)
  await app.page.mouse.move(600, 760)
  // Where Back and Forward are beside the sidebar, also in full screen.
  const navigation = async () => ({
    back: await boxOf(app.backButton()),
    forward: await boxOf(app.forwardButton()),
  })
  const windowed = await navigation()
  await app.emitWindowEvent('enter-full-screen')
  await expect(app.page.getByTestId('window-navigation')).toHaveAttribute(
    'data-full-screen',
    'true',
  )
  await app.settle()
  const fullScreen = await navigation()
  await app.emitWindowEvent('leave-full-screen')
  await expect(app.page.getByTestId('window-navigation')).toHaveAttribute(
    'data-full-screen',
    'false',
  )
  await app.settle()
  expect(await navigation()).toEqual(windowed)

  await pressSettingsShortcut(app)
  await app.page.mouse.move(600, 760)

  // 1: no sidebar and no main area; the list of the settings as wide as the sidebar, then the page.
  await expect(app.page.locator('[data-slot="sidebar-container"]')).toHaveCount(0)
  const list = await boxOf(settingsNavigation(app))
  expect(list).toEqual({ left: 0, top: 0, right: SIDEBAR_WIDTH, bottom: 780 })
  expect(await boxOf(appearancePage(app))).toEqual({
    left: SIDEBAR_WIDTH,
    top: 0,
    right: 1200,
    bottom: 780,
  })

  // 2: below the top row, only "Back to app", after an arrow pointing left, and "Appearance".
  const shown = await settingsNavigation(app).evaluate((element, rowHeight) => {
    const texts: string[] = []
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement!
      const text = node.textContent?.trim()
      if (text && parent.checkVisibility() && parent.getBoundingClientRect().top >= rowHeight) {
        texts.push(text)
      }
    }
    return texts
  }, TOP_ROW_HEIGHT)
  expect(shown).toEqual(['Back to app', 'Appearance'])
  const arrow = backToApp(app).locator('svg')
  expect(await arrow.getAttribute('class')).toContain('lucide-arrow-left')
  expect((await boxOf(arrow)).right).toBeLessThanOrEqual(
    (await boxOf(backToApp(app).getByText('Back to app'))).left,
  )
  await expect(settingsNavigation(app).locator('[data-slot="sidebar-group-label"]')).toHaveCount(0)
  await expect(settingsNavigation(app).locator('input, [role="searchbox"]')).toHaveCount(0)

  // 3: right of the traffic lights only Back and Forward, where they are beside the sidebar.
  await expect(app.toggleSidebarButton()).toHaveCount(0)
  const buttons = await app.page.evaluate(
    ([rowHeight, from]) =>
      Array.from(document.querySelectorAll('button'))
        .filter((button) => {
          const box = button.getBoundingClientRect()
          return button.checkVisibility() && box.top < rowHeight && box.left >= from
        })
        .map((button) => button.getAttribute('data-testid')),
    [TOP_ROW_HEIGHT, TRAFFIC_LIGHTS_RIGHT] as const,
  )
  expect(buttons).toEqual(['go-back', 'go-forward'])
  expect(await navigation()).toEqual(windowed)

  // 4: pointing at them shows their names and shortcuts.
  const tooltip = app.page.locator('[data-slot="tooltip-content"]')
  for (const [button, name, shortcut] of [
    [app.backButton(), 'Back', '⌘['],
    [app.forwardButton(), 'Forward', '⌘]'],
  ] as const) {
    const { x, y } = center(await boxOf(button))
    await app.page.mouse.move(x, y)
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toContainText(name)
    await expect(tooltip).toContainText(shortcut)
    await app.page.mouse.move(600, 760)
    await expect(tooltip).toHaveCount(0)
  }

  // 5: the top row's blank parts drag the window, Back and Forward do not, nor does anything below.
  for (const point of [
    { x: 5, y: 22 },
    // Where the sidebar's trigger is beside the sidebar.
    { x: 98, y: 22 },
    { x: (windowed.forward.right + SIDEBAR_WIDTH) / 2, y: 22 },
    { x: 700, y: 22 },
    { x: 1190, y: 5 },
  ]) {
    expect(await inDragArea(app, point.x, point.y), `${point.x},${point.y}`).toBe(true)
  }
  expect(await blankPointsOutsideDragArea(app)).toEqual([])
  for (const box of Object.values(windowed)) {
    const { x, y } = center(box)
    expect(await inDragArea(app, x, y)).toBe(false)
  }
  for (const box of await dragElementBoxes(app)) {
    expect(box.bottom, box.description).toBeLessThanOrEqual(TOP_ROW_HEIGHT)
  }

  // 6: in full screen, where they are beside the sidebar in full screen.
  await app.emitWindowEvent('enter-full-screen')
  await expect(app.page.getByTestId('window-navigation')).toHaveAttribute(
    'data-full-screen',
    'true',
  )
  await app.settle()
  expect(await navigation()).toEqual(fullScreen)
  await app.emitWindowEvent('leave-full-screen')
  await expect(app.page.getByTestId('window-navigation')).toHaveAttribute(
    'data-full-screen',
    'false',
  )
  await app.settle()
  expect(await navigation()).toEqual(windowed)

  // 7: the sidebar comes back as it was, collapsed or expanded.
  await backToApp(app).click()
  await expectAppShown(app)
  await app.page.keyboard.press('Meta+b')
  await app.expectSidebar('collapsed')
  await pressSettingsShortcut(app)
  expect(await boxOf(settingsNavigation(app))).toEqual(list)
  await backToApp(app).click()
  await app.expectSidebar('collapsed')
  await app.page.keyboard.press('Meta+b')
  await app.expectSidebar('expanded')
  await pressSettingsShortcut(app)
  await backToApp(app).click()
  await app.expectSidebar('expanded')
  await app.expectEnglishUi()
})

test('the sidebar comes back from the settings scrolled as it was', async ({ launch, world }) => {
  const app = await launch({ projects: [world.repos.G] })
  // Sessions enough for the list to scroll in the smallest window.
  await app.resizeWindow(720, 480)
  for (let started = 0; started < 12; started++) {
    await app.startSession(world.repos.G, 'shell', { waitFor: 'started' })
  }
  const list = projectSidebar(app).locator('[data-slot="sidebar-content"]')
  const scrolled = await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight
    return element.scrollTop
  })
  expect(scrolled).toBeGreaterThan(0)
  for (const leave of [
    () => app.backButton().click(),
    () => backToApp(app).click(),
    () => app.page.keyboard.press('Escape'),
  ]) {
    await pressSettingsShortcut(app)
    await leave()
    await expectAppShown(app)
    expect(await list.evaluate((element) => element.scrollTop)).toBe(scrolled)
  }
})

test('the settings are a page among the pages shown; session keys and commands work from them', async ({
  launch,
  world,
}) => {
  const { G, H } = world.repos
  const app = await launch({ projects: [G] })
  const s1 = await startShell(app)
  const s2 = await startShell(app)
  expect(await app.sessionIds()).toEqual([s1, s2])
  await app.selectSession(s1)
  const back = app.backButton()
  const forward = app.forwardButton()

  // 1: the Settings row shows them, with a way back and none forward.
  await settingsEntry(app).click()
  await expectSettingsShown(app)
  await expect(back).toBeEnabled()
  await expect(forward).toBeDisabled()

  // 2: Back shows S1, with the keyboard focus in its terminal; Forward the settings again.
  await back.click()
  await expectSessionFocused(app, s1)
  await forward.click()
  await expectSettingsShown(app)

  // 3: Esc and Back to app go back as well, ⌘] forward.
  await app.page.keyboard.press('Escape')
  await expectSessionFocused(app, s1)
  await app.page.keyboard.press('Meta+BracketRight')
  await expectSettingsShown(app)
  await backToApp(app).click()
  await expectSessionFocused(app, s1)
  // Also with the pointer on Back, whose tooltip shows: Esc goes back, not only closes the tooltip.
  await app.page.keyboard.press('Meta+BracketRight')
  await expectSettingsShown(app)
  const { x, y } = center(await boxOf(back))
  await app.page.mouse.move(x, y)
  await expect(app.page.locator('[data-slot="tooltip-content"][data-open]')).toContainText('Back')
  await app.page.keyboard.press('Escape')
  await expectSessionFocused(app, s1)
  await app.page.mouse.move(600, 760)

  // 4: showing them again while they are shown records nothing.
  await pressSettingsShortcut(app)
  await app.page.keyboard.press('Meta+Comma')
  await app.chooseMenuItem('Hoot', 'Settings…')
  await app.page.waitForTimeout(300)
  await expectSettingsShown(app)
  await app.chooseMenuItem('Window', 'Back')
  await expectSessionFocused(app, s1)

  // 5: ⌘2 shows S2, recorded after the settings.
  await pressSettingsShortcut(app)
  await app.page.keyboard.press('Meta+2')
  await expectSessionFocused(app, s2)
  await expect(forward).toBeDisabled()
  await back.click()
  await expectSettingsShown(app)
  await back.click()
  await expectSessionFocused(app, s1)

  // 6: ⌘⇧] and ⌘⇧[, and their menu items, show the first and the last session.
  for (const [next, previous] of [
    [
      () => app.page.keyboard.press('Meta+Shift+BracketRight'),
      () => app.page.keyboard.press('Meta+Shift+BracketLeft'),
    ],
    [
      () => app.chooseMenuItem('Window', 'Select Next Session'),
      () => app.chooseMenuItem('Window', 'Select Previous Session'),
    ],
  ]) {
    await pressSettingsShortcut(app)
    await next()
    await expectSessionFocused(app, s1)
    await back.click()
    await expectSettingsShown(app)
    await previous()
    await expectSessionFocused(app, s2)
    await back.click()
    await expectSettingsShown(app)
  }

  // 7: ⌘W, Close Session, ⌘B and Hide Sidebar change nothing, and the sessions go on.
  await app.page.keyboard.press('Meta+w')
  await app.chooseMenuItem('File', 'Close Session')
  await app.page.keyboard.press('Meta+b')
  await app.chooseMenuItem('View', 'Hide Sidebar')
  await app.page.waitForTimeout(500)
  await expectSettingsShown(app)
  await expect(app.closeSessionDialog()).toHaveCount(0)
  await backToApp(app).click()
  await expectAppShown(app)
  await app.expectSidebar('expanded')
  expect(await app.sessionIds()).toEqual([s1, s2])
  for (const id of [s1, s2])
    await expect(app.sessionItem(id)).toHaveAttribute('data-status', 'running')

  // 8: Add Project… adds a project, says so as anywhere else, and leaves the settings shown.
  await pressSettingsShortcut(app)
  await app.chooseDirectoryNext(H)
  await app.chooseMenuItem('File', 'Add Project…')
  const added = app.toasts('Project added.')
  await expect(added).toBeVisible()
  await expect(added).toContainText(H)
  await expect
    .poll(async () => {
      const box = await boxOf(added)
      return [Math.round(box.top), Math.round(box.right)]
    })
    .toEqual([60, 1200 - 16])
  await expectSettingsShown(app)
  await backToApp(app).click()
  await expect(app.projectItem(H)).toBeVisible()

  // 9: ⌘Q asks whether to quit over the settings; Esc answers, and the settings stay.
  await pressSettingsShortcut(app)
  await app.quit()
  await expect(app.page.getByTestId('quit-dialog')).toBeVisible()
  await app.page.keyboard.press('Escape')
  await expect(app.page.getByTestId('quit-dialog')).toHaveCount(0)
  await app.page.waitForTimeout(300)
  await expectSettingsShown(app)
  expect(app.exited).toBe(false)
  for (const id of [s1, s2]) {
    await expect
      .poll(() =>
        app.page.evaluate(async (sessionId) => {
          const sessions = await window.hoot.listSessions()
          return sessions.find((session) => session.id === sessionId)?.status
        }, id),
      )
      .toBe('running')
  }
})

test('pages gone from before the settings leave them in place', async ({ launch, world }) => {
  const { G, H } = world.repos
  const app = await launch({ projects: [G] })
  const s1 = await startShell(app)
  await app.selectSession(s1)

  // 10: H's issue list, the settings, back to the list, then H leaves the list.
  await app.addProject(H)
  await expect(app.projectItems()).toHaveCount(2)
  await clickIssuesButton(app, H)
  await expectList(app, H)
  await pressSettingsShortcut(app)
  await app.backButton().click()
  await expectList(app, H)
  await app.projectItem(H).getByTestId('project-actions-button').click()
  await app.page.getByTestId('remove-project').click()
  await expect(app.projectItems()).toHaveCount(1)
  await expectSessionFocused(app, s1)
  await app.forwardButton().click()
  await expectSettingsShown(app)
})

test('the Esc that leaves the settings for an issue’s page stays with the settings', async ({
  launch,
  world,
}) => {
  const app = await launch({ projects: [world.repos.G] })
  const issue = await createIssue(app, world.repos.G, 'Alpha', { open: true })
  await pressSettingsShortcut(app)
  await app.page.keyboard.press('Escape')
  await expectAppShown(app)
  // Esc on an issue's page shows its list, but not with this key press.
  await app.page.waitForTimeout(300)
  await expectShown(app, `issue:${issue}`)
})

test('with nothing before them, the settings give way to the empty page and leave the history', async ({
  launch,
  world,
}) => {
  // 11: S3 ends while the settings are shown, and was the only page before them.
  let app = await launch({ userData: path.join(world.root, 'U1') })
  await app.addProject(world.repos.G)
  await expect(app.projectItems()).toHaveCount(1)
  const s3 = await startShell(app)
  await app.run('sleep 3; exit', { waitForPrompt: false })
  await pressSettingsShortcut(app)
  await expect
    .poll(() => app.page.evaluate(async () => (await window.hoot.listSessions()).length), {
      timeout: 15_000,
    })
    .toBe(0)
  await app.page.waitForTimeout(300)
  await expectSettingsShown(app)
  await expect(app.backButton()).toBeDisabled()
  await backToApp(app).click()
  await expectAppShown(app)
  await expect(app.page.getByTestId('no-session')).toBeVisible()
  await expect(app.sessionItem(s3)).toHaveCount(0)
  await expect(app.forwardButton()).toBeDisabled()
  await app.close()

  // 12: the settings shown first.
  app = await launch({ userData: path.join(world.root, 'U2') })
  await expect(app.page.getByTestId('no-session')).toBeVisible()
  await expect(app.backButton()).toBeDisabled()
  await expect(app.forwardButton()).toBeDisabled()
  await pressSettingsShortcut(app)
  await expect(app.backButton()).toBeDisabled()
  await app.page.keyboard.press('Meta+BracketLeft')
  await app.chooseMenuItem('Window', 'Back')
  await app.page.waitForTimeout(300)
  await expectSettingsShown(app)
  await app.page.keyboard.press('Escape')
  await expectAppShown(app)
  await expect(app.page.getByTestId('no-session')).toBeVisible()
  await expect(app.forwardButton()).toBeDisabled()
  await app.page.keyboard.press('Meta+BracketRight')
  await app.page.waitForTimeout(300)
  await expect(app.page.getByTestId('no-session')).toBeVisible()
  await expect(settingsNavigation(app)).toHaveCount(0)
})

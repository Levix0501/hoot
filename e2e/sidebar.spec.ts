import fs from 'node:fs'
import path from 'node:path'
import type { AppDriver } from './support/app'
import { boxOf } from './support/layout'
import { expect, test } from './support/test'

const SIDEBAR_WIDTH = 288

/** Starts a Shell session in project G, which is in the list, and waits for its prompt. */
async function startShell(app: AppDriver): Promise<string> {
  const id = await app.startSession(app.world.repos.G, 'shell')
  await app.waitForPrompt(20_000, id)
  return id
}

/** Runs `cat -v` in the current session, which shows every byte its terminal sends it. */
async function runCat(app: AppDriver): Promise<void> {
  await app.run('cat -v', { waitForPrompt: false })
  await expect.poll(() => app.cursorLine()).toBe('')
}

/** What `cat -v` has echoed and printed so far, line by line, without empty lines. */
async function catOutput(app: AppDriver): Promise<string[]> {
  return (await app.outputOf('cat -v')).filter((line) => line !== '')
}

/** The sidebar's container, which slides, and the main area beside it. */
async function sidebarLayout(app: AppDriver) {
  const container = await boxOf(app.page.locator('[data-slot="sidebar-container"]'))
  const main = await boxOf(app.mainArea())
  return { container, main, mainWidth: main.right - main.left }
}

/** Checks the sidebar is out of the window (or hidden) and the main area takes the window's width. */
async function expectCollapsed(app: AppDriver, width: number): Promise<void> {
  await app.expectSidebar('collapsed')
  await expect(app.sidebar()).toHaveAttribute('data-collapsible', 'offcanvas')
  const layout = await sidebarLayout(app)
  const hidden = await app.page
    .locator('[data-slot="sidebar-container"]')
    .evaluate((element) => !element.checkVisibility())
  expect(layout.container.right <= 0 || hidden).toBe(true)
  expect(layout.main.left).toBe(0)
  expect(layout.mainWidth).toBe(width)
}

async function expectExpanded(app: AppDriver): Promise<void> {
  await app.expectSidebar('expanded')
  const layout = await sidebarLayout(app)
  expect(layout.container.left).toBe(0)
  expect(layout.container.right - layout.container.left).toBe(SIDEBAR_WIDTH)
  expect(layout.main.left).toBe(SIDEBAR_WIDTH)
}

/** The label and shortcut of the View menu's item for the sidebar. */
async function sidebarMenuItem(app: AppDriver): Promise<{ label: string; accelerator: string }> {
  const view = (await app.applicationMenu()).find((item) => item.label === 'View')
  const item = view?.submenu?.find((entry) => /sidebar/i.test(entry.label))
  return { label: item?.label ?? '', accelerator: item?.accelerator ?? '' }
}

/** Checks that no sidebar is shown as a sheet over the main area. */
async function expectNoSheet(app: AppDriver): Promise<void> {
  await expect(app.page.locator('[data-mobile="true"]')).toHaveCount(0)
  await expect(app.page.locator('[role="dialog"] [data-slot="sidebar"]')).toHaveCount(0)
  await expect(app.page.locator('[data-slot="sheet-overlay"]')).toHaveCount(0)
}

/**
 * Presses ⌘B and follows the sidebar's container and the terminal's grid
 * from the key press until `after` milliseconds after the sidebar is in place.
 */
async function toggleAndFollow(app: AppDriver, after: number) {
  await app.page.evaluate((settle) => {
    const samples: Array<{ time: number; left: number; cols: number; rows: number }> = []
    const resizes: Array<{ left: number; cols: number; rows: number }> = []
    const container = document.querySelector('[data-slot="sidebar-container"]')!
    const terminal = window.hootTestHooks!.terminal!
    const following = {
      samples,
      resizes,
      pressed: -1,
      done: new Promise<void>((resolve) => {
        // Where the sidebar is when the grid changes size.
        const listener = terminal.onResize(({ cols, rows }) =>
          resizes.push({ left: container.getBoundingClientRect().left, cols, rows }),
        )
        const sample = () =>
          samples.push({
            time: performance.now(),
            left: container.getBoundingClientRect().left,
            cols: terminal.cols,
            rows: terminal.rows,
          })
        window.addEventListener(
          'keydown',
          () => {
            following.pressed = performance.now()
            sample()
          },
          { capture: true, once: true },
        )
        let inPlaceSince = -1
        const timer = setInterval(() => {
          if (following.pressed === -1) return
          sample()
          const settled =
            document.querySelector('[data-slot="sidebar-gap"]')!.getAnimations().length === 0
          if (!settled) inPlaceSince = -1
          else if (inPlaceSince === -1) inPlaceSince = performance.now()
          else if (performance.now() - inPlaceSince >= settle) {
            clearInterval(timer)
            listener.dispose()
            resolve()
          }
        }, 5)
      }),
    }
    ;(window as unknown as { following: typeof following }).following = following
  }, after)
  await app.page.keyboard.press('Meta+b')
  return app.page.evaluate(async () => {
    const { following } = window as unknown as {
      following: {
        samples: Array<{ time: number; left: number; cols: number; rows: number }>
        resizes: Array<{ left: number; cols: number; rows: number }>
        pressed: number
        done: Promise<void>
      }
    }
    await following.done
    return { samples: following.samples, resizes: following.resizes, pressed: following.pressed }
  })
}

test('⌘B, the sidebar trigger and the View menu collapse and expand the sidebar', async ({
  launch,
  world,
}) => {
  const app = await launch({ projects: [world.repos.G] })
  await app.resizeWindow(1200, 780)
  const id = await startShell(app)
  await runCat(app)

  // ⌘B with the keyboard focus in the terminal; its program receives nothing.
  await app.page.keyboard.press('Meta+b')
  await expectCollapsed(app, 1200)
  await app.page.keyboard.press('Meta+b')
  await expectExpanded(app)
  expect(await catOutput(app)).toEqual([])

  // The trigger and the menu item, whose label says what it will do.
  expect(await sidebarMenuItem(app)).toEqual({ label: 'Hide Sidebar', accelerator: 'CmdOrCtrl+B' })
  await app.toggleSidebarButton().click()
  await expectCollapsed(app, 1200)
  await expect
    .poll(() => sidebarMenuItem(app))
    .toEqual({
      label: 'Show Sidebar',
      accelerator: 'CmdOrCtrl+B',
    })
  await app.chooseMenuItem('View', 'Show Sidebar')
  await expectExpanded(app)
  await expect
    .poll(() => sidebarMenuItem(app))
    .toEqual({
      label: 'Hide Sidebar',
      accelerator: 'CmdOrCtrl+B',
    })
  await app.chooseMenuItem('View', 'Hide Sidebar')
  await expectCollapsed(app, 1200)
  await app.toggleSidebarButton().click()
  await expectExpanded(app)

  // Ctrl+B goes to the program, as ^B, and leaves the sidebar as it is.
  expect(await catOutput(app)).toEqual([])
  await app.page.keyboard.press('Control+b')
  await app.page.keyboard.press('Enter')
  await expect.poll(() => catOutput(app)).toEqual(['^B', '^B'])
  await app.page.waitForTimeout(300)
  await expectExpanded(app)

  // With the keyboard focus in the sidebar. Clicking a session's row puts
  // the focus in the session's terminal, so the row's button takes it then.
  const focusIn = (selector: string) =>
    app.page.evaluate((within) => document.activeElement?.closest(within) != null, selector)
  await app.selectSession(id)
  await expect.poll(() => focusIn('[data-testid="terminal"]')).toBe(true)
  await app.sessionItem(id).getByTestId('session-item-button').focus()
  expect(await focusIn('[data-slot="sidebar"]')).toBe(true)
  await app.page.keyboard.press('Meta+b')
  await expectCollapsed(app, 1200)
  await app.page.keyboard.press('Meta+b')
  await expectExpanded(app)
  await expectNoSheet(app)
})

test('the sidebar slides out and back in within a fifth of a second', async ({ launch, world }) => {
  const app = await launch({ projects: [world.repos.G] })
  await app.resizeWindow(1200, 780)
  await startShell(app)
  for (const final of [-SIDEBAR_WIDTH, 0]) {
    const { samples, pressed } = await toggleAndFollow(app, 100)
    const midway = samples.filter(
      (sample) => sample.time - pressed <= 200 && sample.left < 0 && sample.left > -SIDEBAR_WIDTH,
    )
    expect(midway.length).toBeGreaterThan(0)
    const arrived = samples.find((sample) => sample.left === final)
    expect(arrived).toBeDefined()
    expect(arrived!.time - pressed).toBeLessThanOrEqual(400)
  }
})

test('at the smallest window size the sidebar collapses and expands the same way, never as a sheet', async ({
  launch,
  world,
}) => {
  const app = await launch({ projects: [world.repos.G] })
  await app.resizeWindow(720, 480)
  await startShell(app)
  await runCat(app)
  await expectExpanded(app)
  await expectNoSheet(app)
  await app.page.keyboard.press('Meta+b')
  await expectCollapsed(app, 720)
  await expectNoSheet(app)
  await app.page.keyboard.press('Meta+b')
  await expectExpanded(app)
  await expectNoSheet(app)
  expect(await catOutput(app)).toEqual([])
})

test('the terminal is laid out again once, after the sidebar has slid into place', async ({
  launch,
  world,
}) => {
  const app = await launch({ projects: [world.repos.G] })
  await app.resizeWindow(1200, 780)
  await startShell(app)
  // The shell reports each change of its terminal's size, with the new number of columns.
  await app.run('TRAPWINCH() { print WINCH $COLUMNS }')
  const reports = async () =>
    Array.from((await app.terminalText()).matchAll(/WINCH (\d+)/g), (match) => Number(match[1]))

  const columns: number[] = []
  for (const final of [-SIDEBAR_WIDTH, 0]) {
    const before = await app.terminalSize()
    const reported = (await reports()).length
    const { samples, resizes } = await toggleAndFollow(app, 500)
    await app.page.waitForTimeout(500)
    const after = await app.terminalSize()
    columns.push(after.cols)

    // The grid changes size once, after the sidebar has arrived, and its
    // program learns of it once, with the grid's new number of columns.
    expect(resizes).toEqual([{ left: final, ...after }])
    const gaps = samples.slice(1).map((sample, index) => sample.time - samples[index]!.time)
    expect(Math.max(...gaps)).toBeLessThanOrEqual(20)
    let changes = 0
    samples.forEach((sample, index) => {
      const size = { cols: sample.cols, rows: sample.rows }
      if (index > 0 && sample.cols !== samples[index - 1]!.cols) changes++
      if (size.cols === before.cols && size.rows === before.rows) {
        expect(changes).toBe(0)
      } else {
        expect(size).toEqual(after)
        expect(sample.left).toBe(final)
      }
    })
    expect(changes).toBe(1)
    await expect.poll(async () => (await reports()).slice(reported)).toEqual([after.cols])
  }
  expect(columns[0]).toBeGreaterThan(columns[1]!)
})

test('the sidebar opens as it was left', async ({ launch, world }) => {
  const settingsFile = path.join(world.userData, 'settings.json')
  expect(fs.existsSync(settingsFile)).toBe(false)

  let app = await launch()
  await expectExpanded(app)
  await app.selectPermissionLevel('Claude Code', 'Plan')
  await app.page.keyboard.press('Meta+b')
  await app.expectSidebar('collapsed')
  await app.quit()
  await app.waitForExit()
  const collapsed = app.settings()
  expect(collapsed).toMatchObject({ permissionLevels: { claude: 'plan' } })

  app = await launch()
  await app.expectSidebar('collapsed')
  expect(await app.checkedPermissionLevels('Claude Code')).toEqual(['Plan'])
  await app.page.keyboard.press('Meta+b')
  await app.expectSidebar('expanded')
  await app.quit()
  await app.waitForExit()
  const expanded = app.settings()
  expect(expanded).toMatchObject({ permissionLevels: { claude: 'plan' } })

  // One entry records the sidebar's state, with a different value for each state.
  const keys = (settings: Record<string, unknown>) =>
    Object.keys(settings).filter((key) => key !== 'permissionLevels')
  expect(keys(collapsed)).toHaveLength(1)
  expect(keys(expanded)).toEqual(keys(collapsed))
  const [key] = keys(collapsed)
  expect(expanded[key!]).not.toEqual(collapsed[key!])

  app = await launch()
  await app.expectSidebar('expanded')
})

for (const [width, height] of [
  [1200, 780],
  [720, 480],
] as const) {
  test(`the projects and sessions in the sidebar work as before (${width}×${height})`, async ({
    app,
    world,
  }) => {
    const { G } = world.repos
    await app.resizeWindow(width, height)

    await app.addProject(G)
    await expect(app.projectItems()).toHaveCount(1)
    expect(await app.projectRoots()).toEqual([G])
    const fromButton = await app.startSession(G, 'shell')
    await expect(app.session()).toHaveAttribute('data-session-id', fromButton)
    const fromMenu = await app.startSession(G, 'shell', { from: 'context-menu' })
    await expect(app.session()).toHaveAttribute('data-session-id', fromMenu)
    expect(await app.sessionIds(G)).toEqual([fromButton, fromMenu])
    await app.selectSession(fromButton)

    // Renaming a session, which shows in its row and in the session header.
    await app.sessionItem(fromButton).getByTestId('session-item-button').dblclick()
    const input = app.sessionItem(fromButton).getByTestId('session-rename-input')
    await expect(input).toBeFocused()
    await input.fill('Renamed')
    await input.press('Enter')
    await expect(input).toHaveCount(0)
    await expect(app.sessionItemName(fromButton)).toHaveText('Renamed')
    await expect(app.page.getByTestId('session-name')).toHaveText('Renamed')

    // Closing the sessions, then removing the project.
    for (const id of [fromButton, fromMenu]) await app.closeSession(id)
    await app.projectItem(G).getByTestId('project-actions-button').click()
    await app.page.getByTestId('remove-project').click()
    await expect(app.projectItems()).toHaveCount(0)

    // Re-detecting tools, which says so while it lasts.
    fs.appendFileSync(path.join(world.home, '.zshrc'), 'sleep 2\n')
    const redetect = app.page.getByTestId('sidebar-redetect-tools')
    await redetect.click()
    await expect(redetect).toHaveText('Detecting tools…')
    await expect(redetect).toHaveText('Re-detect Tools', { timeout: 30_000 })
    await expect(redetect).toBeEnabled()
    await expectExpanded(app)
  })
}

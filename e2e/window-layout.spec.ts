import type { AppDriver } from './support/app'
import {
  boxOf,
  drawnElements,
  navigationBoxes,
  nearly,
  pixelRatio,
  sameCssColor,
  TOP_ROW_HEIGHT,
  type Box,
} from './support/layout'
import { rgb, sameColor } from './support/pixels'
import { expect, test } from './support/test'

const SIZES = [
  [1200, 780],
  [720, 480],
] as const

const SIDEBAR_WIDTH = 288

type SidebarState = 'expanded' | 'collapsed'

/** Collapses or expands the sidebar with ⌘B, unless it is so already, and waits until it is in place. */
async function setSidebar(app: AppDriver, state: SidebarState): Promise<void> {
  if ((await app.sidebarState()) !== state) await app.page.keyboard.press('Meta+b')
  await app.expectSidebar(state)
}

async function setAppearance(app: AppDriver, appearance: 'dark' | 'light'): Promise<void> {
  await app.setSystemAppearance(appearance)
  await expect
    .poll(() => app.page.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(appearance === 'dark')
}

/** The computed values of the interface's background and border colors. */
async function interfaceColors(app: AppDriver): Promise<{ background: string; border: string }> {
  return app.page.evaluate(() => {
    const style = getComputedStyle(document.documentElement)
    return {
      background: style.getPropertyValue('--background'),
      border: style.getPropertyValue('--border'),
    }
  })
}

/** Checks the main area, the sidebar's edge and, with a session, the session header. */
async function expectFlatLayout(
  app: AppDriver,
  state: SidebarState,
  withSession: boolean,
): Promise<void> {
  const [width, height] = await app.page.evaluate(() => [window.innerWidth, window.innerHeight])
  const scale = await pixelRatio(app)
  const colors = await interfaceColors(app)

  // The main area: a plain rectangle in the interface's background color, up to the window's edges.
  const main = await boxOf(app.mainArea())
  expect(main).toEqual({
    left: state === 'expanded' ? SIDEBAR_WIDTH : 0,
    top: 0,
    right: width,
    bottom: height,
  })
  const look = await app.mainArea().evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      radii: [
        style.borderTopLeftRadius,
        style.borderTopRightRadius,
        style.borderBottomRightRadius,
        style.borderBottomLeftRadius,
      ],
      shadow: style.boxShadow,
      background: style.backgroundColor,
    }
  })
  expect(look.radii).toEqual(['0px', '0px', '0px', '0px'])
  expect(look.shadow).toBe('none')
  expect(sameCssColor(look.background, colors.background)).toBe(true)

  // The line between the sidebar and the main area.
  const container = app.page.locator('[data-slot="sidebar-container"]')
  const edge = await container.evaluate((element) => {
    const style = getComputedStyle(element)
    const { left, right } = element.getBoundingClientRect()
    return { left, right, width: style.borderRightWidth, color: style.borderRightColor }
  })
  if (state === 'expanded') {
    expect(edge.width).toBe('1px')
    expect(sameCssColor(edge.color, colors.border)).toBe(true)
    // Its right border is the line at x 287–288.
    expect(edge.right).toBe(SIDEBAR_WIDTH)
  } else {
    expect(edge.right).toBeLessThanOrEqual(0)
  }

  // The sidebar's default look, without the inset one.
  await expect(app.sidebar()).toHaveAttribute('data-variant', 'sidebar')
  await expect(app.page.locator('main[data-slot="sidebar-inset"]')).toHaveCount(1)
  await expect(app.page.locator('[data-variant="inset"]')).toHaveCount(0)

  // The navigation's buttons are in the middle of the top row.
  for (const box of Object.values(await navigationBoxes(app))) {
    expect(nearly((box.top + box.bottom) / 2, TOP_ROW_HEIGHT / 2, scale)).toBe(true)
  }

  if (state === 'expanded') {
    // The project list starts below the top row, where the sidebar shows only the navigation.
    for (const selector of ['[data-slot="sidebar-group-label"]', '[data-testid="add-project"]']) {
      expect((await boxOf(app.page.locator(selector))).top).toBeGreaterThanOrEqual(TOP_ROW_HEIGHT)
    }
    const drawn = await drawnElements(app, {
      left: 0,
      top: 0,
      right: SIDEBAR_WIDTH,
      bottom: TOP_ROW_HEIGHT,
    })
    expect(drawn.filter((element) => element.navigationButton === null)).toEqual([])
    expect(new Set(drawn.map((element) => element.navigationButton))).toEqual(
      new Set(['toggle-sidebar', 'go-back', 'go-forward']),
    )
  }

  if (!withSession) {
    await expect(app.sessionHeader()).toHaveCount(0)
    return
  }
  // The session header is the main area's part of the top row, with no line below it.
  const header = await boxOf(app.sessionHeader())
  expect(header.top).toBe(0)
  expect(header.bottom - header.top).toBe(TOP_ROW_HEIGHT)
  expect(
    await app.sessionHeader().evaluate((element) => getComputedStyle(element).borderBottomWidth),
  ).toBe('0px')
  await expectBackgroundAround(app, header, colors.background, scale)
}

/**
 * Checks that 2 CSS pixels above and below the header's bottom edge, every
 * physical pixel that is not on text or a button shows exactly the
 * interface's background color.
 */
async function expectBackgroundAround(
  app: AppDriver,
  header: Box,
  background: string,
  scale: number,
): Promise<void> {
  const band: Box = {
    left: header.left,
    top: header.bottom - 2,
    right: header.right,
    bottom: header.bottom + 2,
  }
  // Text and buttons in or next to the band, whose pixels are not checked.
  const covered = await app.page.evaluate((area) => {
    const boxes: Box[] = []
    for (const element of Array.from(document.body.querySelectorAll('*'))) {
      const ownText = Array.from(element.childNodes).some(
        (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
      )
      if (!ownText && element.tagName !== 'BUTTON') continue
      const { left, top, right, bottom } = element.getBoundingClientRect()
      if (left < area.right && right > area.left && top < area.bottom && bottom > area.top) {
        boxes.push({ left, top, right, bottom })
      }
    }
    return boxes
  }, band)
  const shot = await app.screenshot()
  const expected = rgb(background)
  const errors: string[] = []
  for (let y = Math.floor(band.top * scale); y < Math.ceil(band.bottom * scale); y++) {
    for (let x = Math.ceil(band.left * scale); x < Math.floor(band.right * scale); x++) {
      const onSomething = covered.some(
        (box) =>
          x + 1 > box.left * scale &&
          x < box.right * scale &&
          y + 1 > box.top * scale &&
          y < box.bottom * scale,
      )
      if (onSomething) continue
      const color = shot.pixel(x, y)
      if (!sameColor(color, expected) && errors.length < 5)
        errors.push(`${x},${y}: ${color.join(',')}`)
    }
  }
  expect(errors).toEqual([])
}

for (const [width, height] of SIZES) {
  test(`the window has no title bar: the page takes the whole window (${width}×${height})`, async ({
    launch,
    world,
  }) => {
    const app = await launch({ projects: [world.repos.G] })
    await app.resizeWindow(width, height)
    for (const state of ['expanded', 'collapsed'] as const) {
      await setSidebar(app, state)
      const native = await app.electronApp.evaluate(({ BrowserWindow }) => {
        const shown = BrowserWindow.getAllWindows()[0]!
        return {
          bounds: shown.getBounds(),
          content: shown.getContentBounds(),
          trafficLights: shown.getWindowButtonPosition(),
          title: shown.getTitle(),
        }
      })
      expect(native.bounds.height).toBe(height)
      expect(native.content.height).toBe(native.bounds.height)
      expect(await app.page.evaluate(() => window.innerHeight)).toBe(native.bounds.height)
      expect((await boxOf(app.mainArea())).top).toBe(0)
      if (state === 'expanded') {
        expect((await boxOf(app.page.locator('[data-slot="sidebar-container"]'))).top).toBe(0)
      }
      expect(native.trafficLights).toEqual({ x: 15, y: 15 })
      expect(native.title).toBe('Hoot')
    }
  })

  test(`the main area lies flat beside the sidebar, and the top row holds the session header (${width}×${height})`, async ({
    launch,
    world,
  }) => {
    const { G } = world.repos
    // The project is in the list from the start, so no message covers the window.
    const app = await launch({ projects: [G], deviceScaleFactor: 2 })
    await app.resizeWindow(width, height)
    for (const appearance of ['dark', 'light'] as const) {
      await setAppearance(app, appearance)
      for (const state of ['expanded', 'collapsed'] as const) {
        await setSidebar(app, state)
        await expect(app.page.getByTestId('no-session')).toBeVisible()
        await expectFlatLayout(app, state, false)
      }

      // Sessions start from the project's row in the sidebar.
      await setSidebar(app, 'expanded')
      const id = await app.startSession(G, 'shell')
      await app.waitForPrompt()
      for (const state of ['expanded', 'collapsed'] as const) {
        await setSidebar(app, state)
        // Keep the pointer off the buttons, which hovering colors.
        await app.page.mouse.move(width / 2, height - 20)
        await expectFlatLayout(app, state, true)
      }
      await app.run('exit', { waitForPrompt: false })
      await expect(app.sessionItem(id)).toHaveCount(0)
    }
  })
}

test('the terminal has more rows than before at the default window size', async ({
  app,
  world,
}) => {
  await app.addProject(world.repos.G)
  await expect(app.projectItems()).toHaveCount(1)
  await app.resizeWindow(1200, 780)
  await app.startSession(world.repos.G, 'shell')
  await app.waitForPrompt()
  await app.expectSidebar('expanded')
  // 36 rows before the title bar was removed.
  expect((await app.terminalSize()).rows).toBeGreaterThan(36)
})

test('the sidebar is 288 pixels wide and its edge cannot be dragged to resize it', async ({
  app,
}) => {
  await app.resizeWindow(1200, 780)
  const container = app.page.locator('[data-slot="sidebar-container"]')
  expect((await boxOf(container)).right).toBe(SIDEBAR_WIDTH)
  await app.page.mouse.move(SIDEBAR_WIDTH - 0.5, 400)
  await app.page.mouse.down()
  await app.page.mouse.move(SIDEBAR_WIDTH + 100, 400, { steps: 10 })
  await app.page.mouse.up()
  await app.settle()
  if ((await app.sidebarState()) === 'expanded') {
    const box = await boxOf(container)
    expect(box.right - box.left).toBe(SIDEBAR_WIDTH)
  }
})

test('without a session the main area shows the empty page, with Add Project until there is a project', async ({
  app,
  world,
}) => {
  const empty = app.page.getByTestId('no-session')
  await expect(empty).toContainText('No session')
  await expect(empty.getByRole('button', { name: 'Add Project' })).toBeVisible()
  await app.addProject(world.repos.G)
  await expect(app.projectItems()).toHaveCount(1)
  await expect(empty).toContainText('No session')
  await expect(empty.getByRole('button')).toHaveCount(0)
})

test('messages show at the top right, below the session header', async ({ launch, world }) => {
  const { G, N } = world.repos
  const app = await launch({ projects: [G] })
  await app.resizeWindow(1200, 780)
  await app.startSession(G, 'shell')
  await app.waitForPrompt()
  await app.addProject(N)
  const message = app.toasts('The selected folder is not in a Git repository.')
  await expect(message).toBeVisible()
  // Once it has slid into place.
  await expect
    .poll(async () => {
      const box = await boxOf(message)
      return [Math.round(box.top), Math.round(box.right)]
    })
    .toEqual([60, 1200 - 16])
  const toast = await boxOf(message)
  const header = await boxOf(app.sessionHeader())
  expect(toast.left).toBeGreaterThan(1200 / 2)
  expect(toast.top).toBeGreaterThanOrEqual(header.bottom)
})

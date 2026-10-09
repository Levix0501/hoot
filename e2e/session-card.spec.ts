import type { AppDriver } from './support/app'
import { isBetween, rgb, sameColor, type Rgb } from './support/pixels'
import { expect, test } from './support/test'

/** Within this many CSS pixels of the card, the card's shadow may darken the sidebar's color. */
const SHADOW_REACH = 5

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** The session card's place, look and content, and the sidebar's. */
async function cardLayout(app: AppDriver) {
  return app.page.evaluate(() => {
    const box = (element: Element | null) => {
      if (!element) return null
      const { left, top, right, bottom } = element.getBoundingClientRect()
      return { left, top, right, bottom }
    }
    const card = document.querySelector('[data-slot="sidebar-inset"]')!
    const sidebar = document.querySelector('[data-slot="sidebar"]')!
    const style = getComputedStyle(card)
    const root = getComputedStyle(document.documentElement)
    // shadcn's rounded-xl.
    const probe = document.createElement('div')
    probe.style.width = 'calc(var(--radius) * 1.4)'
    document.body.append(probe)
    const roundedXl = probe.getBoundingClientRect().width
    probe.remove()
    return {
      window: { width: window.innerWidth, height: window.innerHeight },
      card: box(card)!,
      radii: [
        style.borderTopLeftRadius,
        style.borderTopRightRadius,
        style.borderBottomRightRadius,
        style.borderBottomLeftRadius,
      ],
      roundedXl,
      sidebar: box(sidebar)!,
      sidebarVariant: sidebar.getAttribute('data-variant'),
      sidebarVisible: sidebar.checkVisibility(),
      header: box(card.querySelector('[data-testid="session"] header')),
      terminalArea: box(card.querySelector('[data-testid="terminal-area"]')),
      emptyPage: box(card.querySelector('[data-testid="no-session"]')),
      colors: {
        background: root.getPropertyValue('--background'),
        sidebar: root.getPropertyValue('--sidebar'),
      },
    }
  })
}

/** How far a point is outside a box, in CSS pixels (0 inside it). */
function distanceOutside(x: number, y: number, box: Box): number {
  const dx = Math.max(box.left - x, 0, x - box.right)
  const dy = Math.max(box.top - y, 0, y - box.bottom)
  return Math.max(dx, dy)
}

async function expectSessionCard(app: AppDriver, withSession: boolean): Promise<void> {
  const layout = await cardLayout(app)
  const { card, sidebar, window } = layout

  // 8 pixels from the top, right and bottom of the window's content; next to the sidebar.
  expect(card.top).toBe(8)
  expect(window.width - card.right).toBe(8)
  expect(window.height - card.bottom).toBe(8)
  expect(card.left).toBe(sidebar.right)
  expect(layout.sidebarVariant).toBe('inset')
  expect(layout.sidebarVisible).toBe(true)

  // Rounded like shadcn's rounded-xl.
  expect(layout.roundedXl).toBe(14)
  expect(layout.radii).toEqual(['14px', '14px', '14px', '14px'])

  if (withSession) {
    expect(layout.header).toMatchObject({ top: card.top, left: card.left, right: card.right })
    expect(layout.terminalArea).toMatchObject({
      top: layout.header!.bottom,
      left: card.left,
      right: card.right,
      bottom: card.bottom,
    })
    expect(layout.emptyPage).toBeNull()
  } else {
    expect(layout.header).toBeNull()
    expect(layout.emptyPage).not.toBeNull()
    expect(distanceOutside(layout.emptyPage!.left, layout.emptyPage!.top, card)).toBe(0)
    expect(distanceOutside(layout.emptyPage!.right, layout.emptyPage!.bottom, card)).toBe(0)
  }

  const shot = await app.screenshot()
  const scale = shot.width / window.width
  const background = rgb(layout.colors.background)
  const sidebarColor = rgb(layout.colors.sidebar)
  const at = (x: number, y: number): Rgb => shot.pixel(Math.floor(x * scale), Math.floor(y * scale))

  // Blank parts of the card show the interface's background color.
  for (const [x, y] of [
    [card.left + 20, card.bottom - 4],
    [card.right - 20, card.bottom - 4],
    [(card.left + card.right) / 2, card.bottom - 4],
  ] as const) {
    expect(at(x, y), `card at ${x},${y}`).toEqual(background)
  }

  // Around it, right of the sidebar, the window shows the sidebar's color;
  // close to the card, its shadow may darken it.
  const errors: string[] = []
  for (let y = 0; y < shot.height; y++) {
    for (let x = Math.ceil(sidebar.right * scale); x < shot.width; x++) {
      const point = { x: (x + 0.5) / scale, y: (y + 0.5) / scale }
      const distance = distanceOutside(point.x, point.y, card)
      if (distance === 0) continue
      const color = shot.pixel(x, y)
      const fine =
        distance >= SHADOW_REACH
          ? sameColor(color, sidebarColor)
          : isBetween(color, sidebarColor, [0, 0, 0])
      if (!fine && errors.length < 5) errors.push(`${x},${y}: ${color.join(',')}`)
    }
  }
  expect(errors).toEqual([])
}

for (const [width, height] of [
  [1200, 780],
  [720, 480],
] as const) {
  test(`the session card is a rounded card inset on the sidebar's color (${width}×${height})`, async ({
    launch,
    world,
  }) => {
    const { G } = world.repos
    // The project is in the list from the start, so no message covers the window.
    const app = await launch({ projects: [G] })
    await app.setWindowSize(width, height)
    await expect.poll(() => app.page.evaluate(() => window.innerWidth)).toBe(width)
    for (const appearance of ['dark', 'light'] as const) {
      await app.setSystemAppearance(appearance)
      await expect
        .poll(() => app.page.evaluate(() => document.documentElement.classList.contains('dark')))
        .toBe(appearance === 'dark')
      await expect(app.page.getByTestId('no-session')).toBeVisible()
      await expectSessionCard(app, false)

      const id = await app.startSession(G, 'shell')
      await app.waitForPrompt()
      await expectSessionCard(app, true)
      await app.run('exit', { waitForPrompt: false })
      await expect(app.sessionItem(id)).toHaveCount(0)
    }
  })

  test(`the sidebar stays and works as before (${width}×${height})`, async ({ app, world }) => {
    const { G, H } = world.repos
    await app.setWindowSize(width, height)
    await expect.poll(() => app.page.evaluate(() => window.innerWidth)).toBe(width)
    const sidebar = app.page.locator('[data-slot="sidebar"]')
    const sidebarWidth = async () => (await sidebar.boundingBox())?.width

    // Adding projects and starting a session.
    await app.addProject(G)
    await expect(app.projectItems()).toHaveCount(1)
    await app.addProject(H)
    await expect(app.projectItems()).toHaveCount(2)
    const id = await app.startSession(G, 'shell')
    await app.waitForPrompt()
    await expect(app.sessionItem(id)).toBeVisible()
    const widthBefore = await sidebarWidth()
    expect(widthBefore).toBe(288)

    // ⌘B and Ctrl+B with the focus in the sidebar do not collapse it.
    for (const shortcut of ['Meta+B', 'Control+B']) {
      await app.page.getByTestId('sidebar-redetect-tools').focus()
      await app.page.keyboard.press(shortcut)
      await app.page.waitForTimeout(300)
      await expect(sidebar).toBeVisible()
      expect(await sidebarWidth()).toBe(widthBefore)
      await expect(app.projectItem(G)).toBeVisible()
      await expect(app.sessionItem(id)).toBeVisible()
    }

    // Renaming a session.
    await app.sessionItem(id).getByTestId('session-item-button').dblclick()
    const input = app.sessionItem(id).getByTestId('session-rename-input')
    await expect(input).toBeFocused()
    await input.fill('Renamed')
    await input.press('Enter')
    await expect(input).toHaveCount(0)
    await expect(app.sessionItemName(id)).toHaveText('Renamed')

    // Re-detecting tools.
    await app.page.getByTestId('sidebar-redetect-tools').click()
    await expect(app.page.getByTestId('sidebar-redetect-tools')).toBeEnabled()

    // Closing the session and removing a project.
    await app.closeSession(id)
    await expect(app.page.getByTestId('no-session')).toBeVisible()
    await app.projectItem(H).click({ button: 'right' })
    await app.page.getByTestId('context-remove-project').click()
    await expect(app.projectItems()).toHaveCount(1)
    expect(await app.projectRoots()).toEqual([G])
    await expect(sidebar).toBeVisible()
    expect(await sidebarWidth()).toBe(widthBefore)
  })
}

import type { AppDriver } from './support/app'
import {
  boxOf,
  dragElementBoxes,
  drawnElements,
  inDragArea,
  navigationBoxes,
  nearly,
  pixelRatio,
  TOP_ROW_HEIGHT,
  type Box,
} from './support/layout'
import { expect, test } from './support/test'

/** The right edge of the traffic lights' zoom button, with the traffic lights at x 15, y 15. */
const TRAFFIC_LIGHTS_RIGHT = 75

type SidebarState = 'expanded' | 'collapsed'

async function setSidebar(app: AppDriver, state: SidebarState): Promise<void> {
  if ((await app.sidebarState()) !== state) await app.page.keyboard.press('Meta+b')
  await app.expectSidebar(state)
}

/** Starts a Shell session in project G, which is in the list, and waits for its prompt. */
async function startShell(app: AppDriver): Promise<string> {
  const id = await app.startSession(app.world.repos.G, 'shell')
  await app.waitForPrompt(20_000, id)
  return id
}

const center = (box: Box) => ({ x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 })

/**
 * Checks where the navigation is: its three buttons in the top row, in order,
 * with nothing else drawn between `from` and the last of them; and, with the
 * sidebar collapsed, the session header's content right of them.
 */
async function expectNavigation(
  app: AppDriver,
  state: SidebarState,
  from: number,
): Promise<Record<string, Box>> {
  const scale = await pixelRatio(app)
  const boxes = await navigationBoxes(app)
  const { toggle, back, forward } = boxes as Record<'toggle' | 'back' | 'forward', Box>
  for (const box of [toggle, back, forward]) {
    expect(box.top).toBeGreaterThanOrEqual(0)
    expect(box.bottom).toBeLessThanOrEqual(TOP_ROW_HEIGHT)
    expect(nearly(center(box).y, TOP_ROW_HEIGHT / 2, scale)).toBe(true)
  }
  expect(toggle.right).toBeLessThanOrEqual(back.left)
  expect(back.right).toBeLessThanOrEqual(forward.left)
  await expect(app.toggleSidebarButton()).toHaveAttribute('data-slot', 'sidebar-trigger')
  const between = await drawnElements(app, {
    left: from,
    top: 0,
    right: forward.right,
    bottom: TOP_ROW_HEIGHT,
  })
  expect(between.filter((element) => element.navigationButton === null)).toEqual([])
  if (state === 'collapsed') {
    const header = await boxOf(app.sessionHeader())
    const content = await drawnElements(app, header, '[data-testid="session"] header')
    expect(content.length).toBeGreaterThan(0)
    expect(content.filter((element) => element.box.left < forward.right)).toEqual([])
  }
  return boxes
}

for (const [width, height] of [
  [1200, 780],
  [720, 480],
] as const) {
  test(`the navigation sits right of the traffic lights, in the same place with the sidebar shown or hidden (${width}×${height})`, async ({
    launch,
    world,
  }) => {
    const app = await launch({ projects: [world.repos.G], deviceScaleFactor: 2 })
    await app.resizeWindow(width, height)
    await startShell(app)
    const places: Partial<Record<SidebarState, Record<string, Box>>> = {}
    for (const state of ['expanded', 'collapsed'] as const) {
      await setSidebar(app, state)
      await app.page.mouse.move(width / 2, height - 20)
      const boxes = await expectNavigation(app, state, TRAFFIC_LIGHTS_RIGHT)
      expect(boxes.toggle!.left).toBeGreaterThanOrEqual(TRAFFIC_LIGHTS_RIGHT)
      places[state] = boxes
    }
    expect(places.collapsed).toEqual(places.expanded)

    // Pointing at a button shows its name and shortcut, also while it is disabled.
    await expect(app.backButton()).toBeDisabled()
    await expect(app.forwardButton()).toBeDisabled()
    const tooltip = app.page.locator('[data-slot="tooltip-content"]')
    for (const [button, shortcut] of [
      [app.toggleSidebarButton(), '⌘B'],
      [app.backButton(), '⌘['],
      [app.forwardButton(), '⌘]'],
    ] as const) {
      const { x, y } = center(await boxOf(button))
      await app.page.mouse.move(x, y)
      await expect(tooltip).toBeVisible()
      await expect(tooltip).toContainText(shortcut)
      const text = (await tooltip.textContent()) ?? ''
      expect(text.replace(shortcut, '').trim()).not.toBe('')
      await app.page.mouse.move(width / 2, height - 20)
      await expect(tooltip).toHaveCount(0)
    }
    await app.expectEnglishUi()
  })
}

test('in full screen the navigation takes the place of the traffic lights', async ({
  launch,
  world,
}) => {
  const app = await launch({ projects: [world.repos.G], deviceScaleFactor: 2 })
  await app.resizeWindow(1200, 780)
  await startShell(app)
  await app.page.mouse.move(600, 760)
  for (const state of ['expanded', 'collapsed'] as const) {
    await setSidebar(app, state)
    const windowed = await navigationBoxes(app)

    // The window only says it entered full screen: it does not cover the screen.
    await app.emitWindowEvent('enter-full-screen')
    await expect(app.page.getByTestId('window-navigation')).toHaveAttribute(
      'data-full-screen',
      'true',
    )
    await app.settle()
    const boxes = await expectNavigation(app, state, 0)
    expect(boxes.toggle!.left).toBeLessThanOrEqual(15)

    await app.emitWindowEvent('leave-full-screen')
    await expect(app.page.getByTestId('window-navigation')).toHaveAttribute(
      'data-full-screen',
      'false',
    )
    await app.settle()
    expect(await navigationBoxes(app)).toEqual(windowed)
  }
})

test('the blank parts of the top row drag the window; its buttons and names do not', async ({
  launch,
  world,
}) => {
  const app = await launch({ projects: [world.repos.G] })
  await app.resizeWindow(1200, 780)
  const first = await startShell(app)
  const second = await startShell(app)

  for (const state of ['expanded', 'collapsed'] as const) {
    await setSidebar(app, state)
    const { toggle, back, forward } = (await navigationBoxes(app)) as Record<string, Box>
    const project = await boxOf(app.page.getByTestId('session-project'))
    const status = await boxOf(app.page.getByTestId('session-status'))
    const blank = [
      { x: 5, y: 22 },
      { x: (project.right + status.left) / 2, y: 22 },
    ]
    if (state === 'expanded') blank.push({ x: (forward!.right + 288) / 2, y: 22 })
    for (const point of blank) {
      expect(await inDragArea(app, point.x, point.y), `${state} ${point.x},${point.y}`).toBe(true)
    }
    for (const [name, box] of [
      ['toggle', toggle!],
      ['back', back!],
      ['forward', forward!],
      ['close', await boxOf(app.page.getByTestId('session-header-close'))],
      ['session name', await boxOf(app.page.getByTestId('session-name'))],
      ['project name', project],
    ] as const) {
      const { x, y } = center(box)
      expect(await inDragArea(app, x, y), `${state} ${name}`).toBe(false)
    }
    // Nothing below the top row drags the window.
    for (const box of await dragElementBoxes(app)) {
      expect(box.bottom, box.description).toBeLessThanOrEqual(TOP_ROW_HEIGHT)
    }
  }

  // The buttons do what they say.
  await app.toggleSidebarButton().click()
  await app.expectSidebar('expanded')
  await app.toggleSidebarButton().click()
  await app.expectSidebar('collapsed')
  await expect(app.session()).toHaveAttribute('data-session-id', second)
  await app.backButton().click()
  await expect(app.session()).toHaveAttribute('data-session-id', first)
  await app.forwardButton().click()
  await expect(app.session()).toHaveAttribute('data-session-id', second)
  await app.page.getByTestId('session-header-close').click()
  await expect(app.closeSessionDialog()).toBeVisible()
  await app.page.getByTestId('close-session-cancel').click()
  await expect(app.closeSessionDialog()).toBeHidden()

  // Without a session, the top row still drags the window, both beside the
  // sidebar and with it hidden.
  await setSidebar(app, 'expanded')
  for (const id of [second, first]) await app.closeSession(id)
  await expect(app.page.getByTestId('no-session')).toBeVisible()
  for (const state of ['collapsed', 'expanded'] as const) {
    await setSidebar(app, state)
    for (const point of [
      { x: 5, y: 22 },
      { x: 700, y: 22 },
      { x: 1190, y: 5 },
    ]) {
      expect(await inDragArea(app, point.x, point.y), `${state} ${point.x},${point.y}`).toBe(true)
    }
    expect(await inDragArea(app, 700, 60)).toBe(false)
  }
})

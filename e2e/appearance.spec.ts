import Color from 'colorjs.io'
import { PNG } from 'pngjs'
import type { AppDriver } from './support/app'
import { boxOf, type Box } from './support/layout'
import { colorDifference, rgb, Screenshot } from './support/pixels'
import {
  appearancePage,
  backgroundColors,
  expectAppIn,
  expectOverlaysIn,
  expectSettingsIn,
  expectWindowIn,
  interfaceColors,
  oneOf,
  pickTheme,
  pressSettingsShortcut,
  selectedTheme,
  terminalColors,
  themeCard,
  themePreview,
} from './support/settings'
import { expect, test } from './support/test'

interface Luminances {
  sidebarBackground: number
  mainBackground: number
  terminalBackground: number
  interfaceText: number
  terminalText: number
}

/** The color shown on screen at a point of the window. */
async function shownColor(app: AppDriver, x: number, y: number): Promise<string> {
  const [red, green, blue] = PNG.sync.read(
    await app.page.screenshot({ clip: { x, y, width: 1, height: 1 } }),
  ).data
  return `rgb(${red}, ${green}, ${blue})`
}

/** Relative luminance (0 is black, 1 is white) of what the interface and terminal show. */
async function luminances(app: AppDriver): Promise<Luminances> {
  const sidebar = (await app.page.locator('[data-slot="sidebar"]').boundingBox())!
  const header = (await app.page.locator('[data-testid="session"] header').boundingBox())!
  const terminal = (await app.page.getByTestId('terminal').boundingBox())!
  const interfaceText = await app.page.evaluate(() => getComputedStyle(document.body).color)
  // The prompt's first letter: its pixel that differs most from the terminal's background.
  const prompt = await app.cellBox(0, 0)
  const background = new Color(
    await shownColor(app, terminal.x + terminal.width - 40, terminal.y + terminal.height - 8),
  )
  const letter = PNG.sync.read(await app.page.screenshot({ clip: prompt }))
  let terminalText = background
  for (let offset = 0; offset < letter.data.length; offset += 4) {
    const [red, green, blue] = letter.data.subarray(offset, offset + 3)
    const color = new Color(`rgb(${red}, ${green}, ${blue})`)
    if (
      Math.abs(color.luminance - background.luminance) >
      Math.abs(terminalText.luminance - background.luminance)
    ) {
      terminalText = color
    }
  }
  const luminance = (color: string) => new Color(color).luminance
  return {
    // Empty parts of each area: below the project list, the header's top edge,
    // and the terminal's last row.
    sidebarBackground: luminance(
      await shownColor(app, sidebar.x + sidebar.width / 2, sidebar.y + sidebar.height * 0.6),
    ),
    mainBackground: luminance(await shownColor(app, header.x + header.width / 2, header.y + 3)),
    terminalBackground: background.luminance,
    interfaceText: luminance(interfaceText),
    terminalText: terminalText.luminance,
  }
}

const isLight = (shown: Luminances) =>
  shown.sidebarBackground > 0.8 &&
  shown.mainBackground > 0.8 &&
  shown.terminalBackground > 0.8 &&
  shown.interfaceText < 0.2 &&
  shown.terminalText < 0.2

const isDark = (shown: Luminances) =>
  shown.sidebarBackground < 0.05 &&
  shown.mainBackground < 0.05 &&
  shown.terminalBackground < 0.05 &&
  shown.interfaceText > 0.7 &&
  shown.terminalText > 0.7

test('the interface and terminal follow the system appearance while running', async ({
  app,
  world,
}) => {
  await app.setSystemAppearance('light')
  await app.addProject(world.repos.G)
  await expect(app.projectItems()).toHaveCount(1)
  await app.startSession(world.repos.G, 'shell')
  await app.waitForPrompt()
  await expect.poll(async () => isLight(await luminances(app))).toBe(true)

  await app.setSystemAppearance('dark')
  await expect.poll(async () => isDark(await luminances(app))).toBe(true)

  await app.setSystemAppearance('light')
  await expect.poll(async () => isLight(await luminances(app))).toBe(true)
  await expect(app.session()).toHaveAttribute('data-status', 'running')
  await app.expectEnglishUi()
})

const APPEARANCE_NAMES = { system: 'System', light: 'Light', dark: 'Dark' } as const
type Picked = keyof typeof APPEARANCE_NAMES
const PICKED: Picked[] = ['system', 'light', 'dark']

/** How far apart, in levels of a channel, two drawings' pixels may be and still be the same. */
const SAME_DRAWING_TOLERANCE = 6

/** The drawing of a theme preview is 160 × 100 units, its corners rounded by 6. */
const DRAWING_WIDTH = 160
const DRAWING_CORNER = 7
/** Where the sidebar meets the terminal in the drawing, and where the halves of System's meet. */
const SIDEBAR_EDGE = 51.5
const HALVES_EDGE = 80

interface DrawnPart {
  fill: string
  box: Box
}

/** What a card's preview draws, in CSS pixels from its top left, with the colors it draws in. */
async function previewLayout(app: AppDriver, appearance: Picked) {
  return themePreview(app, appearance).evaluate((svg) => {
    const origin = svg.getBoundingClientRect()
    const part = (element: Element) => {
      const { left, top, right, bottom } = element.getBoundingClientRect()
      return {
        fill: getComputedStyle(element).fill,
        box: {
          left: left - origin.left,
          top: top - origin.top,
          right: right - origin.left,
          bottom: bottom - origin.top,
        },
      }
    }
    return {
      width: origin.width,
      height: origin.height,
      images: svg.querySelectorAll('image, use, foreignObject, [href]').length,
      drawings: Array.from(svg.querySelectorAll('[data-scheme]')).map((drawing) => {
        const prompt = drawing.querySelector('[data-part="prompt"]')!
        return {
          scheme: drawing.getAttribute('data-scheme') as 'light' | 'dark',
          sidebar: part(drawing.querySelector('[data-part="sidebar"]')!),
          terminal: part(drawing.querySelector('[data-part="terminal"]')!),
          bars: Array.from(drawing.querySelectorAll('[data-part="bar"]')).map(part),
          prompt: {
            ...part(prompt),
            text: prompt.textContent ?? '',
            fills: [prompt, ...Array.from(prompt.querySelectorAll('tspan'))].map(
              (element) => getComputedStyle(element).fill,
            ),
          },
        }
      }),
    }
  })
}

const inside = (box: Box, x: number, y: number, margin = 0) =>
  x >= box.left - margin &&
  x <= box.right + margin &&
  y >= box.top - margin &&
  y <= box.bottom + margin

/**
 * The points of a preview's drawing, in device pixels, that are neither on
 * its edge, nor on what is drawn on a part's ground, nor where two parts
 * meet: where the ground of a part shows. With the part each lies in.
 */
function groundPixels(
  layout: Awaited<ReturnType<typeof previewLayout>>,
  appearance: Picked,
  shot: Screenshot,
) {
  const scale = shot.width / layout.width
  const unit = layout.width / DRAWING_WIDTH
  const drawn = layout.drawings.flatMap((drawing) => [...drawing.bars, drawing.prompt])
  const points: Array<{
    x: number
    y: number
    scheme: 'light' | 'dark'
    part: 'sidebar' | 'terminal'
  }> = []
  for (let y = 0; y < shot.height; y++) {
    for (let x = 0; x < shot.width; x++) {
      const cssX = (x + 0.5) / scale
      const cssY = (y + 0.5) / scale
      const unitX = cssX / unit
      const unitY = cssY / unit
      const height = layout.height / unit
      const nearEdge = unitX < 2 || unitX > DRAWING_WIDTH - 2 || unitY < 2 || unitY > height - 2
      const inCorner =
        (unitX < DRAWING_CORNER || unitX > DRAWING_WIDTH - DRAWING_CORNER) &&
        (unitY < DRAWING_CORNER || unitY > height - DRAWING_CORNER)
      if (nearEdge || inCorner || Math.abs(unitX - SIDEBAR_EDGE) < 1.5) continue
      if (appearance === 'system' && Math.abs(unitX - HALVES_EDGE) < 1) continue
      if (drawn.some((part) => inside(part.box, cssX, cssY, 1))) continue
      points.push({
        x,
        y,
        scheme: appearance === 'system' ? (unitX < HALVES_EDGE ? 'light' : 'dark') : appearance,
        part: unitX < SIDEBAR_EDGE ? 'sidebar' : 'terminal',
      })
    }
  }
  return points
}

/** Whether a card has the outline of the selected card around it: a shadow spread in a color that shows. */
async function outlined(app: AppDriver, appearance: Picked): Promise<boolean> {
  const shadow = await themeCard(app, appearance).evaluate(
    (card) => getComputedStyle(card).boxShadow,
  )
  return shadow
    .split(/,(?![^(]*\))/)
    .map((part) => part.trim())
    .some((part) => !part.startsWith('rgba(0, 0, 0, 0)') && /\s[1-9]\d*(\.\d+)?px$/.test(part))
}

/** Checks which card has the outline, also by what is drawn just outside each card. */
async function expectOutlined(app: AppDriver, selected: Picked, scheme: 'light' | 'dark') {
  await expect.poll(() => selectedTheme(app)).toBe(selected)
  const colors = await interfaceColors(app, scheme)
  const shot = await app.screenshot()
  const scale = await app.page.evaluate(() => window.devicePixelRatio)
  for (const appearance of PICKED) {
    expect(await outlined(app, appearance), appearance).toBe(appearance === selected)
    const card = await boxOf(themeCard(app, appearance))
    const beside = shot.pixel(
      Math.round((card.left - 1) * scale),
      Math.round(((card.top + card.bottom) / 2) * scale),
    )
    const expected = appearance === selected ? colors.primary : colors.background
    expect(oneOf(beside, [rgb(expected)]), `${appearance}: ${beside.join(',')}`).toBe(true)
  }
}

/** The card the keyboard focus is in, if any. */
async function focusedCard(app: AppDriver): Promise<string | null> {
  return app.page.evaluate(
    () =>
      document.activeElement
        ?.closest('[data-testid^="theme-card-"]')
        ?.getAttribute('data-testid')
        ?.replace('theme-card-', '') ?? null,
  )
}

test('the Appearance page offers System, Light and Dark as cards that draw Hoot in their colors', async ({
  launch,
}) => {
  const app = await launch({ systemAppearance: 'light', deviceScaleFactor: 2 })
  await app.resizeWindow(1200, 780)
  await pressSettingsShortcut(app)
  await app.page.mouse.move(600, 760)

  // 1: the page's title, the Theme group, its three cards in order, and no button to save.
  const page = appearancePage(app)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Appearance')
  const group = page.getByRole('radiogroup', { name: 'Theme' })
  await expect(group).toBeVisible()
  expect(
    await group.locator('[data-testid^="theme-card-"]').evaluateAll((cards) =>
      // The names below the previews, whose drawings have text of their own.
      cards.map((card) =>
        Array.from(card.children)
          .filter((child) => child.tagName !== 'svg')
          .map((child) => (child as HTMLElement).innerText.trim())
          .join(''),
      ),
    ),
  ).toEqual(['System', 'Light', 'Dark'])
  for (const appearance of PICKED) {
    await expect(themeCard(app, appearance).getByRole('radio')).toHaveAccessibleName(
      APPEARANCE_NAMES[appearance],
    )
  }
  await expect(page.getByRole('button')).toHaveCount(0)
  await expect(page.getByText(/save|apply/i)).toHaveCount(0)
  await app.expectEnglishUi()

  // 2: Light and Dark draw a sidebar with rows and a terminal with a prompt and more lines, in
  // colors unlike their ground; their grounds are colors of their appearance. System draws its
  // left half in light colors and its right half in dark ones.
  const grounds = {
    light: {
      sidebar: rgb((await interfaceColors(app, 'light')).sidebar),
      terminal: rgb(terminalColors('light').background!),
    },
    dark: {
      sidebar: rgb((await interfaceColors(app, 'dark')).sidebar),
      terminal: rgb(terminalColors('dark').background!),
    },
  }
  const lightBackgrounds = await backgroundColors(app, 'light')
  const darkBackgrounds = await backgroundColors(app, 'dark')
  expect(lightBackgrounds.some((color) => oneOf(color, darkBackgrounds))).toBe(false)
  for (const scheme of ['light', 'dark'] as const) {
    const backgrounds = scheme === 'light' ? lightBackgrounds : darkBackgrounds
    expect(oneOf(grounds[scheme].sidebar, backgrounds)).toBe(true)
    expect(oneOf(grounds[scheme].terminal, backgrounds)).toBe(true)
  }
  const drawnInLight: Record<string, Screenshot> = {}
  for (const appearance of PICKED) {
    const layout = await previewLayout(app, appearance)
    expect(layout.images).toBe(0)
    const shot = new Screenshot(await themePreview(app, appearance).screenshot())
    drawnInLight[appearance] = shot
    const wrong = groundPixels(layout, appearance, shot)
      .filter(({ x, y, scheme, part }) => !oneOf(shot.pixel(x, y), [grounds[scheme][part]]))
      .slice(0, 5)
      .map(({ x, y, scheme, part }) => `${x},${y} ${scheme} ${part}: ${shot.pixel(x, y).join(',')}`)
    expect(wrong, appearance).toEqual([])
    if (appearance === 'system') {
      expect(layout.drawings.map((drawing) => drawing.scheme)).toEqual(['light', 'dark'])
      continue
    }
    const [drawing] = layout.drawings
    expect(drawing!.scheme).toBe(appearance)
    const sidebarRows = drawing!.bars.filter((bar) => bar.box.right <= drawing!.sidebar.box.right)
    const terminalLines = drawing!.bars.filter((bar) => bar.box.left >= drawing!.terminal.box.left)
    expect(sidebarRows.length).toBeGreaterThanOrEqual(2)
    expect(terminalLines.length).toBeGreaterThanOrEqual(2)
    expect(drawing!.prompt.text).toMatch(/^\$ \S/)
    expect(drawing!.prompt.box.left).toBeGreaterThanOrEqual(drawing!.terminal.box.left)
    const differs = (color: string, ground: DrawnPart) =>
      rgb(color).some((value, index) => value !== rgb(ground.fill)[index])
    for (const row of sidebarRows) expect(differs(row.fill, drawing!.sidebar)).toBe(true)
    for (const line of terminalLines) expect(differs(line.fill, drawing!.terminal)).toBe(true)
    for (const fill of drawing!.prompt.fills) expect(differs(fill, drawing!.terminal)).toBe(true)
    // And they show: the middle of each bar is not the ground.
    const scale = shot.width / layout.width
    for (const [bar, ground] of [
      ...sidebarRows.map((row) => [row, grounds[appearance].sidebar] as const),
      ...terminalLines.map((line) => [line, grounds[appearance].terminal] as const),
    ]) {
      const middle = shot.pixel(
        Math.floor(((bar.box.left + bar.box.right) / 2) * scale),
        Math.floor(((bar.box.top + bar.box.bottom) / 2) * scale),
      )
      expect(oneOf(middle, [ground])).toBe(false)
    }
  }

  // 3: the previews draw the same in either appearance of the window.
  await app.setSystemAppearance('dark')
  await expectWindowIn(app, 'dark')
  for (const appearance of PICKED) {
    const shot = new Screenshot(await themePreview(app, appearance).screenshot())
    const before = drawnInLight[appearance]!
    expect([shot.width, shot.height]).toEqual([before.width, before.height])
    const corner = Math.ceil((DRAWING_CORNER * shot.width) / DRAWING_WIDTH)
    const changed: string[] = []
    // Not the outermost pixels, which the window's own background shows through in part.
    for (let y = 2; y < shot.height - 2; y++) {
      for (let x = 2; x < shot.width - 2; x++) {
        const inCorner =
          (x < corner || x >= shot.width - corner) && (y < corner || y >= shot.height - corner)
        // Anti-aliased edges may come out a few levels apart from one drawing to the next;
        // a color that changed with the window's appearance differs by far more.
        const apart = colorDifference(shot.pixel(x, y), before.pixel(x, y))
        if (!inCorner && apart > SAME_DRAWING_TOLERANCE && changed.length < 5) {
          changed.push(`${x},${y}: ${before.pixel(x, y).join(',')} → ${shot.pixel(x, y).join(',')}`)
        }
      }
    }
    expect(changed, appearance).toEqual([])
  }
  await app.setSystemAppearance('light')
  await expectWindowIn(app, 'light')

  // 4: the selected card, System's, has an outline; clicking Dark moves it there.
  await expectOutlined(app, 'system', 'light')
  await pickTheme(app, 'dark')
  await expectWindowIn(app, 'dark')
  await app.page.mouse.move(600, 760)
  await expectOutlined(app, 'dark', 'dark')
  await pickTheme(app, 'system')
  await expectWindowIn(app, 'light')
  await app.page.mouse.move(600, 760)

  // 5: no picture of any kind: the previews are drawn in the page.
  const pictures = await page.evaluate((element) => {
    const found: string[] = []
    const media = element.querySelectorAll(
      'img, picture, image, video, canvas, object, embed, iframe, foreignObject, use',
    )
    for (const item of Array.from(media)) found.push(item.tagName)
    for (const item of [element, ...Array.from(element.querySelectorAll('*'))]) {
      const style = getComputedStyle(item)
      for (const value of [
        style.backgroundImage,
        style.maskImage,
        style.borderImageSource,
        style.listStyleImage,
      ]) {
        if (value !== 'none') found.push(`${item.tagName}: ${value}`)
      }
      if (item.hasAttribute('href') || item.hasAttribute('xlink:href')) found.push(item.tagName)
    }
    return found
  })
  expect(pictures).toEqual([])

  // 6: Tab reaches a card; the arrow keys then pick the card beside it, if there is one.
  await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  expect(await focusedCard(app)).toBeNull()
  for (let presses = 0; presses < 10 && (await focusedCard(app)) === null; presses++) {
    await app.page.keyboard.press('Tab')
  }
  expect(await focusedCard(app)).toBe('system')
  for (const [key, expected] of [
    ['ArrowRight', 'light'],
    ['ArrowRight', 'dark'],
    ['ArrowRight', 'dark'],
    ['ArrowLeft', 'light'],
    ['ArrowLeft', 'system'],
    ['ArrowLeft', 'system'],
  ] as const) {
    await app.page.keyboard.press(key)
    await expect.poll(() => selectedTheme(app), key).toBe(expected)
    await expect.poll(() => app.themeSource(), key).toBe(expected)
    expect(await focusedCard(app)).toBe(expected)
  }

  // 7: in the smallest window, the cards and their names show in full, and nothing scrolls sideways.
  await app.resizeWindow(720, 480)
  const pageBox = await boxOf(page)
  for (const appearance of PICKED) {
    for (const shown of [
      await boxOf(themeCard(app, appearance)),
      await boxOf(themeCard(app, appearance).getByText(APPEARANCE_NAMES[appearance])),
    ]) {
      expect(shown.left).toBeGreaterThanOrEqual(pageBox.left)
      expect(shown.right).toBeLessThanOrEqual(Math.min(pageBox.right, 720))
    }
  }
  // No scroll container of the page, nor the page itself, has more to show sideways.
  const overflowing = await page.evaluate((element) =>
    [element, ...Array.from(element.querySelectorAll('*'))]
      .filter((item) => getComputedStyle(item).overflowX !== 'visible')
      .filter((item) => item.scrollWidth > item.clientWidth)
      .map((item) => `${item.tagName} ${item.scrollWidth} > ${item.clientWidth}`),
  )
  expect(overflowing).toEqual([])
  expect(
    await app.page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth),
  ).toBe(true)
})

test('picking Light or Dark changes everything at once, what macOS draws for Hoot included', async ({
  launch,
  world,
}) => {
  const { G } = world.repos
  const app = await launch({ projects: [G], systemAppearance: 'light' })
  await app.resizeWindow(1200, 780)
  const s1 = await app.startSession(G, 'shell')
  await app.waitForPrompt(20_000, s1)
  const s2 = await app.startSession(G, 'shell')
  await app.waitForPrompt(20_000, s2)
  await app.selectSession(s1)
  await pressSettingsShortcut(app)

  /** Checks 1–3: the settings, then the sidebar, the sessions and what opens over them. */
  const expectEverywhere = async (scheme: 'light' | 'dark') => {
    await expectSettingsIn(app, scheme)
    await app.backButton().click()
    await expectAppIn(app, scheme, s1, [s2])
    await app.page.keyboard.press('Meta+2')
    await expectAppIn(app, scheme, s2, [s1])
    await app.selectSession(s1)
    await expectOverlaysIn(app, scheme, s1, G)
    await pressSettingsShortcut(app)
  }

  // 1–3: Dark.
  await pickTheme(app, 'dark')
  expect(await app.themeSource()).toBe('dark')
  await expectEverywhere('dark')

  // 4: Light.
  await pickTheme(app, 'light')
  expect(await app.themeSource()).toBe('light')
  await expectEverywhere('light')

  // 5: System, while macOS is light.
  await pickTheme(app, 'system')
  expect(await app.themeSource()).toBe('system')
  await expectEverywhere('light')

  // 6: macOS turns dark, and Hoot with it; Light keeps it light.
  await app.setSystemAppearance('dark')
  await expectEverywhere('dark')
  await pickTheme(app, 'light')
  await expectEverywhere('light')
  await app.backButton().click()
  for (const id of [s1, s2])
    await expect(app.sessionItem(id)).toHaveAttribute('data-status', 'running')
})

test('System follows macOS while Hoot runs; Light and Dark stay as they are', async ({
  launch,
  world,
}) => {
  const { G } = world.repos
  const app = await launch({ projects: [G], systemAppearance: 'light' })
  await app.resizeWindow(1200, 780)
  const s1 = await app.startSession(G, 'shell')
  await app.waitForPrompt(20_000, s1)
  const s2 = await app.startSession(G, 'shell')
  await app.waitForPrompt(20_000, s2)
  await app.selectSession(s1)
  await expectAppIn(app, 'light', s1, [s2])

  // 1: System, macOS turning dark and back to light; the sessions run on.
  await app.setSystemAppearance('dark')
  await expectAppIn(app, 'dark', s1, [s2])
  await app.page.keyboard.press('Meta+2')
  await expectAppIn(app, 'dark', s2, [s1])
  await app.setSystemAppearance('light')
  await expectAppIn(app, 'light', s2, [s1])
  for (const id of [s1, s2])
    await expect(app.sessionItem(id)).toHaveAttribute('data-status', 'running')

  // 2 and 3: Light and Dark, macOS turning dark and back to light.
  for (const picked of ['light', 'dark'] as const) {
    await pressSettingsShortcut(app)
    await pickTheme(app, picked)
    await app.backButton().click()
    for (const system of ['light', 'dark', 'light'] as const) {
      await app.setSystemAppearance(system)
      await app.page.waitForTimeout(300)
      await expectAppIn(app, picked, s2, [s1])
      expect(await app.effectiveAppearance()).toBe(picked)
      expect(await app.themeSource()).toBe(picked)
    }
  }
  for (const id of [s1, s2])
    await expect(app.sessionItem(id)).toHaveAttribute('data-status', 'running')
})

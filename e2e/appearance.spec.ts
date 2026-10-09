import Color from 'colorjs.io'
import { PNG } from 'pngjs'
import type { AppDriver } from './support/app'
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

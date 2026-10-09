import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  DARK_ANSI_COLORS,
  LIGHT_ANSI_COLORS,
  darkTheme,
  lightTheme,
} from '../src/renderer/terminal/themes'
import type { AppDriver, LaunchOptions } from './support/app'
import {
  BLOCK_ELEMENTS,
  BLOCK_FILLS,
  blockPixelPlacement,
  cellRect,
  colorDifference,
  isBetween,
  rgb,
  sameColor,
  Screenshot,
  type GridPixels,
  type PixelRect,
  type Rgb,
} from './support/pixels'
import { writeProgram } from './support/programs'
import { expect, test } from './support/test'
import type { World } from './support/world'

type Appearance = 'dark' | 'light'

const APPEARANCES: readonly Appearance[] = ['dark', 'light']

const CLAUDE_ORANGE: Rgb = [215, 119, 87]
const BLACK: Rgb = [0, 0, 0]

/** Claude Code's mascot, every block element, and two rows of full blocks one above the other. */
const BLOCK_PATTERN = [' ▐▛███▜▌ ', '▝▜█████▛▘', '  ▘▘ ▝▝  ', BLOCK_ELEMENTS, '██████', '██████']

/** Box drawing lines of each weight, joined in straight lines, corners, T-junctions and crossings. */
const BOX_PATTERN = [
  '╭────┬────╮',
  '│    │    │',
  '├────┼────┤',
  '│    │    │',
  '╰────┴────╯',
  '┌──┐ ═══ ║ ┃',
  '└──┘ ━━━ ║ ┃',
]

/** The default colors and the 16 colors of an appearance. */
function colorsOf(appearance: Appearance): { background: Rgb; foreground: Rgb; ansi: Rgb[] } {
  const theme = appearance === 'dark' ? darkTheme : lightTheme
  const ansi = appearance === 'dark' ? DARK_ANSI_COLORS : LIGHT_ANSI_COLORS
  return {
    background: rgb(theme.background!),
    foreground: rgb(theme.foreground!),
    ansi: ansi.map(rgb),
  }
}

/**
 * Launches Hoot with project G in its list. Added before the launch, the
 * project brings no message over the terminal, which would hide some pixels.
 */
async function launchWithProject(
  launch: (options?: LaunchOptions) => Promise<AppDriver>,
  world: World,
  options: LaunchOptions = {},
): Promise<AppDriver> {
  return launch({ ...options, projects: [world.repos.G] })
}

/** Starts a Shell session in project G, adding the project first if needed. */
async function startShell(app: AppDriver): Promise<string> {
  const { G } = app.world.repos
  if ((await app.projectItems().count()) === 0) {
    await app.addProject(G)
    await expect(app.projectItems()).toHaveCount(1)
  }
  const id = await app.startSession(G, 'shell')
  await expect(app.session()).toHaveAttribute('data-status', 'running')
  await app.waitForPrompt()
  return id
}

/** `text` in a 24-bit foreground and background color. */
function inColors(text: string, foreground: Rgb, background: Rgb): string {
  return `\x1b[38;2;${foreground.join(';')};48;2;${background.join(';')}m${text}\x1b[0m`
}

/** The viewport row at which a buffer line is shown. */
async function viewportRow(app: AppDriver, bufferLine: number): Promise<number> {
  return bufferLine - (await app.viewportY())
}

/**
 * The pixels of the block elements among `lines`, shown from viewport row
 * `firstRow`, that are not the color their place in the cell calls for: the
 * foreground color entirely inside the part the character fills, the
 * background color entirely outside it.
 */
function blockPixelErrors(
  shot: Screenshot,
  grid: GridPixels,
  firstRow: number,
  lines: readonly string[],
  foreground: Rgb,
  background: Rgb,
): string[] {
  const errors: string[] = []
  lines.forEach((line, lineIndex) => {
    Array.from(line).forEach((char, column) => {
      if (!(char in BLOCK_FILLS)) return
      const cell = cellRect(grid, firstRow + lineIndex, column)
      for (const { x, y, color } of shot.pixels(cell)) {
        const placement = blockPixelPlacement(char, x - cell.x, y - cell.y, cell.width, cell.height)
        const expected = { inside: foreground, outside: background, edge: null }[placement]
        if (expected && !sameColor(color, expected)) {
          errors.push(
            `${char} (line ${lineIndex + 1}, column ${column + 1}) pixel ${x - cell.x},${y - cell.y} is ${color.join(',')}, not ${expected.join(',')}`,
          )
        }
      }
    })
  })
  return errors
}

/** Checks that the block elements of `lines` are drawn exactly (reporting a few errors at most). */
async function expectExactBlocks(
  app: AppDriver,
  firstLine: number,
  lines: readonly string[],
  foreground: Rgb,
  background: Rgb,
): Promise<void> {
  await expect
    .poll(async () => {
      const shot = await app.screenshot()
      const grid = await app.gridPixels()
      const firstRow = await viewportRow(app, firstLine)
      return blockPixelErrors(shot, grid, firstRow, lines, foreground, background).slice(0, 5)
    })
    .toEqual([])
}

/** Box drawing characters with a line from the middle of the cell to each edge, by weight. */
const LINE_TO = {
  right: { light: '─┬┼┴╭╰├┌└', heavy: '━', double: '═' },
  left: { light: '─┬┼┴╮╯┤┐┘', heavy: '━', double: '═' },
  down: { light: '│├┤┼┬╭╮┌┐', heavy: '┃', double: '║' },
  up: { light: '│├┤┼┴╰╯└┘', heavy: '┃', double: '║' },
} as const

type Weight = 'light' | 'heavy' | 'double'

const STRAIGHT = {
  horizontal: { light: '─', heavy: '━', double: '═' },
  vertical: { light: '│', heavy: '┃', double: '║' },
} as const

function lineWeight(char: string, edge: keyof typeof LINE_TO): Weight | null {
  const weights = Object.entries(LINE_TO[edge]) as Array<[Weight, string]>
  return weights.find(([, chars]) => chars.includes(char))?.[0] ?? null
}

/**
 * The joints of `lines` where the lines of two neighboring cells meet, and
 * at each one the pixels that are not as distinct from the background as the
 * rule requires: the pixel positions where the cross-section of a straight
 * line of the same weight, through the middle of its own cell, has the line
 * color must differ from the background, in one pixel on each side of the
 * cells' boundary, by at least half of what the line color does.
 */
function boxJointErrors(
  shot: Screenshot,
  grid: GridPixels,
  firstRow: number,
  lines: readonly string[],
  line: Rgb,
  background: Rgb,
): { joints: number; errors: string[] } {
  const chars = lines.map((text) => Array.from(text))
  const find = (char: string) => {
    const row = chars.findIndex((cells) => cells.includes(char))
    return cellRect(grid, firstRow + row, chars[row]!.indexOf(char))
  }
  const required = colorDifference(line, background) / 2
  const distinct = (x: number, y: number) =>
    colorDifference(shot.pixel(x, y), background) >= required
  /** Offsets across a straight line, through the middle of its cell, where it has the line color. */
  const crossSection = (char: string, direction: 'horizontal' | 'vertical'): number[] => {
    const cell = find(char)
    const offsets: number[] = []
    if (direction === 'horizontal') {
      const x = cell.x + Math.floor(cell.width / 2)
      for (let y = 0; y < cell.height; y++) {
        if (sameColor(shot.pixel(x, cell.y + y), line)) offsets.push(y)
      }
    } else {
      const y = cell.y + Math.floor(cell.height / 2)
      for (let x = 0; x < cell.width; x++) {
        if (sameColor(shot.pixel(cell.x + x, y), line)) offsets.push(x)
      }
    }
    if (offsets.length === 0) throw new Error(`${char} has no pixel in the line color`)
    return offsets
  }

  let joints = 0
  const errors: string[] = []
  chars.forEach((cells, row) => {
    cells.forEach((char, column) => {
      const cell = cellRect(grid, firstRow + row, column)
      const rightWeight = lineWeight(char, 'right')
      if (rightWeight && rightWeight === lineWeight(cells[column + 1] ?? '', 'left')) {
        joints++
        const boundary = cell.x + cell.width
        for (const offset of crossSection(STRAIGHT.horizontal[rightWeight], 'horizontal')) {
          for (const x of [boundary - 1, boundary]) {
            if (!distinct(x, cell.y + offset)) {
              errors.push(
                `${char}${cells[column + 1]} (line ${row + 1}) at ${x - boundary},${offset}`,
              )
            }
          }
        }
      }
      const downWeight = lineWeight(char, 'down')
      if (downWeight && downWeight === lineWeight(chars[row + 1]?.[column] ?? '', 'up')) {
        joints++
        const boundary = cell.y + cell.height
        for (const offset of crossSection(STRAIGHT.vertical[downWeight], 'vertical')) {
          for (const y of [boundary - 1, boundary]) {
            if (!distinct(cell.x + offset, y)) {
              errors.push(
                `${char} over ${chars[row + 1]![column]} (column ${column + 1}) at ${offset},${y - boundary}`,
              )
            }
          }
        }
      }
    })
  })
  return { joints, errors }
}

/** The physical pixels of the span of cells a buffer line's characters take, by character. */
async function characterCells(
  app: AppDriver,
  bufferLine: number,
): Promise<Array<{ chars: string; rect: PixelRect }>> {
  const grid = await app.gridPixels()
  const row = await viewportRow(app, bufferLine)
  const cells = await app.page.evaluate((index) => {
    const line = window.hootTestHooks!.terminal!.buffer.active.getLine(index)!
    const found: Array<{ chars: string; column: number; width: number }> = []
    for (let column = 0; column < line.length; column++) {
      const cell = line.getCell(column)!
      if (cell.getChars() !== '' && cell.getChars() !== ' ') {
        found.push({ chars: cell.getChars(), column, width: cell.getWidth() })
      }
    }
    return found
  }, bufferLine)
  return cells.map(({ chars, column, width }) => {
    const first = cellRect(grid, row, column)
    return { chars, rect: { ...first, width: first.width * width } }
  })
}

/** Whether any pixel of the rectangle differs from `color`. */
function hasPixelOtherThan(shot: Screenshot, rect: PixelRect, color: Rgb): boolean {
  for (const pixel of shot.pixels(rect)) if (!sameColor(pixel.color, color)) return true
  return false
}

/** Waits until the current terminal shows the background color of an appearance. */
async function expectAppearance(app: AppDriver, appearance: Appearance): Promise<void> {
  const { background } = colorsOf(appearance)
  await expect
    .poll(async () => {
      const shot = await app.screenshot()
      const { cols, rows } = await app.terminalSize()
      // The last cell of the grid, which the tests leave empty.
      return shot.middle(cellRect(await app.gridPixels(), rows - 1, cols - 1))
    })
    .toEqual(background)
}

test.describe('block elements and box drawing', () => {
  for (const scale of [1, 2] as const) {
    test(`block elements fill exactly their part of the cell, in both appearances (device pixel ratio ${scale})`, async ({
      launch,
      world,
    }) => {
      const app = await launchWithProject(launch, world, { deviceScaleFactor: scale })
      await startShell(app)
      expect((await app.gridPixels()).scale).toBe(scale)
      for (const appearance of APPEARANCES) {
        await app.setSystemAppearance(appearance)
        await expectAppearance(app, appearance)
        const first = await app.printLines(
          BLOCK_PATTERN.map((line) => inColors(line, CLAUDE_ORANGE, BLACK)),
        )
        await expectExactBlocks(app, first, BLOCK_PATTERN, CLAUDE_ORANGE, BLACK)
        // Drawn by the WebGL renderer, not the DOM renderer.
        expect(await app.webglCanvases()).toBe(1)
        await expect(app.domRendererRows()).toHaveCount(0)
      }
    })

    test(`box drawing lines join their neighbors without gaps, in both appearances (device pixel ratio ${scale})`, async ({
      launch,
      world,
    }) => {
      const app = await launchWithProject(launch, world, { deviceScaleFactor: scale })
      await startShell(app)
      const first = await app.printLines(BOX_PATTERN)
      for (const appearance of APPEARANCES) {
        await app.setSystemAppearance(appearance)
        await expectAppearance(app, appearance)
        const { foreground, background } = colorsOf(appearance)
        const shot = await app.screenshot()
        const { joints, errors } = boxJointErrors(
          shot,
          await app.gridPixels(),
          await viewportRow(app, first),
          BOX_PATTERN,
          foreground,
          background,
        )
        expect(joints).toBe(56)
        expect(errors).toEqual([])
      }
    })
  }
})

test('the terminal font is Geist Mono at 14 pixels without extra line spacing, and other fonts fill in', async ({
  launch,
  world,
}) => {
  const app = await launchWithProject(launch, world, { deviceScaleFactor: 2 })
  await app.setSystemAppearance('dark')
  await startShell(app)
  const options = await app.page.evaluate(() => {
    const { fontFamily, fontSize, lineHeight } = window.hootTestHooks!.terminal!.options
    return { fontFamily, fontSize, lineHeight }
  })
  expect(options.fontFamily?.split(',')[0]).toBe('"Geist Mono Variable"')
  expect(options.fontSize).toBe(14)
  expect(options.lineHeight).toBe(1)

  // Geist Mono is loaded, from Hoot's own files.
  const faces = await app.page.evaluate(() => {
    const loaded = Array.from(document.fonts)
      .filter((face) => face.family.replaceAll('"', '') === 'Geist Mono Variable')
      .map((face) => face.status)
    const sources: string[] = []
    for (const sheet of Array.from(document.styleSheets)) {
      for (const rule of Array.from(sheet.cssRules)) {
        if (!(rule instanceof CSSFontFaceRule)) continue
        if (
          rule.style.getPropertyValue('font-family').replaceAll(/["']/g, '') !==
          'Geist Mono Variable'
        )
          continue
        for (const match of rule.style.getPropertyValue('src').matchAll(/url\("?([^")]+)"?\)/g)) {
          sources.push(new URL(match[1]!, sheet.href ?? document.baseURI).href)
        }
      }
    }
    return { loaded, sources }
  })
  expect(faces.loaded.length).toBeGreaterThan(0)
  expect(faces.loaded.every((status) => status === 'loaded')).toBe(true)
  expect(faces.sources.length).toBe(faces.loaded.length)
  for (const source of faces.sources) {
    expect(source).toMatch(/^file:\/\//)
    expect(fs.existsSync(new URL(source))).toBe(true)
  }

  // Characters Geist Mono does not have are drawn with other fonts.
  const { background } = colorsOf('dark')
  const command = "printf '中文😀\\n'"
  await app.run(command)
  let shot = await app.screenshot()
  const wide = await characterCells(app, await app.outputStart(command))
  expect(wide.map((cell) => cell.chars)).toEqual(['中', '文', '😀'])
  for (const cell of wide)
    expect(hasPixelOtherThan(shot, cell.rect, background), cell.chars).toBe(true)

  // A Nerd Font symbol font, when installed, draws the icons of the Private Use Area.
  const nerdFontInstalled = await app.page.evaluate(() => {
    const draw = (family: string) => {
      const canvas = new OffscreenCanvas(64, 64)
      const context = canvas.getContext('2d')!
      context.font = `32px ${family}`
      context.fillText('\uf07b', 8, 48)
      return context.getImageData(0, 0, 64, 64).data.join()
    }
    const without = draw('"Hoot No Such Font"')
    return ['"Symbols Nerd Font Mono"', '"JetBrainsMono Nerd Font Mono"', '"MesloLGS NF"'].some(
      (family) => draw(`${family}, "Hoot No Such Font"`) !== without,
    )
  })
  const installedFiles = ['/Library/Fonts', path.join(os.homedir(), 'Library/Fonts')].flatMap(
    (directory) => (fs.existsSync(directory) ? fs.readdirSync(directory) : []),
  )
  expect(nerdFontInstalled).toBe(
    installedFiles.some((file) =>
      /^(SymbolsNerdFontMono|JetBrainsMonoNerdFontMono|MesloLGS ?NF)/.test(file),
    ),
  )
  if (nerdFontInstalled) {
    const icon = "printf '\\uf07b\\n'"
    await app.run(icon)
    shot = await app.screenshot()
    const [cell] = await characterCells(app, await app.outputStart(icon))
    expect(cell?.chars).toBe('\uf07b')
    expect(hasPixelOtherThan(shot, cell!.rect, background)).toBe(true)
  }
})

test('the 16 colors and the default colors follow the appearance, also for sessions not shown', async ({
  launch,
  world,
}) => {
  const app = await launchWithProject(launch, world)
  await app.setSystemAppearance('dark')
  const first = await startShell(app)
  const blocks = Array.from({ length: 16 }, (_, index) => {
    const sgr = index < 8 ? 40 + index : 100 + index - 8
    return `\x1b[${sgr}m    \x1b[0m`
  })
  const line = await app.printLines([`${blocks.join('')}██`])

  const expectColors = async (appearance: Appearance) => {
    const { background, foreground, ansi } = colorsOf(appearance)
    await expectAppearance(app, appearance)
    const shot = await app.screenshot()
    const grid = await app.gridPixels()
    const row = await viewportRow(app, line)
    // The middle of each 4-cell block, then of the two full blocks.
    ansi.forEach((color, index) => {
      const block = cellRect(grid, row, index * 4)
      expect(shot.middle({ ...block, width: block.width * 4 }), `color ${index}`).toEqual(color)
    })
    const defaultBlocks = cellRect(grid, row, 64)
    expect(shot.middle({ ...defaultBlocks, width: defaultBlocks.width * 2 })).toEqual(foreground)
    // Cells without content.
    const terminalRows = (await app.terminalSize()).rows
    for (const [emptyRow, column] of [
      [row, 70],
      [terminalRows - 1, 40],
    ] as const) {
      const empty = cellRect(grid, emptyRow, column)
      expect(hasPixelOtherThan(shot, empty, background), `empty cell ${emptyRow},${column}`).toBe(
        false,
      )
    }
    // The interface's background and foreground colors.
    const interfaceColors = await app.page.evaluate(() => {
      const style = getComputedStyle(document.documentElement)
      return [style.getPropertyValue('--background'), style.getPropertyValue('--foreground')]
    })
    expect(interfaceColors.map(rgb)).toEqual([background, foreground])
  }

  await expectColors('dark')
  await app.setSystemAppearance('light')
  await expectColors('light')

  // A session that is not shown while the appearance changes.
  await startShell(app)
  await app.setSystemAppearance('dark')
  await expectAppearance(app, 'dark')
  await app.selectSession(first)
  await expectColors('dark')
})

for (const appearance of APPEARANCES) {
  test(`the cursor is a blinking block, the selection swaps the default colors and bold keeps its color (${appearance})`, async ({
    launch,
    world,
  }) => {
    const app = await launchWithProject(launch, world, { deviceScaleFactor: 2 })
    await app.setSystemAppearance(appearance)
    await startShell(app)
    await expectAppearance(app, appearance)
    const { background, foreground, ansi } = colorsOf(appearance)

    /** The cursor's cell, sampled for two seconds. */
    const sampleCursor = async (): Promise<Screenshot[]> => {
      const { cursorX, cursorY } = await app.page.evaluate(() => {
        const buffer = window.hootTestHooks!.terminal!.buffer.active
        return { cursorX: buffer.cursorX, cursorY: buffer.cursorY }
      })
      const cell = await app.cellBox(cursorY, cursorX)
      const shots: Screenshot[] = []
      const end = Date.now() + 2_000
      while (Date.now() < end) {
        shots.push(new Screenshot(await app.page.screenshot({ clip: cell })))
        await app.page.waitForTimeout(100)
      }
      return shots
    }
    const corners = (shot: Screenshot): Rgb[] => [
      shot.pixel(0, 0),
      shot.pixel(shot.width - 1, 0),
      shot.pixel(0, shot.height - 1),
      shot.pixel(shot.width - 1, shot.height - 1),
    ]
    const expectBlinkingBlockOnCharacter = async () => {
      await app.type('ab')
      await app.page.keyboard.press('ArrowLeft')
      await expect.poll(() => app.cursorLine()).toBe(`${app.world.prompt}ab`)
      const shots = await sampleCursor()
      const shown = shots.filter((shot) =>
        corners(shot).every((color) => sameColor(color, foreground)),
      )
      const hidden = shots.filter((shot) =>
        corners(shot).every((color) => sameColor(color, background)),
      )
      // Every sample shows the cursor or not, and both happen.
      expect(shown.length + hidden.length).toBe(shots.length)
      expect(shown.length).toBeGreaterThan(0)
      expect(hidden.length).toBeGreaterThan(0)
      for (const shot of shown) {
        const others = [...shot.pixels({ x: 0, y: 0, width: shot.width, height: shot.height })]
          .map((pixel) => pixel.color)
          .filter((color) => !sameColor(color, foreground))
        // The character under the cursor, in the background color.
        expect(others.every((color) => isBetween(color, foreground, background))).toBe(true)
        expect(others.some((color) => sameColor(color, background))).toBe(true)
      }
      await app.page.keyboard.press('Control+U')
    }

    await app.focusTerminal()
    await expectBlinkingBlockOnCharacter()

    // A program sets a bar cursor, then the default style again.
    await app.run("printf '\\e[6 q'")
    for (const shot of await sampleCursor()) {
      const [, topRight, , bottomRight] = corners(shot)
      expect(sameColor(topRight!, foreground) || sameColor(bottomRight!, foreground)).toBe(false)
    }
    await app.run("printf '\\e[0 q'")
    await expectBlinkingBlockOnCharacter()

    // A selection made with the mouse.
    await app.run('echo hello')
    const helloLine = await app.outputStart('echo hello')
    const row = await viewportRow(app, helloLine)
    const grid = await app.gridPixels()
    const letters = Array.from({ length: 5 }, (_, column) => cellRect(grid, row, column))
    // The pixels of each letter's glyph, and those next to them: the glyph
    // can cover slightly different pixels in other colors.
    const before = await app.screenshot()
    const nearGlyphs = letters.map((cell) => {
      const near = new Set<string>()
      for (const pixel of before.pixels(cell)) {
        if (sameColor(pixel.color, background)) continue
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) near.add(`${pixel.x + dx},${pixel.y + dy}`)
        }
      }
      return near
    })
    const firstBox = await app.cellBox(row, 0)
    const lastBox = await app.cellBox(row, 4)
    await app.page.mouse.move(firstBox.x + 1, firstBox.y + firstBox.height / 2)
    await app.page.mouse.down()
    await app.page.mouse.move(lastBox.x + lastBox.width - 1, lastBox.y + lastBox.height / 2, {
      steps: 5,
    })
    await app.page.mouse.up()
    await expect
      .poll(() => app.page.evaluate(() => window.hootTestHooks!.terminal!.getSelection()))
      .toBe('hello')
    await expect
      .poll(async () => {
        const selected = await app.screenshot()
        return letters.map((cell, index) => {
          const pixels = [...selected.pixels(cell)]
          const away = pixels.filter((pixel) => !nearGlyphs[index]!.has(`${pixel.x},${pixel.y}`))
          return (
            // The selection's own color is the default foreground color, and the
            // glyph is drawn in the default background color.
            away.every((pixel) => sameColor(pixel.color, foreground)) &&
            pixels.every((pixel) => isBetween(pixel.color, foreground, background)) &&
            pixels.some((pixel) => sameColor(pixel.color, background))
          )
        })
      })
      .toEqual([true, true, true, true, true])

    // Bold text in colors 0–7 keeps its color.
    const pairs = Array.from(
      { length: 8 },
      (_, index) => `\x1b[3${index}m█\x1b[0m\x1b[1;3${index}m█\x1b[0m`,
    )
    const pairLine = await app.printLines([pairs.join(' ')])
    const shot = await app.screenshot()
    const pairRow = await viewportRow(app, pairLine)
    ansi.slice(0, 8).forEach((color, index) => {
      const normal = shot.middle(cellRect(grid, pairRow, index * 3))
      const bold = shot.middle(cellRect(grid, pairRow, index * 3 + 1))
      expect(normal, `color ${index}`).toEqual(color)
      expect(bold, `bold color ${index}`).toEqual(color)
    })
  })
}

test('the scrollbar is a thin rounded slider that shows only while it is needed and used', async ({
  launch,
  world,
}) => {
  const app = await launchWithProject(launch, world, { deviceScaleFactor: 2 })
  await app.setSystemAppearance('dark')
  await startShell(app)
  const { foreground, background } = colorsOf('dark')
  await app.run('seq 1 200')
  const scrollbar = app.page.locator(
    '[data-testid="terminal"] .xterm-scrollable-element > .xterm-scrollbar.xterm-vertical',
  )
  const slider = scrollbar.locator('.xterm-slider')
  const visible = async () =>
    scrollbar.evaluate(
      (element) =>
        element.classList.contains('xterm-visible') && getComputedStyle(element).opacity === '1',
    )
  const hidden = async () =>
    scrollbar.evaluate(
      (element) =>
        element.classList.contains('xterm-invisible') && getComputedStyle(element).opacity === '0',
    )
  const screen = (await app.page.locator('[data-testid="terminal"] .xterm-screen').boundingBox())!
  const sidebar = (await app.page.locator('[data-slot="sidebar"]').boundingBox())!

  // Pointing at the grid shows it.
  await app.page.mouse.move(sidebar.x + 10, sidebar.y + sidebar.height - 100)
  await expect.poll(hidden, { timeout: 5_000 }).toBe(true)
  await app.page.mouse.move(screen.x + screen.width / 2, screen.y + screen.height / 2)
  await expect.poll(visible).toBe(true)
  const style = await slider.evaluate((element) => {
    const computed = getComputedStyle(element)
    return { background: computed.backgroundColor, radius: computed.borderTopLeftRadius }
  })
  const box = (await slider.boundingBox())!
  const shot = await app.screenshot()
  const scale = (await app.gridPixels()).scale
  const middle = Math.round((box.y + box.height / 2) * scale)
  let opaque = 0
  for (
    let x = Math.round((box.x - 4) * scale);
    x < Math.round((box.x + box.width + 4) * scale);
    x++
  ) {
    if (!sameColor(shot.pixel(x, middle), background)) opaque++
  }
  const width = opaque / scale
  expect(width).toBeGreaterThanOrEqual(4)
  expect(width).toBeLessThanOrEqual(8)
  expect(Number.parseFloat(style.radius)).toBeGreaterThanOrEqual(width / 2)
  const [red, green, blue, alpha] = style.background
    .match(/[\d.]+/g)!
    .map((value) => Number.parseFloat(value))
  expect([red, green, blue]).toEqual([...foreground])
  expect(alpha).toBeGreaterThan(0)
  expect(alpha).toBeLessThan(1)

  // It fades out once the pointer has left and stays away.
  await app.page.mouse.move(sidebar.x + 10, sidebar.y + sidebar.height - 100)
  await app.page.waitForTimeout(2_000)
  expect(await hidden()).toBe(true)

  // Scrolling with the wheel over the terminal shows it while it scrolls.
  await app.page.mouse.move(screen.x + screen.width / 2, screen.y + screen.height / 2)
  await expect.poll(visible).toBe(true)
  const bottom = await app.viewportY()
  await app.page.mouse.wheel(0, -200)
  expect(await visible()).toBe(true)
  await expect.poll(() => app.viewportY()).toBeLessThan(bottom)
  expect(await visible()).toBe(true)

  // Dragging the slider to the top shows the oldest lines kept.
  const thumb = (await slider.boundingBox())!
  await app.page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2)
  await app.page.mouse.down()
  await app.page.mouse.move(thumb.x + thumb.width / 2, screen.y - 100, { steps: 10 })
  await app.page.mouse.up()
  await expect.poll(() => app.viewportY()).toBe(0)
  const oldest = await app.page.evaluate(() =>
    window.hootTestHooks!.terminal!.buffer.active.getLine(0)!.translateToString(true),
  )
  expect((await app.visibleRows())[0]).toBe(oldest)
  expect(oldest).toBe(`${app.world.prompt}seq 1 200`.trimEnd())

  // The only scrollbar in the terminal area is the terminal's own vertical one.
  await app.page.mouse.move(screen.x + screen.width / 2, screen.y + screen.height / 2)
  await expect.poll(visible).toBe(true)
  const scrollbars = await app.page.evaluate(() => {
    const area = document.querySelector('[data-testid="terminal-area"]')!
    const native = [area, ...Array.from(area.querySelectorAll('*'))].filter((element) => {
      if (!(element instanceof HTMLElement)) return false
      const computed = getComputedStyle(element)
      const borders = (sides: string[]) =>
        sides.reduce(
          (sum, side) => sum + Number.parseFloat(computed.getPropertyValue(`border-${side}-width`)),
          0,
        )
      return (
        element.offsetWidth - element.clientWidth - borders(['left', 'right']) > 0 ||
        element.offsetHeight - element.clientHeight - borders(['top', 'bottom']) > 0
      )
    })
    const shown = Array.from(area.querySelectorAll('.xterm-scrollbar')).filter(
      (element) => getComputedStyle(element).opacity !== '0',
    )
    return {
      native: native.map((element) => element.className),
      shown: shown.map(
        (element) =>
          `${element.parentElement!.classList.contains('xterm-scrollable-element')} ${element.className}`,
      ),
    }
  })
  expect(scrollbars.native).toEqual([])
  expect(scrollbars.shown).toEqual(['true xterm-visible xterm-scrollbar xterm-vertical'])

  // Without lines to scroll back to, it does not show.
  await app.run("clear && printf '\\e[3J'")
  await expect
    .poll(() => app.page.evaluate(() => window.hootTestHooks!.terminal!.buffer.active.baseY))
    .toBe(0)
  await app.page.mouse.move(sidebar.x + 10, sidebar.y + sidebar.height - 100)
  await app.page.mouse.move(screen.x + screen.width / 2, screen.y + screen.height / 2)
  await app.page.waitForTimeout(500)
  expect(await hidden()).toBe(true)
})

test('the grid keeps its distance from the edges of the main area', async ({ app }) => {
  await startShell(app)
  await app.run('seq 1 100')
  for (const [width, height] of [
    [1200, 780],
    [720, 480],
  ] as const) {
    await app.resizeWindow(width, height)
    for (const state of ['expanded', 'collapsed'] as const) {
      if ((await app.sidebarState()) !== state) await app.page.keyboard.press('Meta+b')
      await app.expectSidebar(state)
      // Wait until the grid has been fitted to the new size.
      await expect
        .poll(async () => {
          const geometry = await app.terminalGeometry()
          const size = await app.terminalSize()
          const slack =
            geometry.areaWidth - geometry.scrollbarWidth - size.cols * geometry.cellWidth
          return slack >= 0 && slack < geometry.cellWidth
        })
        .toBe(true)
      const screen = app.page.locator('[data-testid="terminal"] .xterm-screen')
      const box = (await screen.boundingBox())!
      await app.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      const scrollbar = app.page.locator(
        '[data-testid="terminal"] .xterm-scrollbar.xterm-vertical.xterm-visible',
      )
      await expect(scrollbar).toHaveCount(1)
      const edges = await app.page.evaluate(() => {
        const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect()
        return {
          main: rect('[data-slot="sidebar-inset"]').toJSON() as DOMRect,
          header: rect('[data-testid="session"] header').toJSON() as DOMRect,
          grid: rect('[data-testid="terminal"] .xterm-screen').toJSON() as DOMRect,
          scrollbar: rect(
            '[data-testid="terminal"] .xterm-scrollbar.xterm-vertical',
          ).toJSON() as DOMRect,
          scale: window.devicePixelRatio,
        }
      })
      const { cellWidth, cellHeight } = await app.terminalGeometry()
      const { main, header, grid, scrollbar: bar, scale } = edges
      const tolerance = 1 / scale
      expect(main.left).toBe(state === 'expanded' ? 288 : 0)
      expect(Math.abs(grid.left - main.left - 14)).toBeLessThan(tolerance)
      expect(Math.abs(grid.top - header.bottom - 12)).toBeLessThan(tolerance)
      expect(Math.abs(main.right - bar.right - 6)).toBeLessThan(tolerance)
      expect(main.bottom - grid.bottom).toBeGreaterThan(12 - tolerance)
      expect(main.bottom - grid.bottom).toBeLessThan(12 + cellHeight)
      expect(bar.left - grid.right).toBeGreaterThan(-tolerance)
      expect(bar.left - grid.right).toBeLessThan(cellWidth)
    }
  }
})

test('the grid keeps its distance from the bar of a session that has ended', async ({ app }) => {
  for (const [width, height] of [
    [1200, 780],
    [720, 480],
  ] as const) {
    await app.setWindowSize(width, height)
    await expect.poll(() => app.page.evaluate(() => window.innerWidth)).toBe(width)
    await startShell(app)
    await app.run('seq 1 100')
    // A process that exits with an error keeps its session, with a bar below the terminal.
    await app.run('exit 3', { waitForPrompt: false })
    const bar = app.page.getByTestId('session-ended')
    await expect(bar).toBeVisible()
    await expect(bar.getByTestId('session-exit-message')).toHaveText('Process exited with code 3.')
    await expect(bar.getByRole('button', { name: 'Close' })).toBeVisible()
    // A line along its top separates it from the terminal.
    expect(
      await bar.evaluate((element) => {
        const style = getComputedStyle(element)
        return [style.borderTopWidth, style.borderTopStyle]
      }),
    ).toEqual(['1px', 'solid'])
    const gap = () =>
      app.page.evaluate(() => {
        const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect()
        return (
          rect('[data-testid="session-ended"]').top -
          rect('[data-testid="terminal"] .xterm-screen').bottom
        )
      })
    const tolerance = 1 / (await app.page.evaluate(() => window.devicePixelRatio))
    for (const state of ['expanded', 'collapsed'] as const) {
      if ((await app.sidebarState()) !== state) await app.page.keyboard.press('Meta+b')
      await app.expectSidebar(state)
      // Once the grid has been fitted to the area left above the bar.
      await expect.poll(gap).toBeGreaterThan(12 - tolerance)
      const { cellHeight } = await app.terminalGeometry()
      expect(await gap()).toBeLessThan(12 + cellHeight)
    }
    // Sessions start from the sidebar.
    await app.page.keyboard.press('Meta+b')
    await app.expectSidebar('expanded')
  }
})

test('only the shown terminal draws with WebGL, however many sessions there are', async ({
  launch,
  world,
}) => {
  const app = await launchWithProject(launch, world, { deviceScaleFactor: 2 })
  await app.setSystemAppearance('dark')
  /** Checks that at most one terminal has a WebGL canvas, the current one. */
  const expectWebglOnlyInCurrent = async () => {
    const ids = await app.sessionIds()
    const current = await app.sessionId()
    const counts = await app.webglCanvasesOf(ids)
    const drawing = ids.filter((id) => counts[id]! > 0)
    expect(drawing).toEqual([current])
    expect(counts[current]).toBe(1)
  }
  const sessions: string[] = []
  for (let index = 0; index < 20; index++) {
    sessions.push(await startShell(app))
    await expectWebglOnlyInCurrent()
  }
  await app.selectSession(sessions[0]!)
  await expectWebglOnlyInCurrent()
  await app.waitForPrompt()
  const first = await app.printLines(
    BLOCK_PATTERN.map((line) => inColors(line, CLAUDE_ORANGE, BLACK)),
  )
  await expectExactBlocks(app, first, BLOCK_PATTERN, CLAUDE_ORANGE, BLACK)
  await expect(app.domRendererRows()).toHaveCount(0)
})

test.describe('without WebGL', () => {
  test('a terminal whose WebGL context is lost goes on with the DOM renderer', async ({ app }) => {
    await startShell(app)
    await app.run('echo before-loss')
    expect(await app.webglCanvases()).toBe(1)
    await app.page.evaluate(() => {
      const element = window.hootTestHooks!.terminal!.element!
      for (const canvas of Array.from(element.querySelectorAll('.xterm-screen canvas'))) {
        const context = (canvas as HTMLCanvasElement).getContext('webgl2')
        context?.getExtension('WEBGL_lose_context')?.loseContext()
      }
    })
    // At once, not after the few seconds xterm.js would wait for the context to come back.
    await expect(app.domRendererRows()).toHaveCount(1, { timeout: 2_000 })
    await expect(app.domRendererRows()).toContainText('before-loss')
    await app.run('echo after-loss')
    expect(await app.outputOf('echo after-loss')).toEqual(['after-loss'])
    await expect(app.domRendererRows()).toContainText('before-loss')
    await expect(app.domRendererRows()).toContainText('after-loss')
    expect(await app.webglCanvases()).toBe(0)
    // The grid fills the area with the DOM renderer's cells.
    const geometry = await app.terminalGeometry()
    const size = await app.terminalSize()
    const slack = geometry.areaWidth - geometry.scrollbarWidth - size.cols * geometry.cellWidth
    expect(slack).toBeGreaterThanOrEqual(0)
    expect(slack).toBeLessThan(geometry.cellWidth)
    await app.run('stty size')
    expect(await app.outputOf('stty size')).toEqual([`${size.rows} ${size.cols}`])
  })

  test('where WebGL is not available, terminals use the DOM renderer', async ({ launch }) => {
    // Electron keeps WebGL with --disable-webgl; without the GPU there is none.
    const app = await launch({ switches: ['--disable-gpu'] })
    expect(
      await app.page.evaluate(() => document.createElement('canvas').getContext('webgl2') === null),
    ).toBe(true)
    await startShell(app)
    await app.run('echo no-webgl')
    expect(await app.outputOf('echo no-webgl')).toEqual(['no-webgl'])
    await expect(app.domRendererRows()).toHaveCount(1)
    await expect(app.domRendererRows()).toContainText('no-webgl')
    expect(await app.webglCanvases()).toBe(0)
  })
})

test('programs cannot turn on the kitty keyboard protocol', async ({ app, world }) => {
  await startShell(app)
  const bytesFile = path.join(world.records, 'kitty-bytes.txt')
  const program = writeProgram(
    world,
    'kitty-probe',
    `const fs = require('node:fs')
fs.writeFileSync(${JSON.stringify(bytesFile)}, '')
process.stdin.setRawMode(true)
process.stdin.on('data', (chunk) => {
  for (const byte of chunk) {
    if (byte === 3) process.exit(0)
    fs.appendFileSync(${JSON.stringify(bytesFile)}, byte.toString(16).padStart(2, '0') + ' ')
  }
})
// Asks which keyboard protocol flags are on; a terminal that has the protocol answers.
process.stdout.write('\\x1b[?u')
setTimeout(() => {
  fs.appendFileSync(${JSON.stringify(bytesFile)}, '| ')
  // Asks for the protocol's disambiguated key codes.
  process.stdout.write('\\x1b[>1u')
  process.stdout.write('kitty probe ready\\r\\n')
}, 1000)
`,
  )
  await app.run(program, { waitForPrompt: false })
  await app.waitForTerminalText('kitty probe ready')
  // Nothing arrived in the second after the query.
  expect(fs.readFileSync(bytesFile, 'utf8')).toBe('| ')
  await app.focusTerminal()
  await app.page.keyboard.press('a')
  await app.page.keyboard.press('Escape')
  await expect.poll(() => fs.readFileSync(bytesFile, 'utf8')).toBe('| 61 1b ')
  await app.page.keyboard.press('Control+C')
  await app.waitForPrompt()
})

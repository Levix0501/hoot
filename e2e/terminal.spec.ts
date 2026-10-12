import fs from 'node:fs'
import path from 'node:path'
import { LIGHT_ANSI_COLORS, lightTheme } from '../src/renderer/terminal/themes'
import type { AppDriver } from './support/app'
import { cellRect, rgb, sameColor, type PixelRect, type Rgb } from './support/pixels'
import { childPids } from './support/processes'
import { writeByteRecorder, writeMouseReporter } from './support/programs'
import { readRecord, writeSubstitute } from './support/substitutes'
import { expect, test } from './support/test'
import type { World } from './support/world'

/** Starts a Shell session in project G, adding the project first unless it is in the list. */
async function startShell(app: AppDriver, world: World): Promise<void> {
  if ((await app.projectItems().count()) === 0) {
    await app.addProject(world.repos.G)
    await expect(app.projectItems()).toHaveCount(1)
  }
  await app.startSession(world.repos.G, 'shell')
  await expect(app.session()).toHaveAttribute('data-status', 'running')
  await app.waitForPrompt()
}

/** Whether every pixel of the rectangle is `color`. */
function onlyColor(
  shot: { pixels(rect: PixelRect): Iterable<{ color: Rgb }> },
  rect: PixelRect,
  color: Rgb,
): boolean {
  for (const pixel of shot.pixels(rect)) if (!sameColor(pixel.color, color)) return false
  return true
}

/**
 * Prints `text` with `command`, checks the cells it takes, and checks on
 * screen that each character's glyph stays within its own cells. The glyph of
 * a character is what printing it on its own, between spaces, draws.
 */
async function expectTwoCellWideCharacters(
  app: AppDriver,
  command: string,
  text: string,
  expected: Array<[chars: string, width: number]>,
): Promise<void> {
  await app.run(command)
  expect(await app.outputOf(command)).toEqual([text])
  const row = await app.findLine(text)
  const cells = await Promise.all(expected.map((_, column) => app.cell(row, column)))
  expect(cells.map((cell) => [cell?.chars, cell?.width])).toEqual(expected)

  const background = rgb(lightTheme.background!)
  for (const [chars, width] of expected) {
    if (chars === '') continue
    // As escapes: the shell may not know how wide newer characters are when they are typed.
    const escaped = Array.from(chars, (char) => {
      const codePoint = char.codePointAt(0)!
      return codePoint < 0x80 ? char : `\\U${codePoint.toString(16).padStart(8, '0')}`
    }).join('')
    const alone = `printf '  ${escaped}  \\n'`
    await app.run(alone)
    const line = await app.outputStart(alone)
    const shot = await app.screenshot()
    const grid = await app.gridPixels()
    const viewportRow = line - (await app.viewportY())
    const own = cellRect(grid, viewportRow, 2)
    // Its own cells have some of the glyph, the cells around them none.
    expect(onlyColor(shot, { ...own, width: own.width * width }, background), chars).toBe(false)
    for (const column of [1, 2 + width]) {
      expect(
        onlyColor(shot, cellRect(grid, viewportRow, column), background),
        `${chars} next to ${column}`,
      ).toBe(true)
    }
  }
}

/**
 * The usual xterm values of the 256-color palette entries 16–255: a 6×6×6
 * color cube with levels 0, 95, 135, 175, 215, 255, then a 24-step gray ramp.
 */
function xterm256(index: number): string {
  if (index >= 232) {
    const level = 8 + (index - 232) * 10
    return `rgb(${level}, ${level}, ${level})`
  }
  const cube = index - 16
  const levels = [0, 95, 135, 175, 215, 255]
  return `rgb(${levels[Math.floor(cube / 36)]}, ${levels[Math.floor(cube / 6) % 6]}, ${levels[cube % 6]})`
}

test.describe('basic terminal interaction', () => {
  test('keyboard input and Ctrl+C reach the program', async ({ app, world }) => {
    await startShell(app, world)
    await app.run('echo hi')
    expect(await app.outputOf('echo hi')).toEqual(['hi'])

    const shellPid = await app.shellPid()
    await app.run('sleep 100', { waitForPrompt: false })
    // Interrupt only once `sleep` is actually running.
    await expect.poll(async () => (await childPids(shellPid)).length).toBeGreaterThan(0)
    const started = Date.now()
    await app.page.keyboard.press('Control+C')
    await app.waitForPrompt(10_000)
    expect(Date.now() - started).toBeLessThan(10_000)
    await app.expectEnglishUi()
  })

  test('mouse clicks and wheel reach a program that turned on mouse reporting', async ({
    app,
    world,
  }) => {
    await startShell(app, world)
    const reporter = writeMouseReporter(world)
    await app.run(reporter, { waitForPrompt: false })
    await app.waitForTerminalText('reporter ready')

    // Mouse reports use 1-based viewport coordinates.
    const target = await app.cellBox(10, 10)
    await app.page.mouse.click(target.x + target.width / 2, target.y + target.height / 2)
    const row = 11
    const column = 11
    await app.waitForTerminalText(`GOT "\\u001b[<0;${column};${row}M`)
    await app.waitForTerminalText(`\\u001b[<0;${column};${row}m`)

    await app.page.mouse.wheel(0, -200)
    await app.waitForTerminalText(`GOT "\\u001b[<64;${column};${row}M`)
    await app.page.mouse.wheel(0, 200)
    await app.waitForTerminalText(`GOT "\\u001b[<65;${column};${row}M`)

    await app.focusTerminal()
    await app.page.keyboard.press('Control+C')
    await app.waitForPrompt()
  })

  test('16-color, 256-color and 24-bit colors are shown as specified', async ({
    launch,
    world,
  }) => {
    // The project is in the list from the start, so no message covers the terminal.
    const app = await launch({ projects: [world.repos.G] })
    await app.setSystemAppearance('light')
    await startShell(app, world)

    /** A color as a background block (four cells) and as a foreground full block. */
    const samples: Array<{ name: string; foreground: string; background: string; color: string }> =
      []
    LIGHT_ANSI_COLORS.forEach((color, index) => {
      const foreground = index < 8 ? 30 + index : 90 + index - 8
      const background = index < 8 ? 40 + index : 100 + index - 8
      samples.push({
        name: `color ${index}`,
        foreground: `${foreground}`,
        background: `${background}`,
        color,
      })
    })
    for (const index of [16, 21, 46, 88, 124, 160, 196, 208, 226, 231, 232, 240, 244, 250, 255]) {
      samples.push({
        name: `color ${index} of 256`,
        foreground: `38;5;${index}`,
        background: `48;5;${index}`,
        color: xterm256(index),
      })
    }
    for (const [red, green, blue] of [
      [10, 200, 30],
      [250, 5, 6],
      [1, 2, 3],
    ]) {
      samples.push({
        name: `24-bit ${red},${green},${blue}`,
        foreground: `38;2;${red};${green};${blue}`,
        background: `48;2;${red};${green};${blue}`,
        color: `rgb(${red}, ${green}, ${blue})`,
      })
    }

    // Eight samples of six cells per line keep every line short enough not to wrap.
    const perLine = 8
    const lines: string[] = []
    for (let index = 0; index < samples.length; index += perLine) {
      lines.push(
        samples
          .slice(index, index + perLine)
          .map(
            (sample) => `\x1b[${sample.background}m    \x1b[0m \x1b[${sample.foreground}m█\x1b[0m`,
          )
          .join(''),
      )
    }
    const first = await app.printLines(lines)
    const shot = await app.screenshot()
    const grid = await app.gridPixels()
    const firstRow = first - (await app.viewportY())
    samples.forEach((sample, index) => {
      const row = firstRow + Math.floor(index / perLine)
      const column = (index % perLine) * 6
      const block = cellRect(grid, row, column)
      expect(
        shot.middle({ ...block, width: block.width * 4 }),
        `${sample.name} background`,
      ).toEqual(rgb(sample.color))
      expect(shot.middle(cellRect(grid, row, column + 5)), `${sample.name} foreground`).toEqual(
        rgb(sample.color),
      )
    })
  })

  test('resizing the window resizes the terminal grid and the program sees the new size', async ({
    app,
    world,
  }) => {
    await startShell(app, world)
    for (const [width, height] of [
      [1000, 640],
      [1400, 900],
    ] as const) {
      await app.setWindowSize(width, height)
      await expect
        .poll(async () => {
          const geometry = await app.terminalGeometry()
          const size = await app.terminalSize()
          const slackX =
            geometry.areaWidth - geometry.scrollbarWidth - size.cols * geometry.cellWidth
          const slackY = geometry.areaHeight - size.rows * geometry.cellHeight
          // The grid fills the area: besides the scrollbar, less than one cell is left.
          return (
            slackX >= 0 &&
            slackX < geometry.cellWidth &&
            slackY >= 0 &&
            slackY < geometry.cellHeight
          )
        })
        .toBe(true)
      const size = await app.terminalSize()
      await app.run('stty size')
      expect(await app.outputOf('stty size')).toEqual([`${size.rows} ${size.cols}`])
    }
  })

  test('a window resize while a session is starting reaches the program', async ({
    launch,
    world,
  }) => {
    writeSubstitute(world.interactiveBin, 'claude', world.records)
    const app = await launch()
    const { G } = world.repos
    await app.addProject(G)
    await expect(app.projectItems()).toHaveCount(1)
    await app.openToolMenu(G)
    await expect(app.page.getByTestId('tool-entry-claude')).toHaveAttribute(
      'data-available',
      'true',
    )
    await app.closeMenus()

    // A slow tool detection keeps the next session starting while the window is resized.
    fs.appendFileSync(path.join(world.home, '.zshrc'), 'sleep 3\n')
    await app.redetectTools(G)
    await app.toolItem('claude').click()
    await expect(app.session()).toHaveAttribute('data-status', 'starting')
    const before = await app.terminalSize()
    await app.setWindowSize(900, 600)
    await expect.poll(() => app.terminalSize()).not.toEqual(before)
    await expect(app.session()).toHaveAttribute('data-status', 'starting')

    await expect(app.session()).toHaveAttribute('data-status', 'running', { timeout: 30_000 })
    const size = await app.terminalSize()
    expect(size).not.toEqual(before)
    await expect
      .poll(() => readRecord(world.records, 'claude')?.size)
      .toEqual([size.cols, size.rows])
  })

  test('Cmd+C copies the selection and Cmd+V pastes into the program', async ({ app, world }) => {
    await startShell(app, world)
    const saved = await app.readClipboard()
    try {
      await app.run('echo copy-me-123')
      const lineIndex = await app.findLine('copy-me-123')
      expect(lineIndex).toBeGreaterThanOrEqual(0)
      const viewportRow = lineIndex - (await app.viewportY())
      const first = await app.cellBox(viewportRow, 0)
      const last = await app.cellBox(viewportRow, 'copy-me-123'.length - 1)
      await app.page.mouse.move(first.x + 1, first.y + first.height / 2)
      await app.page.mouse.down()
      await app.page.mouse.move(last.x + last.width - 1, last.y + last.height / 2, { steps: 5 })
      await app.page.mouse.up()
      await app.page.keyboard.press('Meta+C')
      await expect.poll(() => app.readClipboard()).toBe('copy-me-123')

      await app.writeClipboard('echo pasted')
      await app.focusTerminal()
      await app.page.keyboard.press('Meta+V')
      await expect.poll(() => app.cursorLine()).toBe(`${world.prompt}echo pasted`)
      await app.page.keyboard.press('Enter')
      await app.waitForPrompt()
      expect(await app.outputOf('echo pasted')).toEqual(['pasted'])
    } finally {
      await app.writeClipboard(saved)
    }
  })

  test('at least the last 10,000 lines that scrolled off can be scrolled back to', async ({
    app,
    world,
  }) => {
    await startShell(app, world)
    await app.run('seq 1 12000', { waitForPrompt: false })
    await app.waitForPrompt(30_000)
    const scrolledOff = await app.page.evaluate(
      () => window.hootTestHooks!.terminal!.buffer.active.baseY,
    )
    expect(scrolledOff).toBeGreaterThanOrEqual(10_000)

    const screen = (await app.page.locator('[data-testid="terminal"] .xterm-screen').boundingBox())!
    await app.page.mouse.move(screen.x + screen.width / 2, screen.y + screen.height / 2)
    const bottom = await app.viewportY()
    await app.page.mouse.wheel(0, -100)
    await expect.poll(() => app.viewportY()).toBeLessThan(bottom)

    // Drag the scrollbar to the top: the oldest kept lines come into view.
    const slider = app.page.locator(
      '[data-testid="terminal"] .xterm-scrollbar.xterm-vertical .xterm-slider',
    )
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

    const lineVisible = async () => (await app.visibleRows()).includes('2001')
    for (let step = 0; step < 200 && !(await lineVisible()); step++) {
      await app.page.mouse.wheel(0, 100)
    }
    await expect.poll(() => app.visibleRows()).toContain('2001')
  })
})

test('IME composition shows at the cursor, is committed once, and wide characters take two cells', async ({
  launch,
  world,
}) => {
  // The device pixel ratio of the Retina displays of Macs.
  const app = await launch({ deviceScaleFactor: 2, projects: [world.repos.G] })
  await app.setSystemAppearance('light')
  await startShell(app, world)
  const recorder = writeByteRecorder(world)
  await app.run(recorder.command, { waitForPrompt: false })
  await app.waitForTerminalText('recorder ready')
  await app.focusTerminal()

  const cdp = await app.page.context().newCDPSession(app.page)
  await cdp.send('Input.imeSetComposition', {
    text: 'zhongwen',
    selectionStart: 8,
    selectionEnd: 8,
  })
  const composition = app.page.locator('[data-testid="terminal"] .composition-view')
  await expect(composition).toHaveClass(/active/)
  // xterm.js marks the text as left-to-right, with invisible marks around it.
  await expect(composition).toHaveText(/^\u200E?zhongwen\u200E?$/)
  const placement = await app.page.evaluate(() => {
    const terminal = window.hootTestHooks!.terminal!
    const screen = document.querySelector('[data-testid="terminal"] .xterm-screen')!
    const view = document.querySelector('[data-testid="terminal"] .composition-view')!
    const screenBox = screen.getBoundingClientRect()
    const viewBox = view.getBoundingClientRect()
    return {
      left: viewBox.left - screenBox.left,
      top: viewBox.top - screenBox.top,
      expectedLeft: (terminal.buffer.active.cursorX * screenBox.width) / terminal.cols,
      expectedTop: (terminal.buffer.active.cursorY * screenBox.height) / terminal.rows,
    }
  })
  expect(Math.abs(placement.left - placement.expectedLeft)).toBeLessThan(1)
  expect(Math.abs(placement.top - placement.expectedTop)).toBeLessThan(1)
  await app.expectEnglishUi()

  await cdp.send('Input.insertText', { text: '中文' })
  await expect.poll(() => fs.readFileSync(recorder.bytesFile, 'utf8')).toBe('e4b8ade69687')
  await app.page.waitForTimeout(500)
  expect(fs.readFileSync(recorder.bytesFile, 'utf8')).toBe('e4b8ade69687')
  await app.page.keyboard.press('Control+C')
  await app.waitForPrompt()

  await expectTwoCellWideCharacters(app, "printf '中文😀X\\n'", '中文😀X', [
    ['中', 2],
    ['', 0],
    ['文', 2],
    ['', 0],
    ['😀', 2],
    ['', 0],
    ['X', 1],
  ])
  // Wide characters added after Unicode 13 (here from Unicode 14 and 15) take two cells as well.
  await expectTwoCellWideCharacters(app, "printf '\\U0001FAE0\\U0001FAE8X\\n'", '🫠🫨X', [
    ['🫠', 2],
    ['', 0],
    ['🫨', 2],
    ['', 0],
    ['X', 1],
  ])
})

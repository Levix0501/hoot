import fs from 'node:fs'
import path from 'node:path'
import type { Locator } from '@playwright/test'
import { repoRoot, type AppDriver } from './support/app'
import { claudeCodeButton } from './support/claude-code'
import { openIssue } from './support/issues'
import { sameCssColor } from './support/layout'
import { movePointerAway } from './support/projects'
import { writeSubstitute } from './support/substitutes'
import { expect, test } from './support/test'
import { createWorktree, openWorktreeContextMenu, worktreeItem } from './support/worktrees'

/** Hoot's own file of Claude Code's mark, which draws every Claude Code icon. */
const ICON_FILE = path.join(repoRoot, 'src/renderer/assets/brand-icons/claude-code.svg')

/** What an icon draws and in which colors, next to the color of a text. */
async function lookOf(icon: Locator, text: Locator) {
  const drawn = await icon.evaluate((svg) => ({
    tag: svg.tagName.toLowerCase(),
    viewBox: svg.getAttribute('viewBox'),
    lucide: svg.classList.contains('lucide'),
    paths: Array.from(svg.querySelectorAll('path')).map((part) => part.getAttribute('d')),
    fills: Array.from(svg.querySelectorAll('path')).map((part) => getComputedStyle(part).fill),
    strokes: Array.from(svg.querySelectorAll('path')).map((part) => getComputedStyle(part).stroke),
    color: getComputedStyle(svg).color,
    tooltip: svg.querySelector('title')?.textContent ?? null,
  }))
  return { ...drawn, text: await text.evaluate((element) => getComputedStyle(element).color) }
}

/**
 * Checks that an icon draws Claude Code's mark from Hoot's file, in one color:
 * the color of the text next to it. Returns that color.
 */
async function expectMark(icon: Locator, text: Locator, where: string): Promise<string> {
  const svg = fs.readFileSync(ICON_FILE, 'utf8')
  const data = /<path\b[^>]*\sd="([^"]+)"/.exec(svg)![1]
  const look = await lookOf(icon, text)
  const report = `${where}: ${JSON.stringify(look)}`
  expect(look.tag, report).toBe('svg')
  expect(look.lucide, report).toBe(false)
  expect(look.viewBox, report).toBe('0 0 24 24')
  expect(look.paths, report).toEqual([data])
  expect(look.strokes, report).toEqual(['none'])
  expect(look.tooltip, report).toBeNull()
  expect(sameCssColor(look.fills[0]!, look.text), report).toBe(true)
  expect(sameCssColor(look.color, look.text), report).toBe(true)
  return look.text
}

/** The lucide icon of a tool's item in the open new session menu. */
async function menuIconOf(app: AppDriver, tool: string): Promise<string[]> {
  return app
    .toolItem(tool as 'shell')
    .locator('svg')
    .evaluate((svg) => Array.from(svg.classList).filter((name) => name.startsWith('lucide')))
}

/**
 * Checks the Claude Code item of the open new session menu, then again while
 * it is highlighted, and the other tools' lucide icons.
 */
async function expectMenu(app: AppDriver, where: string, light: boolean): Promise<void> {
  const icon = app.toolItem('claude').locator('[data-tool-icon="claude"]')
  const label = app.toolLabel('claude')
  await expect(app.toolItem('claude')).not.toHaveAttribute('data-highlighted')
  const plain = await expectMark(icon, label, where)
  await app.toolItem('claude').hover()
  await expect(app.toolItem('claude')).toHaveAttribute('data-highlighted', '')
  const highlighted = await expectMark(icon, label, `${where}, highlighted`)
  // In the light appearance, a highlighted item's text has another color.
  if (light) expect(sameCssColor(plain, highlighted)).toBe(false)
  expect(await menuIconOf(app, 'codex')).toContain('lucide-code')
  expect(await menuIconOf(app, 'opencode')).toContain('lucide-bot')
  expect(await menuIconOf(app, 'shell')).toContain('lucide-square-terminal')
}

test('every Claude Code icon is Claude Code’s own mark, in the color of the text around it', async ({
  launch,
  world,
}) => {
  writeSubstitute(world.interactiveBin, 'claude', world.records)
  writeSubstitute(world.loginBin, 'codex', world.records)
  writeSubstitute(world.laterBin, 'opencode', world.records)
  const { G } = world.repos
  const app = await launch({ projects: [G], issues: [{ root: G, title: 'Alpha' }] })
  const X = await createWorktree(app, G, 'feature-x')
  const c = await app.startSession(G, 'claude')
  const shell = await app.startSession(G, 'shell')
  await app.waitForPrompt(20_000, shell)

  // The file: Claude Code's mark in the color of the text, with no color of its own.
  const svg = fs.readFileSync(ICON_FILE, 'utf8')
  expect(svg).toContain('fill="currentColor"')
  expect(svg).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i)
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
  const packages = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })
  expect(packages.filter((name) => /simple-icons|icons-pack/.test(name))).toEqual([])

  for (const appearance of ['light', 'dark'] as const) {
    await app.setSystemAppearance(appearance)
    await expect
      .poll(() => app.page.evaluate(() => document.documentElement.classList.contains('dark')))
      .toBe(appearance === 'dark')
    const light = appearance === 'light'

    // The session's row, not selected and selected.
    await app.selectSession(shell)
    await movePointerAway(app)
    const row = app.sessionItem(c)
    const rowIcon = row.locator('[data-tool-icon="claude"]')
    const plain = await expectMark(rowIcon, row.getByTestId('session-item-name'), 'row')
    await app.selectSession(c)
    await movePointerAway(app)
    const selected = await expectMark(rowIcon, row.getByTestId('session-item-name'), 'selected row')
    if (light) expect(sameCssColor(plain, selected)).toBe(false)

    // The Shell session's icons are as they were: lucide's, in the colors they had.
    const shellIcon = app.sessionItem(shell).locator('[data-tool-icon="shell"]')
    expect(await shellIcon.getAttribute('class')).toContain('lucide-square-terminal')
    const accent = await app.page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--sidebar-accent-foreground'),
    )
    expect(
      sameCssColor(await shellIcon.evaluate((icon) => getComputedStyle(icon).color), accent),
    ).toBe(true)

    // The session page's top row.
    await expectMark(
      app.sessionHeader().locator('[data-tool-icon="claude"]'),
      app.page.getByTestId('session-name'),
      'header',
    )

    // The field that renames the session.
    await row.getByTestId('session-item-button').dblclick()
    const input = row.getByTestId('session-rename-input')
    await expect(input).toBeFocused()
    await expectMark(rowIcon, input, 'rename field')
    await input.press('Escape')
    await expect(input).toHaveCount(0)

    // The new session menus of G's row and of its worktree's row.
    await app.openToolMenu(G)
    await expectMenu(app, 'project menu', light)
    await app.closeMenus()
    await app.openContextToolMenu(G)
    await expectMenu(app, 'project context menu', light)
    await app.page.keyboard.press('Escape')
    await app.closeMenus()
    await worktreeItem(app, X).getByTestId('worktree-new-session-button').click()
    await expect(app.toolItem('claude')).toBeVisible()
    await expectMenu(app, 'worktree menu', light)
    await app.closeMenus()
    await openWorktreeContextMenu(app, X)
    await app.page.getByTestId('worktree-context-new-session').click()
    await expect(app.toolItem('claude')).toBeVisible()
    await expectMenu(app, 'worktree context menu', light)
    await app.page.keyboard.press('Escape')
    await app.closeMenus()

    // The button that shows the session an issue was sent to, or sends it.
    await openIssue(app, G, 'Alpha')
    await movePointerAway(app)
    const button = claudeCodeButton(app)
    await expectMark(button.locator('[data-tool-icon="claude"]'), button, 'issue button')
  }

  // A Shell session's top row shows lucide's icon in the muted color it had.
  await app.selectSession(shell)
  const header = app.sessionHeader().locator('[data-tool-icon="shell"]')
  expect(await header.getAttribute('class')).toContain('lucide-square-terminal')
  const muted = await app.page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--muted-foreground'),
  )
  expect(sameCssColor(await header.evaluate((icon) => getComputedStyle(icon).color), muted)).toBe(
    true,
  )
  await app.expectEnglishUi()
})

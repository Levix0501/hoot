import { expect, type Locator } from '@playwright/test'
import type { Appearance } from '../../src/shared/appearance'
import { darkTheme, lightTheme } from '../../src/renderer/terminal/themes'
import type { AppDriver, ColorScheme } from './app'
import { rgb, Screenshot, type Rgb } from './pixels'

/** The window's own background color of each appearance, as Electron reports it. */
export const WINDOW_BACKGROUNDS: Record<ColorScheme, string> = {
  light: '#FFFFFF',
  dark: '#0A0A0A',
}

/** The sidebar's last row, which shows the settings. */
export function settingsEntry(app: AppDriver): Locator {
  return app.page.getByTestId('sidebar-settings')
}

/** The list of the settings' pages, in the sidebar's place. */
export function settingsNavigation(app: AppDriver): Locator {
  return app.page.getByTestId('settings-navigation')
}

export function backToApp(app: AppDriver): Locator {
  return app.page.getByTestId('settings-back-to-app')
}

export function appearancePage(app: AppDriver): Locator {
  return app.page.getByTestId('appearance-page')
}

/** The card of an appearance on the Appearance page. */
export function themeCard(app: AppDriver, appearance: Appearance): Locator {
  return app.page.getByTestId(`theme-card-${appearance}`)
}

/** The drawing of a Hoot window on an appearance's card. */
export function themePreview(app: AppDriver, appearance: Appearance): Locator {
  return themeCard(app, appearance).getByTestId('theme-preview')
}

/** The sidebar, with the projects and their sessions. */
export function projectSidebar(app: AppDriver): Locator {
  return app.page.locator('[data-slot="sidebar-container"][aria-label="Projects"]')
}

/** Checks that the window shows the settings, and neither the sidebar nor the main area. */
export async function expectSettingsShown(app: AppDriver): Promise<void> {
  await expect(settingsNavigation(app)).toBeVisible()
  await expect(appearancePage(app)).toBeVisible()
  await expect(projectSidebar(app)).toHaveCount(0)
  await expect(app.mainArea()).toHaveCount(0)
}

/** Checks that the window shows the sidebar and the main area, not the settings. */
export async function expectAppShown(app: AppDriver): Promise<void> {
  await expect(projectSidebar(app)).toHaveCount(1)
  await expect(app.mainArea()).toBeVisible()
  await expect(settingsNavigation(app)).toHaveCount(0)
  await expect(appearancePage(app)).toHaveCount(0)
}

/** Shows the settings with ⌘, and waits until they are shown. */
export async function pressSettingsShortcut(app: AppDriver): Promise<void> {
  await app.page.keyboard.press('Meta+Comma')
  await expectSettingsShown(app)
}

/** The appearance whose card is selected, or `null` when none is. */
export async function selectedTheme(app: AppDriver): Promise<string | null> {
  return app.page.evaluate(
    () =>
      document
        .querySelector('[data-testid^="theme-card-"]:has([role="radio"][aria-checked="true"])')
        ?.getAttribute('data-testid')
        ?.replace('theme-card-', '') ?? null,
  )
}

/** Clicks an appearance's card and waits until Hoot applies it. */
export async function pickTheme(app: AppDriver, appearance: Appearance): Promise<void> {
  await themeCard(app, appearance).click()
  await expect.poll(() => selectedTheme(app)).toBe(appearance)
  await expect.poll(() => app.themeSource()).toBe(appearance)
}

/** The names of the interface's colors, the CSS variables of each appearance. */
const COLOR_NAMES = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'border',
  'input',
  'ring',
  'sidebar',
  'sidebar-foreground',
  'sidebar-primary',
  'sidebar-primary-foreground',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'sidebar-border',
  'sidebar-ring',
] as const

export type ColorName = (typeof COLOR_NAMES)[number]

/** The interface's colors of an appearance, as the page computes them, by name. */
export async function interfaceColors(
  app: AppDriver,
  scheme: ColorScheme,
): Promise<Record<ColorName, string>> {
  return app.page.evaluate(
    ([name, names]) => {
      // Under the scheme's class, an element takes its colors whatever the window's appearance.
      const probe = document.createElement('div')
      probe.className = name
      document.body.append(probe)
      const colors: Record<string, string> = {}
      for (const color of names) {
        probe.style.color = `var(--${color})`
        colors[color] = getComputedStyle(probe).color
      }
      probe.remove()
      return colors
    },
    [scheme, COLOR_NAMES] as const,
  ) as Promise<Record<ColorName, string>>
}

/** The terminal's theme of an appearance. */
export function terminalColors(scheme: ColorScheme) {
  return scheme === 'dark' ? darkTheme : lightTheme
}

/**
 * The background colors of an appearance as 8-bit sRGB: the interface's
 * backgrounds, the terminal's and the window's. Those of the light
 * appearance and those of the dark one have none in common.
 */
export async function backgroundColors(app: AppDriver, scheme: ColorScheme): Promise<Rgb[]> {
  const colors = await interfaceColors(app, scheme)
  const names: ColorName[] = [
    'background',
    'card',
    'popover',
    'secondary',
    'muted',
    'accent',
    'sidebar',
    'sidebar-accent',
  ]
  return [
    ...names.map((name) => rgb(colors[name])),
    rgb(terminalColors(scheme).background!),
    rgb(WINDOW_BACKGROUNDS[scheme]),
  ]
}

/** Whether an 8-bit color is one of `colors`, give or take a unit for rounding. */
export function oneOf(color: Rgb, colors: readonly Rgb[]): boolean {
  return colors.some((candidate) =>
    color.every((value, index) => Math.abs(value - candidate[index]!) <= 1),
  )
}

/** The computed colors of what a locator finds: its background and its text. */
export async function colorsOf(locator: Locator): Promise<{ background: string; text: string }> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element)
    return { background: style.backgroundColor, text: style.color }
  })
}

/**
 * Checks that what a locator finds shows in an appearance's colors: its
 * background and its text are the interface colors it takes in that
 * appearance.
 */
export async function expectColors(
  app: AppDriver,
  locator: Locator,
  scheme: ColorScheme,
  expected: { background?: ColorName; text?: ColorName },
): Promise<void> {
  const colors = await interfaceColors(app, scheme)
  const shown = await colorsOf(locator)
  if (expected.background) expect(shown.background, 'background').toBe(colors[expected.background])
  if (expected.text) expect(shown.text, 'text').toBe(colors[expected.text])
}

/**
 * Waits until the window shows in an appearance: the page takes its colors,
 * the window's own background is its, and macOS applies it to Hoot, drawing
 * Hoot's menus, dialogs and panels in it.
 */
export async function expectWindowIn(app: AppDriver, scheme: ColorScheme): Promise<void> {
  await expect(app.page.locator('html')).toHaveClass(scheme)
  expect(await app.page.evaluate(() => document.documentElement.style.colorScheme)).toBe(scheme)
  await expect.poll(() => app.windowBackground()).toBe(WINDOW_BACKGROUNDS[scheme])
  await expect.poll(() => app.effectiveAppearance()).toBe(scheme)
}

/**
 * Checks the settings, shown, in an appearance's colors: the list of their
 * pages and the Appearance page, and every color shown in them but in the
 * theme previews, which keep their own.
 */
export async function expectSettingsIn(app: AppDriver, scheme: ColorScheme): Promise<void> {
  await expectWindowIn(app, scheme)
  await expectColors(app, settingsNavigation(app), scheme, {
    background: 'sidebar',
    text: 'sidebar-foreground',
  })
  await expectColors(app, app.page.getByTestId('settings-appearance'), scheme, {
    background: 'sidebar-accent',
    text: 'sidebar-accent-foreground',
  })
  await expectColors(app, appearancePage(app), scheme, {
    background: 'background',
    text: 'foreground',
  })
  await expectColors(app, appearancePage(app).locator('p'), scheme, { text: 'muted-foreground' })
  await expectColors(app, app.page.locator('[role="radio"][aria-checked="true"]'), scheme, {
    background: 'primary',
  })
  const palette = Object.values(await interfaceColors(app, scheme)).map(rgb)
  const shown = await app.page.evaluate(() => {
    const colors: string[] = []
    const parts = document.querySelectorAll(
      '[data-testid="settings-navigation"], [data-testid="appearance-page"]',
    )
    for (const part of Array.from(parts)) {
      for (const element of [part, ...Array.from(part.querySelectorAll('*'))]) {
        if (element.closest('[data-testid="theme-preview"]') || !element.checkVisibility()) continue
        const style = getComputedStyle(element)
        colors.push(style.color)
        if (style.backgroundColor !== 'rgba(0, 0, 0, 0)') colors.push(style.backgroundColor)
      }
    }
    return colors
  })
  for (const color of new Set(shown)) expect(oneOf(rgb(color), palette), color).toBe(true)
}

/** The background of a session's terminal as it is drawn, at the right end of its last row. */
async function terminalBackgroundShown(app: AppDriver): Promise<Rgb> {
  const terminal = await app.page.getByTestId('terminal').boundingBox()
  const shot = await app.page.screenshot({
    clip: {
      x: terminal!.x + terminal!.width - 40,
      y: terminal!.y + terminal!.height - 8,
      width: 1,
      height: 1,
    },
  })
  return new Screenshot(shot).pixel(0, 0)
}

/**
 * Checks the sidebar, the page of the session shown and its terminal, and
 * the terminals of the sessions not shown, in an appearance's colors.
 */
export async function expectAppIn(
  app: AppDriver,
  scheme: ColorScheme,
  shown: string,
  hidden: readonly string[] = [],
): Promise<void> {
  await expectWindowIn(app, scheme)
  await expect(app.session()).toHaveAttribute('data-session-id', shown)
  await expectColors(app, app.page.locator('[data-slot="sidebar-inner"]'), scheme, {
    background: 'sidebar',
  })
  await expectColors(app, projectSidebar(app), scheme, { text: 'sidebar-foreground' })
  await expectColors(app, app.mainArea(), scheme, { background: 'background' })
  await expectColors(app, app.page.getByTestId('session-name'), scheme, { text: 'foreground' })
  const theme = terminalColors(scheme)
  for (const id of [shown, ...hidden]) {
    const colors = await app.page.evaluate((sessionId) => {
      const options = window.hootTestHooks!.terminalOf(sessionId)!.options.theme!
      return { background: options.background, foreground: options.foreground }
    }, id)
    expect(colors, id).toEqual({ background: theme.background, foreground: theme.foreground })
  }
  await expect
    .poll(async () => oneOf(await terminalBackgroundShown(app), [rgb(theme.background!)]))
    .toBe(true)
}

/**
 * Checks what opens over the window in an appearance's colors: the dialog
 * asking before a running session closes, a project's new session menu,
 * Back's tooltip, and a message.
 */
export async function expectOverlaysIn(
  app: AppDriver,
  scheme: ColorScheme,
  session: string,
  project: string,
): Promise<void> {
  const popover = { background: 'popover', text: 'popover-foreground' } as const
  await app.sessionItem(session).hover()
  await app.sessionItem(session).getByTestId('session-item-close').click()
  await expect(app.closeSessionDialog()).toBeVisible()
  await expectColors(app, app.closeSessionDialog(), scheme, popover)
  await app.page.getByTestId('close-session-cancel').click()
  await expect(app.closeSessionDialog()).toHaveCount(0)

  await app.openToolMenu(project)
  await expectColors(app, app.page.locator('[data-slot="dropdown-menu-content"]'), scheme, popover)
  await app.closeMenus()

  const back = await app.backButton().boundingBox()
  await app.page.mouse.move(back!.x + back!.width / 2, back!.y + back!.height / 2)
  const tooltip = app.page.locator('[data-slot="tooltip-content"]')
  await expect(tooltip).toBeVisible()
  // Dark on light in the light appearance, light on dark in the dark one.
  await expectColors(app, tooltip, scheme, { background: 'foreground', text: 'background' })
  await app.page.mouse.move(800, 700)
  await expect(tooltip).toHaveCount(0)

  await app.addProject(project)
  const message = app.toasts('This project is already in the list.').last()
  await expect(message).toBeVisible()
  await expectColors(app, message, scheme, popover)
}

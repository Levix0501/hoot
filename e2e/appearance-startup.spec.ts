import fs from 'node:fs'
import path from 'node:path'
import type { Appearance } from '../src/shared/appearance'
import type { AppDriver, ColorScheme, MenuEntry } from './support/app'
import { databaseFile } from './support/database'
import {
  backToApp,
  expectColors,
  expectWindowIn,
  interfaceColors,
  pickTheme,
  pressSettingsShortcut,
  selectedTheme,
  settingsEntry,
  settingsNavigation,
  WINDOW_BACKGROUNDS,
} from './support/settings'
import { expect, test } from './support/test'

/** Puts settings in a user data directory before Hoot starts with it. */
function writeSettings(userData: string, settings: Record<string, unknown>): void {
  fs.mkdirSync(userData, { recursive: true })
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify(settings))
}

/** The contents of a user data directory's settings.json. */
function readSettings(userData: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'))
}

async function quit(app: AppDriver): Promise<void> {
  await app.quit()
  await app.waitForExit()
}

/**
 * Checks that the window has shown in an appearance from its creation: its
 * own background, then every frame of the page until a second after it
 * showed the sidebar and the main area, or the database error page.
 */
async function expectShownFromTheStart(app: AppDriver, scheme: ColorScheme): Promise<void> {
  // 1: the window's background since it was created.
  const backgrounds = await app.windowBackgrounds()
  expect(backgrounds.length).toBeGreaterThan(0)
  expect(new Set(backgrounds)).toEqual(new Set([WINDOW_BACKGROUNDS[scheme]]))

  // 2: what the page drew at every frame. Before the page has a body, the
  // window shows its own background.
  const colors = await interfaceColors(app, scheme)
  await expect
    .poll(async () => {
      const { records } = await app.framesShown()
      return records.some((record) => (record.sidebar && record.main) || record.databaseError)
    })
    .toBe(true)
  const { records, paints } = await app.framesShown()
  expect(paints.map((paint) => paint.name)).toContain('first-paint')
  const drawn = records.filter((record) => record.page !== null)
  expect(drawn.length).toBeGreaterThan(0)
  const unlike = drawn.filter(
    (record) =>
      record.dark !== (scheme === 'dark') ||
      record.light !== (scheme === 'light') ||
      record.page !== colors.background ||
      (record.sidebar !== null && record.sidebar !== colors.sidebar) ||
      (record.main !== null && record.main !== colors.background) ||
      (record.databaseError !== null && record.databaseError !== colors.background),
  )
  expect(unlike).toEqual([])
}

/** The menu bar's items: their labels, roles, kinds and shortcuts, with their submenus'. */
function describeMenu(entries: MenuEntry[]): unknown[] {
  return entries.map((entry) => [
    entry.label,
    entry.role,
    entry.type,
    entry.accelerator,
    entry.submenu ? describeMenu(entry.submenu) : null,
  ])
}

test('the appearance picked is kept in settings.json, apart for each user data directory', async ({
  launch,
  world,
}) => {
  const u1 = path.join(world.root, 'U1')
  const u2 = path.join(world.root, 'U2')

  // 1: nothing picked yet: Hoot shows in macOS's appearance, and System is selected.
  let app = await launch({ userData: u1, systemAppearance: 'light' })
  await expectWindowIn(app, 'light')
  await quit(app)
  app = await launch({ userData: u1, systemAppearance: 'dark' })
  await expectWindowIn(app, 'dark')
  await pressSettingsShortcut(app)
  expect(await selectedTheme(app)).toBe('system')
  await backToApp(app).click()

  // 2: Accept edits for Claude Code, the sidebar collapsed and Dark, all in U1's settings.json.
  await app.selectPermissionLevel('Claude Code', 'Accept edits')
  await app.page.keyboard.press('Meta+b')
  await app.expectSidebar('collapsed')
  await pressSettingsShortcut(app)
  await pickTheme(app, 'dark')
  await quit(app)
  expect(readSettings(u1)).toEqual({
    permissionLevels: { claude: 'accept-edits' },
    sidebarCollapsed: true,
    appearance: 'dark',
  })

  // 3: U1 again, while macOS is light: dark, with Dark selected.
  app = await launch({ userData: u1, systemAppearance: 'light' })
  await expectWindowIn(app, 'dark')
  expect(await app.themeSource()).toBe('dark')
  await app.expectSidebar('collapsed')
  await pressSettingsShortcut(app)
  expect(await selectedTheme(app)).toBe('dark')
  await quit(app)

  // 4: U2 has an appearance of its own, which leaves U1's as it is.
  app = await launch({ userData: u2, systemAppearance: 'light' })
  await pressSettingsShortcut(app)
  expect(await selectedTheme(app)).toBe('system')
  await pickTheme(app, 'light')
  await quit(app)
  expect(readSettings(u2)).toEqual({ appearance: 'light' })
  app = await launch({ userData: u1, systemAppearance: 'light' })
  await pressSettingsShortcut(app)
  expect(await selectedTheme(app)).toBe('dark')
  expect(readSettings(u1)).toMatchObject({ appearance: 'dark' })
})

for (const [system, picked, shown] of [
  ['light', 'dark', 'dark'],
  ['dark', 'light', 'light'],
  ['light', 'system', 'light'],
  ['dark', 'system', 'dark'],
] as const satisfies ReadonlyArray<readonly [ColorScheme, Appearance, ColorScheme]>) {
  test(`with ${picked} picked while macOS is ${system}, Hoot opens ${shown} from its first frame`, async ({
    launch,
    world,
  }) => {
    const userData = path.join(world.root, 'picked')
    writeSettings(userData, { appearance: picked })
    const app = await launch({ userData, systemAppearance: system, recordFirstPaint: true })
    await expectShownFromTheStart(app, shown)
    await expectWindowIn(app, shown)
    expect(await app.themeSource()).toBe(picked)
    expect(await app.windowBackgrounds()).toEqual([WINDOW_BACKGROUNDS[shown]])
  })
}

for (const [system, picked] of [
  ['light', 'dark'],
  ['dark', 'light'],
] as const) {
  test(`the database error page shows in the appearance picked (${picked}, macOS ${system}), without settings`, async ({
    launch,
    world,
  }) => {
    writeSettings(world.userData, { appearance: picked })
    const file = databaseFile(world.userData)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, 'not a database'.repeat(300))
    const app = await launch({
      startsWith: 'database-error',
      systemAppearance: system,
      recordFirstPaint: true,
    })

    // 1: the page, the window's background and what macOS draws, in the appearance picked.
    await expectShownFromTheStart(app, picked)
    await expectWindowIn(app, picked)
    await expectColors(app, app.page.getByTestId('database-error'), picked, {
      background: 'background',
      text: 'foreground',
    })
    expect(await app.themeSource()).toBe(picked)

    // 2: no way to the settings: no Settings row, nor Settings… in the menu bar, which is as
    // it was (the Hoot, Edit and Window menus macOS apps have); ⌘, changes nothing.
    await expect(settingsEntry(app)).toHaveCount(0)
    const menu = await app.applicationMenu()
    expect(menu.map((entry) => entry.label)).toEqual(['Hoot', 'Edit', 'Window'])
    expect(
      (menu[0]!.submenu ?? []).map((entry) => [entry.label, entry.type, entry.accelerator]),
    ).toEqual([
      ['About Hoot', 'normal', null],
      ['', 'separator', null],
      ['Services', 'normal', null],
      ['', 'separator', null],
      ['Hide Hoot', 'normal', 'Command+H'],
      ['Hide Others', 'normal', 'Command+Alt+H'],
      ['Show All', 'normal', null],
      ['', 'separator', null],
      ['Quit Hoot', 'normal', 'CommandOrControl+Q'],
    ])
    // The same as the menu bar Electron makes of those three menus.
    const defaults = await app.electronApp.evaluate(({ Menu }) => {
      const describe = (built: Electron.Menu): unknown[] =>
        built.items.map((item) => [
          item.label,
          item.role ?? null,
          item.type,
          item.accelerator ??
            (
              item as Electron.MenuItem & { getDefaultRoleAccelerator?: () => string | undefined }
            ).getDefaultRoleAccelerator?.() ??
            null,
          item.submenu ? describe(item.submenu) : null,
        ])
      return describe(
        Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]),
      )
    })
    expect(describeMenu(menu)).toEqual(defaults)
    const before = await app.page.locator('body').innerHTML()
    await app.page.keyboard.press('Meta+Comma')
    await app.page.waitForTimeout(500)
    await expect(settingsNavigation(app)).toHaveCount(0)
    expect(await app.page.locator('body').innerHTML()).toBe(before)
  })
}

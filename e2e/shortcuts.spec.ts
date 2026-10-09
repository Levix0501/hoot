import type { AppDriver, MenuEntry } from './support/app'
import { writeEchoProgram } from './support/programs'
import { expect, test } from './support/test'

const MODIFIERS: Record<string, string> = {
  cmdorctrl: 'Cmd',
  commandorcontrol: 'Cmd',
  command: 'Cmd',
  cmd: 'Cmd',
  control: 'Ctrl',
  ctrl: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
}
const MODIFIER_ORDER = ['Cmd', 'Ctrl', 'Alt', 'Shift']

/**
 * An accelerator in one spelling, for comparing (on macOS): `Shift+CmdOrCtrl+]`
 * becomes `Cmd+Shift+]`.
 */
function normalizeAccelerator(accelerator: string): string {
  const parts = accelerator.split('+')
  const key = parts.pop()!
  const modifiers = parts
    .map((part) => MODIFIERS[part.toLowerCase()] ?? part)
    .toSorted((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b))
  return [...modifiers, key.length === 1 ? key.toUpperCase() : key].join('+')
}

/** Every item of the menu bar with the path of labels that leads to it. */
function allItems(entries: MenuEntry[], path: string[] = []): Array<MenuEntry & { path: string }> {
  return entries.flatMap((entry) => {
    const itemPath = [...path, entry.label]
    return [
      { ...entry, path: itemPath.join(' > ') },
      ...(entry.submenu ? allItems(entry.submenu, itemPath) : []),
    ]
  })
}

/** What the echo program in a session has shown of the keys it received. */
async function echoed(app: AppDriver, sessionId: string): Promise<string> {
  const lines = await app.terminalLines(sessionId)
  const ready = lines.lastIndexOf('echo ready')
  return ready === -1 ? '' : lines.slice(ready + 1).join('')
}

test.describe('keyboard shortcuts and menu items for sessions', () => {
  test('the menu bar has Close Session and next and previous session items', async ({ app }) => {
    const items = allItems(await app.applicationMenu())
    const withAccelerator = (accelerator: string) =>
      items
        .filter(
          (item) => item.accelerator && normalizeAccelerator(item.accelerator) === accelerator,
        )
        .map((item) => item.path)

    expect(withAccelerator('Cmd+W')).toEqual(['File > Close Session'])
    const file = items.filter((item) => item.path.startsWith('File > '))
    expect(file.some((item) => item.role === 'close' || /close window/i.test(item.label))).toBe(
      false,
    )
    expect(withAccelerator('Cmd+Shift+]')).toEqual(['Window > Select Next Session'])
    expect(withAccelerator('Cmd+Shift+[')).toEqual(['Window > Select Previous Session'])
    for (let digit = 1; digit <= 9; digit++) {
      const visible = items.filter(
        (item) =>
          item.visible &&
          item.accelerator !== null &&
          normalizeAccelerator(item.accelerator) === `Cmd+${digit}`,
      )
      expect(visible, `Cmd+${digit}`).toEqual([])
    }
    // Closing the window and quitting are still there.
    expect(items.some((item) => item.role === 'quit')).toBe(true)
  })

  test('Cmd+1 to Cmd+9, Cmd+Shift+] and Cmd+Shift+[ select sessions; Cmd+W closes the current one', async ({
    app,
    world,
  }) => {
    const { G, H } = world.repos
    await app.addProject(G)
    await expect(app.projectItems()).toHaveCount(1)
    await app.addProject(H)
    await expect(app.projectItems()).toHaveCount(2)
    const echo = writeEchoProgram(world)
    const sessions: string[] = []
    for (const root of [G, G, H]) {
      const id = await app.startSession(root, 'shell')
      await app.waitForPrompt()
      await app.run(echo, { waitForPrompt: false })
      await app.waitForTerminalText('echo ready', 15_000, id)
      sessions.push(id)
    }
    const [s1, s2, s3] = sessions as [string, string, string]
    expect(await app.sessionIds()).toEqual([s1, s2, s3])

    await app.sessionItem(s1).getByTestId('session-item-button').click()
    await expect(app.session()).toHaveAttribute('data-session-id', s1)
    const steps: Array<[keys: string, current: string]> = [
      ['Meta+2', s2],
      ['Meta+3', s3],
      ['Meta+1', s1],
      ['Meta+9', s1],
      ['Meta+Shift+BracketRight', s2],
      ['Meta+Shift+BracketRight', s3],
      ['Meta+Shift+BracketRight', s1],
      ['Meta+Shift+BracketLeft', s3],
      ['Meta+Shift+BracketLeft', s2],
    ]
    const letters = 'abcdefghi'
    const typed = new Map<string, string>(sessions.map((id) => [id, '']))
    for (const [index, [keys, current]] of steps.entries()) {
      await app.page.keyboard.press(keys)
      await expect(app.session(), keys).toHaveAttribute('data-session-id', current)
      // Typed where the keyboard focus is: the new current session's terminal.
      const letter = letters[index]!
      await app.page.keyboard.type(letter)
      typed.set(current, typed.get(current)! + letter)
      await expect.poll(() => echoed(app, current)).toBe(typed.get(current))
    }
    expect(Object.fromEntries(typed)).toEqual({ [s1]: 'cdg', [s2]: 'aei', [s3]: 'bfh' })
    // Nothing but the letters reached the programs.
    for (const id of sessions) expect(await echoed(app, id)).toBe(typed.get(id))
    await expect(app.closeSessionDialog()).toBeHidden()

    // Cmd+W asks before closing the current session, which runs.
    await app.page.keyboard.press('Meta+W')
    await expect(app.closeSessionDialog()).toBeVisible()
    await app.page.getByTestId('close-session-cancel').click()
    await expect(app.closeSessionDialog()).toBeHidden()
    await expect(app.session()).toHaveAttribute('data-session-id', s2)
    await expect(app.sessionItem(s2)).toHaveAttribute('data-status', 'running')
    for (const id of sessions) expect(await echoed(app, id)).toBe(typed.get(id))

    // The menu items do the same.
    await app.chooseMenuItem('Window', 'Select Next Session')
    await expect(app.session()).toHaveAttribute('data-session-id', s3)
    await app.chooseMenuItem('Window', 'Select Previous Session')
    await expect(app.session()).toHaveAttribute('data-session-id', s2)
    await app.chooseMenuItem('File', 'Close Session')
    await expect(app.closeSessionDialog()).toBeVisible()
    await app.page.getByTestId('close-session-confirm').click()
    await expect(app.sessionItem(s2)).toHaveCount(0)
    await expect(app.session()).toHaveAttribute('data-session-id', s3)

    // Cmd+W closes the session; without sessions the shortcuts do nothing.
    for (const id of [s3, s1]) {
      await expect(app.session()).toHaveAttribute('data-session-id', id)
      await app.page.keyboard.press('Meta+W')
      await app.page.getByTestId('close-session-confirm').click()
      await expect(app.sessionItem(id)).toHaveCount(0)
    }
    await expect(app.page.getByTestId('no-session')).toBeVisible()
    for (const keys of ['Meta+W', 'Meta+Shift+BracketRight', 'Meta+Shift+BracketLeft', 'Meta+1']) {
      await app.page.keyboard.press(keys)
    }
    await app.chooseMenuItem('File', 'Close Session')
    await app.chooseMenuItem('Window', 'Select Next Session')
    await app.page.waitForTimeout(500)
    await expect(app.closeSessionDialog()).toBeHidden()
    await expect(app.page.getByTestId('quit-dialog')).toBeHidden()
    expect(app.exited).toBe(false)
    await expect(app.page.getByTestId('no-session')).toBeVisible()
  })
})

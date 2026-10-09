import type { AppDriver } from './support/app'
import { expect, test } from './support/test'

/** Starts a Shell session in project G, which is in the list, and waits for its prompt. */
async function startShell(app: AppDriver): Promise<string> {
  const id = await app.startSession(app.world.repos.G, 'shell')
  await app.waitForPrompt(20_000, id)
  return id
}

test('Back and Forward go through the sessions shown, like a browser through pages', async ({
  launch,
  world,
}) => {
  let app = await launch({ projects: [world.repos.G] })
  const s1 = await startShell(app)
  const s2 = await startShell(app)
  const s3 = await startShell(app)
  // The keys pressed in S3's terminal reach `cat -v`, which shows every byte it receives.
  await app.run('cat -v', { waitForPrompt: false })
  await expect.poll(() => app.cursorLine()).toBe('')

  const shown = async (id: string) => expect(app.session()).toHaveAttribute('data-session-id', id)
  const back = app.backButton()
  const forward = app.forwardButton()

  // 1–3: back to the first session, and forward again.
  await expect(back).toBeEnabled()
  await expect(forward).toBeDisabled()
  await app.page.keyboard.press('Meta+BracketLeft')
  await shown(s2)
  await app.page.keyboard.press('Meta+BracketLeft')
  await shown(s1)
  await expect(back).toBeDisabled()
  await app.page.keyboard.press('Meta+BracketLeft')
  await app.page.waitForTimeout(300)
  await shown(s1)
  await app.page.keyboard.press('Meta+BracketRight')
  await shown(s2)
  await forward.click()
  await shown(s3)
  await expect(forward).toBeDisabled()
  expect((await app.outputOf('cat -v', s3)).join('')).toBe('')

  // 4: showing a session from the sidebar drops the way forward.
  await back.click()
  await shown(s2)
  await app.selectSession(s1)
  await expect(forward).toBeDisabled()
  await app.page.keyboard.press('Meta+BracketLeft')
  await shown(s2)
  await app.page.keyboard.press('Meta+BracketLeft')
  await shown(s1)

  // 5: so do ⌘3 and ⌘⇧[.
  await app.page.keyboard.press('Meta+3')
  await shown(s3)
  await app.page.keyboard.press('Meta+Shift+BracketLeft')
  await shown(s2)
  await app.page.keyboard.press('Meta+BracketLeft')
  await shown(s3)
  await app.page.keyboard.press('Meta+BracketLeft')
  await shown(s1)

  // 6: a session that closes leaves the history.
  await app.closeSession(s2)
  await shown(s1)
  await app.page.keyboard.press('Meta+BracketRight')
  await shown(s3)
  await app.page.keyboard.press('Meta+BracketLeft')
  await shown(s1)

  // 7: closing the shown session shows another one, without a way back or forward.
  await app.page.keyboard.press('Meta+BracketRight')
  await shown(s3)
  await app.page.getByTestId('session-header-close').click()
  await app.page.getByTestId('close-session-confirm').click()
  await expect(app.sessionItem(s3)).toHaveCount(0)
  await shown(s1)
  await expect(back).toBeDisabled()
  await expect(forward).toBeDisabled()

  // 8: the Window menu's Back and Forward.
  const s4 = await startShell(app)
  await shown(s4)
  const windowMenu = (await app.applicationMenu()).find((item) => item.label === 'Window')
  const shortcuts = Object.fromEntries(
    (windowMenu?.submenu ?? []).map((item) => [item.label, item.accelerator]),
  )
  expect(shortcuts).toMatchObject({ Back: 'CmdOrCtrl+[', Forward: 'CmdOrCtrl+]' })
  await app.chooseMenuItem('Window', 'Back')
  await shown(s1)
  await app.chooseMenuItem('Window', 'Forward')
  await shown(s4)

  // The shells received none of the shortcuts.
  for (const id of [s1, s4]) await expect.poll(() => app.cursorLine(id)).toBe(world.prompt.trim())
  await app.expectEnglishUi()

  // 9: the history lasts until Hoot quits.
  await app.quit()
  await expect(app.page.getByTestId('quit-dialog')).toBeVisible()
  await app.page.getByTestId('quit-confirm').click()
  await app.waitForExit()
  app = await launch()
  await expect(app.backButton()).toBeDisabled()
  await expect(app.forwardButton()).toBeDisabled()
})

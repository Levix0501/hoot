import fs from 'node:fs'
import path from 'node:path'
import type { AppDriver } from './support/app'
import { isRed } from './support/colors'
import { childPids, isAlive } from './support/processes'
import { substituteError, writeSubstitute } from './support/substitutes'
import { expect, test } from './support/test'

/** Starts a Shell session and waits for its first prompt. */
async function startShell(app: AppDriver, root: string): Promise<string> {
  const id = await app.startSession(root, 'shell')
  await app.waitForPrompt(20_000, id)
  return id
}

/** The labels of the items in the open context menu. */
async function menuItems(app: AppDriver): Promise<string[]> {
  return app.page
    .locator('[role="menu"] [role="menuitem"]')
    .evaluateAll((items) => items.map((item) => item.textContent?.trim() ?? ''))
}

/** Checks that nothing ends a session's process while keeping the session. */
async function expectNoEndSession(app: AppDriver, id: string): Promise<void> {
  const header = app.page.locator('[data-testid="session"] header')
  await expect(header.getByRole('button')).toHaveCount(1)
  await expect(header.getByRole('button')).toHaveAccessibleName('Close Session')
  // The row itself, and its close button.
  expect(
    await app
      .sessionItem(id)
      .locator('button')
      .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('data-testid'))),
  ).toEqual(['session-item-button', 'session-item-close'])
  await app.openSessionMenu(id)
  expect(await menuItems(app)).toEqual(['Rename', 'Close'])
  await app.closeMenus()
  for (const text of ['End Session', 'Restart', 'Stop', 'Kill', 'Terminate Session']) {
    await expect(app.page.getByText(text, { exact: true })).toHaveCount(0)
  }
}

test.describe('closing sessions and how sessions end', () => {
  test('the session header shows the name, project, status and a close button', async ({
    app,
    world,
  }) => {
    const { G } = world.repos
    await app.addProject(G)
    await expect(app.projectItems()).toHaveCount(1)
    const s = await startShell(app, G)

    await expect(app.page.getByTestId('session-name')).toHaveText('Shell')
    await expect(app.page.getByTestId('session-project')).toHaveText('G')
    await expect(app.page.getByTestId('session-status')).toHaveAttribute('data-state', 'running')
    await expect(app.page.getByTestId('session-status')).toHaveText('Running')
    await expect(app.page.getByTestId('session-header-close')).toBeVisible()
    await expectNoEndSession(app, s)
    await app.expectEnglishUi()

    await app.run('exit 3', { waitForPrompt: false })
    await expect(app.page.getByTestId('session-status')).toHaveAttribute('data-state', 'exited')
    await expect(app.page.getByTestId('session-status')).toHaveText('Exited (3)')
    await expect(app.page.getByTestId('session-header-close')).toBeVisible()
    await expectNoEndSession(app, s)
    await app.expectEnglishUi()
  })

  test('closing a running session asks first; confirming ends its process', async ({
    app,
    world,
  }) => {
    const { G } = world.repos
    await app.addProject(G)
    await expect(app.projectItems()).toHaveCount(1)
    const s1 = await startShell(app, G)
    const pid1 = await app.shellPid()
    const s2 = await startShell(app, G)
    const pid2 = await app.shellPid()
    await app.run('sleep 1000', { waitForPrompt: false })
    await expect.poll(async () => (await childPids(pid2)).length).toBeGreaterThan(0)
    const sleepPids = await childPids(pid2)
    await app.selectSession(s1)
    const dialog = app.closeSessionDialog()

    // The close button appears when the pointer is over the row. Cancel keeps the session.
    const close = app.sessionItem(s2).getByTestId('session-item-close')
    await app.page.mouse.move(1, 1)
    await expect(close).toBeHidden()
    await app.sessionItem(s2).hover()
    await expect(close).toBeVisible()
    await close.click()
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('is still running')
    await app.expectEnglishUi()
    await app.page.getByTestId('close-session-cancel').click()
    await expect(dialog).toBeHidden()
    await expect(app.sessionItem(s2)).toHaveAttribute('data-status', 'running')
    // The same shell, still running the same command.
    await app.page.waitForTimeout(500)
    expect(isAlive(pid2)).toBe(true)
    expect(await childPids(pid2)).toEqual(sleepPids)

    // Close from the context menu, and confirm.
    await app.openSessionMenu(s2)
    await app.page.getByTestId('session-context-close').click()
    await expect(dialog).toBeVisible()
    await app.page.getByTestId('close-session-confirm').click()
    await expect(app.sessionItem(s2)).toHaveCount(0)
    await expect.poll(() => isAlive(pid2)).toBe(false)
    for (const pid of sleepPids) await expect.poll(() => isAlive(pid)).toBe(false)
    await expect(app.session()).toHaveAttribute('data-session-id', s1)

    // Close the current session from the session header, and confirm.
    await app.page.getByTestId('session-header-close').click()
    await expect(dialog).toBeVisible()
    await app.page.getByTestId('close-session-confirm').click()
    await expect(app.sessionItem(s1)).toHaveCount(0)
    await expect.poll(() => isAlive(pid1)).toBe(false)
    await expect(app.page.getByTestId('no-session')).toBeVisible()
    await expect(app.page.getByTestId('terminal')).toHaveCount(0)
  })

  test('a session whose process exits with an error stays until it is closed, without asking', async ({
    app,
    world,
  }) => {
    const { G } = world.repos
    await app.addProject(G)
    await expect(app.projectItems()).toHaveCount(1)
    const s1 = await startShell(app, G)
    const s2 = await startShell(app, G)
    const dialog = app.closeSessionDialog()

    await app.run('echo before-exit; exit 3', { waitForPrompt: false })
    await expect(app.sessionItem(s2)).toHaveAttribute('data-status', 'exited')
    await expect(app.session()).toHaveAttribute('data-session-id', s2)
    expect(await app.terminalText(s2)).toContain('before-exit')
    await expect(app.sessionItem(s2).getByTestId('session-item-status')).toHaveText('Exited (3)')
    await expect(app.page.getByTestId('session-exit-message')).toHaveText(
      'Process exited with code 3.',
    )
    await expect(app.page.getByTestId('session-ended-close')).toHaveText('Close')
    await expect(app.page.getByTestId('session-ended').getByRole('button')).toHaveCount(1)
    await expect(app.page.getByText('Restart')).toHaveCount(0)
    await app.expectEnglishUi()

    await app.page.getByTestId('session-ended-close').click()
    await expect(app.sessionItem(s2)).toHaveCount(0)
    await expect(dialog).toBeHidden()
    await expect(app.session()).toHaveAttribute('data-session-id', s1)

    await app.run('exit 4', { waitForPrompt: false })
    await expect(app.sessionItem(s1)).toHaveAttribute('data-status', 'exited')
    await expect(app.sessionItem(s1).getByTestId('session-item-status')).toHaveText('Exited (4)')
    await app.openSessionMenu(s1)
    await app.page.getByTestId('session-context-close').click()
    await expect(app.sessionItem(s1)).toHaveCount(0)
    await expect(dialog).toBeHidden()
    await expect(app.page.getByTestId('no-session')).toBeVisible()
  })

  test('a session whose process exits normally closes by itself', async ({ app, world }) => {
    const { G } = world.repos
    await app.addProject(G)
    await expect(app.projectItems()).toHaveCount(1)
    const s1 = await startShell(app, G)
    const s2 = await startShell(app, G)
    const s3 = await startShell(app, G)
    const dialog = app.closeSessionDialog()

    // A session that is not shown closes; the shown session stays.
    await app.selectSession(s1)
    await app.run('sleep 2; exit 0', { waitForPrompt: false })
    await app.selectSession(s3)
    await expect(app.sessionItem(s1)).toHaveCount(1)
    await expect(app.sessionItem(s1)).toHaveCount(0, { timeout: 15_000 })
    await expect(dialog).toBeHidden()
    await expect(app.session()).toHaveAttribute('data-session-id', s3)

    // The shown session closes: the one before it is shown, with the keyboard focus.
    await app.run('exit 0', { waitForPrompt: false })
    await expect(app.sessionItem(s3)).toHaveCount(0)
    await expect(dialog).toBeHidden()
    await expect(app.session()).toHaveAttribute('data-session-id', s2)
    await app.run('echo after-close', { focus: false })
    expect(await app.outputOf('echo after-close', s2)).toEqual(['after-close'])
  })

  test('a tool that exits normally closes its session; one that fails leaves no shell behind', async ({
    launch,
    world,
  }) => {
    writeSubstitute(world.interactiveBin, 'claude', world.records, 'exit')
    writeSubstitute(world.loginBin, 'codex', world.records, 'fail')
    const app = await launch()
    const { G } = world.repos
    await app.addProject(G)
    await expect(app.projectItems()).toHaveCount(1)

    const claude = await app.startSession(G, 'claude', { waitFor: 'started' })
    await expect(app.sessionItem(claude)).toHaveCount(0, { timeout: 15_000 })
    await expect(app.page.getByTestId('no-session')).toBeVisible()

    const codex = await app.startSession(G, 'codex')
    await expect(app.sessionItem(codex)).toHaveAttribute('data-status', 'exited')
    await app.waitForTerminalText(substituteError('codex'))
    await expect(app.page.getByTestId('session-exit-message')).toHaveText(
      'Process exited with code 1.',
    )
    const marker = path.join(world.root, 'typed-after-exit')
    await app.type(`touch ${marker}`)
    await app.page.keyboard.press('Enter')
    await app.page.waitForTimeout(1_000)
    expect(fs.existsSync(marker)).toBe(false)
    const text = await app.terminalText()
    expect(text).not.toContain(world.prompt.trim())
    expect(text).not.toContain('typed-after-exit')
  })

  test('a session killed by a signal stays, and the sessions running when the pty host dies end abnormally', async ({
    app,
    world,
  }) => {
    const { G } = world.repos
    await app.addProject(G)
    await expect(app.projectItems()).toHaveCount(1)

    const s = await startShell(app, G)
    await app.run('kill -KILL $$', { waitForPrompt: false })
    await expect(app.sessionItem(s)).toHaveAttribute('data-status', 'exited')
    await expect(app.sessionItem(s).getByTestId('session-item-status')).toHaveText('SIGKILL')
    await expect(app.sessionItem(s).getByTestId('session-item-status')).toHaveAttribute(
      'title',
      'Process terminated by signal SIGKILL.',
    )
    await expect(app.page.getByTestId('session-exit-message')).toHaveText(
      'Process terminated by signal SIGKILL.',
    )
    await expect(app.page.getByTestId('session-ended-close')).toBeVisible()

    const u1 = await startShell(app, G)
    await app.run('echo alive')
    const shell1 = await app.shellPid()
    const u2 = await startShell(app, G)
    await app.run('echo alive')
    const shell2 = await app.shellPid()
    const ptyHostPid = await app.ptyHostPid()
    expect(ptyHostPid).toBeDefined()

    process.kill(ptyHostPid!, 'SIGKILL')
    for (const id of [u1, u2]) {
      const status = app.sessionItem(id).getByTestId('session-item-status')
      await expect(app.sessionItem(id)).toHaveAttribute('data-status', 'exited')
      await expect(status).toHaveText('Ended unexpectedly')
      await expect(status).toHaveAttribute('data-abnormal', 'true')
      expect(isRed(await status.evaluate((element) => getComputedStyle(element).color))).toBe(true)
      expect(await app.terminalText(id)).toContain('alive')
    }
    await expect(app.sessionItems()).toHaveCount(3)
    await expect(app.sessionItem(s).getByTestId('session-item-status')).toHaveText('SIGKILL')
    await expect(app.page.getByTestId('session-ended')).toHaveAttribute('data-abnormal', 'true')
    await expect(app.page.getByTestId('session-exit-message')).toHaveText(
      'The terminal host stopped unexpectedly. The session has ended.',
    )
    await expect(app.page.getByTestId('session-status')).toHaveText('Ended unexpectedly')
    for (const pid of [shell1, shell2]) await expect.poll(() => isAlive(pid)).toBe(false)
    expect(app.exited).toBe(false)
    await app.expectEnglishUi()

    // The window still responds, and a new session works normally.
    await startShell(app, G)
    await app.run('echo still-working')
    expect(await app.outputOf('echo still-working')).toEqual(['still-working'])
    expect(await app.ptyHostPid()).not.toBe(ptyHostPid)
  })

  test('closing the shown session shows the next one, or the previous one after the last', async ({
    app,
    world,
  }) => {
    const { G, H } = world.repos
    await app.addProject(G)
    await expect(app.projectItems()).toHaveCount(1)
    await app.addProject(H)
    await expect(app.projectItems()).toHaveCount(2)
    const s1 = await startShell(app, G)
    const s2 = await startShell(app, G)
    const s3 = await startShell(app, H)
    expect(await app.sessionIds()).toEqual([s1, s2, s3])

    await app.selectSession(s2)
    await app.run('exit 0', { waitForPrompt: false })
    await expect(app.sessionItem(s2)).toHaveCount(0)
    await expect(app.session()).toHaveAttribute('data-session-id', s3)
    await app.run('echo next', { focus: false })
    expect(await app.outputOf('echo next', s3)).toEqual(['next'])

    await app.page.getByTestId('session-header-close').click()
    await app.page.getByTestId('close-session-confirm').click()
    await expect(app.sessionItem(s3)).toHaveCount(0)
    await expect(app.session()).toHaveAttribute('data-session-id', s1)
    await app.run('echo previous', { focus: false })
    expect(await app.outputOf('echo previous', s1)).toEqual(['previous'])

    await app.run('exit 0', { waitForPrompt: false })
    await expect(app.sessionItem(s1)).toHaveCount(0)
    await expect(app.page.getByTestId('no-session')).toBeVisible()
  })
})

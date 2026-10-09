import { isAlive } from './support/processes'
import { expect, test } from './support/test'

test.describe('closing the window and quitting', () => {
  test('closing the window without a running session quits Hoot', async ({ app, world }) => {
    await app.addProject(world.repos.G)
    await expect(app.projectItems()).toHaveCount(1)
    const pids = [app.mainPid, ...(await app.appProcesses()).map((entry) => entry.pid)]

    await app.closeWindow()
    await app.waitForExit()
    for (const pid of pids)
      await expect.poll(() => isAlive(pid), { message: `pid ${pid}` }).toBe(false)
  })

  test('with running sessions, closing and quitting ask first, saying how many; cancel keeps them, confirm quits', async ({
    app,
    world,
  }) => {
    const { G } = world.repos
    await app.addProject(G)
    await expect(app.projectItems()).toHaveCount(1)
    const shells: Array<{ id: string; pid: number }> = []
    for (let count = 0; count < 3; count++) {
      const id = await app.startSession(G, 'shell')
      await app.waitForPrompt()
      shells.push({ id, pid: await app.shellPid() })
    }
    const [s1, s2, s3] = shells as [(typeof shells)[0], (typeof shells)[0], (typeof shells)[0]]
    await app.run('exit 3', { waitForPrompt: false })
    await expect(app.sessionItem(s3.id)).toHaveAttribute('data-status', 'exited')
    const dialog = app.page.getByTestId('quit-dialog')

    await app.closeWindow()
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Quit Hoot?')
    await expect(dialog).toContainText('2 sessions are still running. Quitting will end them.')
    await app.expectEnglishUi()
    await app.page.getByTestId('quit-cancel').click()
    await expect(dialog).toBeHidden()
    await app.page.waitForTimeout(500)
    expect(app.exited).toBe(false)
    for (const { id, pid } of [s1, s2]) {
      expect(isAlive(pid)).toBe(true)
      await app.selectSession(id)
      await expect(app.sessionItem(id)).toHaveAttribute('data-status', 'running')
      await app.run('echo still-running')
      expect(await app.outputOf('echo still-running')).toEqual(['still-running'])
    }

    const pids = [app.mainPid, ...(await app.appProcesses()).map((entry) => entry.pid)]
    await app.quit()
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('2 sessions are still running.')
    await app.expectEnglishUi()
    await app.page.getByTestId('quit-confirm').click()
    await app.waitForExit()
    for (const pid of [...pids, s1.pid, s2.pid]) {
      await expect.poll(() => isAlive(pid), { message: `pid ${pid}` }).toBe(false)
    }
  })

  test('with one running session, the question says so', async ({ app, world }) => {
    const { G } = world.repos
    await app.addProject(G)
    await expect(app.projectItems()).toHaveCount(1)
    await app.startSession(G, 'shell')
    await app.waitForPrompt()
    const dialog = app.page.getByTestId('quit-dialog')

    await app.quit()
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('1 session is still running. Quitting will end it.')
    await expect(app.page.getByTestId('quit-confirm')).toHaveText('End Session and Quit')
    await app.page.getByTestId('quit-cancel').click()
    await expect(dialog).toBeHidden()
    expect(app.exited).toBe(false)
  })
})

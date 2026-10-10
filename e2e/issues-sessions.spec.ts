import { clickProjectRow, expectList, expectShown } from './support/issues'
import { expect, test } from './support/test'

test.describe('sessions beside Issues pages (A15)', () => {
  test('a session runs on while an issue list is shown, and has its output and the focus when shown again', async ({
    launch,
    world,
  }) => {
    const { G } = world.repos
    const app = await launch({ projects: [G] })
    const s1 = await app.startSession(G, 'shell')
    await app.waitForPrompt(20_000, s1)
    const command = 'sleep 2; echo finished'
    await app.run(command, { waitForPrompt: false })
    await clickProjectRow(app, G)
    await expectList(app, G)
    await expect(app.session()).toHaveCount(0)
    await app.page.waitForTimeout(3_000)
    await app.sessionItem(s1).getByTestId('session-item-button').click()
    await expectShown(app, `session:${s1}`)
    expect(await app.outputOf(command, s1)).toEqual(['finished'])
    await expect
      .poll(() =>
        app.page.evaluate(
          (id) => document.activeElement === window.hootTestHooks?.terminalOf(id)?.textarea,
          s1,
        ),
      )
      .toBe(true)
  })

  test('closing the shown session shows the next one, or the previous one after the last', async ({
    launch,
    world,
  }) => {
    const { G } = world.repos
    const app = await launch({ projects: [G] })
    const sessions: string[] = []
    for (let count = 0; count < 3; count++) {
      const id = await app.startSession(G, 'shell')
      await app.waitForPrompt(20_000, id)
      sessions.push(id)
    }
    const [s1, s2, s3] = sessions as [string, string, string]
    await app.selectSession(s2)
    await app.closeSession(s2)
    await expectShown(app, `session:${s3}`)
    await app.closeSession(s3)
    await expectShown(app, `session:${s1}`)
  })
})

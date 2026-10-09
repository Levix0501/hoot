import { test as base } from '@playwright/test'
import { AppDriver, type LaunchOptions } from './app'
import { createWorld, type World } from './world'

export { expect } from '@playwright/test'

interface Fixtures {
  world: World
  /** Launches Hoot in the test's world; every launched instance is closed after the test. */
  launch: (options?: LaunchOptions) => Promise<AppDriver>
  /** A Hoot instance launched before the test starts. */
  app: AppDriver
}

export const test = base.extend<Fixtures>({
  // oxlint-disable-next-line no-empty-pattern -- Playwright fixtures require a destructuring pattern.
  world: async ({}, provide) => {
    const world = createWorld()
    await provide(world)
    world.dispose()
  },
  launch: async ({ world }, provide, testInfo) => {
    const launched: AppDriver[] = []
    await provide(async (options) => {
      const app = await AppDriver.launch(world, options)
      launched.push(app)
      return app
    })
    for (const [index, app] of launched.entries()) {
      if (testInfo.status !== testInfo.expectedStatus && !app.exited) {
        // Keep what the window showed for diagnosing the failure.
        const screenshot = await app.page.screenshot().catch(() => null)
        if (screenshot) {
          await testInfo.attach(`window-${index}.png`, {
            body: screenshot,
            contentType: 'image/png',
          })
        }
        const text = await app.terminalText().catch(() => '')
        await testInfo.attach(`terminal-${index}.txt`, { body: text, contentType: 'text/plain' })
      }
      await app.close().catch(() => undefined)
    }
  },
  app: async ({ launch }, provide) => {
    await provide(await launch())
  },
})

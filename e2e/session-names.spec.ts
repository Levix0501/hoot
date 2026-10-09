import type { AppDriver } from './support/app'
import { readRuns, say, writeSubstitute } from './support/substitutes'
import { expect, test } from './support/test'
import type { World } from './support/world'

type Tool = 'claude' | 'codex' | 'opencode'

/** Puts a substitute for every coding tool on the login shell PATH. */
function writeSubstitutes(world: World): void {
  writeSubstitute(world.interactiveBin, 'claude', world.records)
  writeSubstitute(world.loginBin, 'codex', world.records)
  writeSubstitute(world.laterBin, 'opencode', world.records)
}

/** A running substitute session and the means to make it set its terminal title. */
interface TitledSession {
  id: string
  /** Sets the terminal title with OSC 0, or OSC 2, and waits until the terminal has it. */
  setTitle(title: string, osc?: 0 | 2): Promise<void>
}

async function startTitled(app: AppDriver, root: string, tool: Tool): Promise<TitledSession> {
  const runs = readRuns(app.world.records, tool).length
  const id = await app.startSession(root, tool)
  await expect.poll(() => readRuns(app.world.records, tool).length).toBe(runs + 1)
  const { pid } = readRuns(app.world.records, tool).at(-1)!
  await app.waitForTerminalText(`substitute ${tool} started`, 15_000, id)
  let count = 0
  return {
    id,
    async setTitle(title, osc = 0) {
      // The marker printed after the title shows when the terminal has handled it.
      const marker = `title-set-${++count}`
      say(app.world.records, tool, pid, `\x1b]${osc};${title}\x07${marker}\r\n`)
      await app.waitForTerminalText(marker, 15_000, id)
    },
  }
}

/** Checks the name a session's row shows, and the session header when the session is shown. */
async function expectName(app: AppDriver, id: string, name: string): Promise<void> {
  await expect(app.sessionItemName(id)).toHaveText(name)
  if ((await app.currentSessionId()) === id) {
    await expect(app.page.getByTestId('session-name')).toHaveText(name)
  }
}

test.describe('session names', () => {
  test('a session is named after its terminal title, without the mark Claude Code puts first', async ({
    launch,
    world,
  }) => {
    writeSubstitutes(world)
    const app = await launch()
    const { G } = world.repos
    await app.addProject(G)
    await expect(app.projectItems()).toHaveCount(1)
    const x = await startTitled(app, G, 'codex')
    const p = await startTitled(app, G, 'opencode')
    const c = await startTitled(app, G, 'claude')
    await expect(app.session()).toHaveAttribute('data-session-id', c.id)

    // No title yet: the tool's name.
    await expectName(app, c.id, 'Claude Code')
    await expect(app.page.getByTestId('session-project')).toHaveText('G')
    const titles: Array<[title: string, name: string]> = [
      ['✳ Claude Code', 'Claude Code'],
      ['◐ Fix login bug', 'Fix login bug'],
      ['◑ Fix login bug', 'Fix login bug'],
      ['✳ Fix login bug', 'Fix login bug'],
      ['Plain title', 'Plain title'],
      ['✳ ', 'Claude Code'],
      ['', 'Claude Code'],
    ]
    for (const [title, name] of titles) {
      await c.setTitle(title)
      await expectName(app, c.id, name)
      await expect(app.page.getByTestId('session-project')).toHaveText('G')
    }

    // Other tools' titles are used as they are, OSC 2 as well as OSC 0.
    await x.setTitle('⠙ Fix tests | G', 2)
    await expectName(app, x.id, '⠙ Fix tests | G')
    await p.setTitle('✳ Not stripped')
    await expectName(app, p.id, '✳ Not stripped')
    await p.setTitle('')
    await expectName(app, p.id, 'OpenCode')
    await expectName(app, c.id, 'Claude Code')
    await app.expectEnglishUi()
  })

  test('a session can be renamed; an empty name gives it its default name again', async ({
    launch,
    world,
  }) => {
    writeSubstitute(world.interactiveBin, 'claude', world.records)
    const app = await launch()
    const { G } = world.repos
    await app.addProject(G)
    await expect(app.projectItems()).toHaveCount(1)
    const c = await startTitled(app, G, 'claude')
    await c.setTitle('✳ Fix login bug')
    await expectName(app, c.id, 'Fix login bug')
    const input = app.sessionItem(c.id).getByTestId('session-rename-input')

    // Double-click the row: Enter saves the name.
    await app.sessionItem(c.id).getByTestId('session-item-button').dblclick()
    await expect(input).toBeVisible()
    await expect(input).toBeFocused()
    await expect(input).toHaveValue('Fix login bug')
    await input.fill('Auth work')
    await input.press('Enter')
    await expect(input).toHaveCount(0)
    await expectName(app, c.id, 'Auth work')
    await c.setTitle('✳ Another topic')
    await expectName(app, c.id, 'Auth work')
    await app.expectEnglishUi()

    // Rename from the context menu: Esc keeps the name.
    await app.openSessionMenu(c.id)
    await app.page.getByTestId('session-context-rename').click()
    await expect(input).toBeVisible()
    await expect(input).toBeFocused()
    await input.fill('Draft')
    await input.press('Escape')
    await expect(input).toHaveCount(0)
    await expectName(app, c.id, 'Auth work')

    // An empty name: the name follows the terminal title again.
    await app.openSessionMenu(c.id)
    await app.page.getByTestId('session-context-rename').click()
    await expect(input).toBeFocused()
    await input.fill('')
    await input.press('Enter')
    await expect(input).toHaveCount(0)
    await expectName(app, c.id, 'Another topic')
    await c.setTitle('◐ Third topic')
    await expectName(app, c.id, 'Third topic')
  })
})

import type { AppDriver } from './support/app'
import { isGreen, isTransparent } from './support/colors'
import { expect, test } from './support/test'

/** Adds the projects G and H, in that order. */
async function addProjects(app: AppDriver): Promise<void> {
  const { G, H } = app.world.repos
  await app.addProject(G)
  await expect(app.projectItems()).toHaveCount(1)
  await app.addProject(H)
  await expect(app.projectItems()).toHaveCount(2)
}

/** Starts a Shell session and waits for its first prompt. */
async function startShell(app: AppDriver, root: string): Promise<string> {
  const id = await app.startSession(root, 'shell')
  await app.waitForPrompt(20_000, id)
  return id
}

/** Numbered lines (`line N`) in a session's terminal, scrollback included. */
async function numberedLines(app: AppDriver, sessionId: string): Promise<string[]> {
  return (await app.terminalLines(sessionId)).filter((line) => /^line \d+$/.test(line))
}

/** The `line N` lines from `first` to `last`. */
function lineRange(first: number, last: number): string[] {
  return Array.from({ length: last - first + 1 }, (_, index) => `line ${first + index}`)
}

/** Whether the project's session rows come right after its project row, among the sidebar's rows. */
async function sessionsFollowProject(app: AppDriver, root: string): Promise<boolean> {
  return app.page.evaluate((projectRoot) => {
    const rows = Array.from(
      document.querySelectorAll(
        '[data-testid="project-item"], [data-testid="session-item"], [data-testid="worktree-item"]',
      ),
    )
    const project = rows.findIndex(
      (row) =>
        row.getAttribute('data-testid') === 'project-item' &&
        row.getAttribute('data-project-root') === projectRoot,
    )
    const sessions = Array.from(
      document.querySelectorAll(
        `[data-testid="session-list"][data-project-root="${projectRoot}"] [data-testid="session-item"]`,
      ),
    )
    return (
      project !== -1 &&
      sessions.length > 0 &&
      sessions.every((session, index) => rows[project + 1 + index] === session)
    )
  }, root)
}

/** The background color a session row shows. */
async function rowBackground(app: AppDriver, id: string): Promise<string> {
  return app
    .sessionItem(id)
    .getByTestId('session-item-button')
    .evaluate((element) => getComputedStyle(element).backgroundColor)
}

/** Which session rows are highlighted, in sidebar order. */
async function highlightedRows(app: AppDriver): Promise<string[]> {
  // Keep the pointer off the rows: hovering a row also colors it.
  await app.page.mouse.move(1, 1)
  const highlighted: string[] = []
  for (const id of await app.sessionIds()) {
    const button = app.sessionItem(id).getByTestId('session-item-button')
    const active = (await button.getAttribute('data-active')) !== null
    expect(isTransparent(await rowBackground(app, id)), `${id} background`).toBe(!active)
    if (active) highlighted.push(id)
  }
  return highlighted
}

test.describe('multiple sessions', () => {
  test('sessions run at the same time, in one project and in different projects', async ({
    app,
    world,
  }) => {
    const { G, H } = world.repos
    await addProjects(app)

    const started: string[] = []
    for (const root of [G, G, H]) {
      // Sessions that already run never make the new session menus unavailable.
      for (const project of [G, H]) {
        await expect(app.newSessionButton(project)).toBeEnabled()
        await app.projectItem(project).click({ button: 'right' })
        await expect(app.page.getByTestId('context-new-session')).not.toHaveAttribute(
          'data-disabled',
        )
        await app.closeMenus()
      }
      // The last one from the project's context menu, the others from its "+" button.
      const id = await app.startSession(root, 'shell', {
        from: root === H ? 'context-menu' : 'button',
      })
      started.push(id)
      // The new session is shown at once, and the keyboard focus is in its terminal.
      await expect(app.session()).toHaveAttribute('data-session-id', id)
      await app.waitForPrompt()
      await app.run('echo started', { focus: false })
      expect(await app.outputOf('echo started')).toEqual(['started'])
    }
    const [s1, s2, s3] = started as [string, string, string]
    expect(new Set(started).size).toBe(3)
    for (const id of started) {
      await expect(app.sessionItem(id)).toHaveAttribute('data-status', 'running')
    }

    await app.run('echo only-s3', { focus: false })
    expect(await app.outputOf('echo only-s3')).toEqual(['only-s3'])
    expect(await app.terminalText(s3)).toContain('only-s3')
    for (const id of [s1, s2]) {
      expect(await app.terminalText(id)).toContain('started')
      expect(await app.terminalText(id)).not.toContain('only-s3')
    }
    await app.expectEnglishUi()

    // Clicking a session row shows that session, with the keyboard focus in its terminal.
    expect(await app.sessionIds(G)).toEqual([s1, s2])
    expect(await app.sessionIds(H)).toEqual([s3])
    expect(await sessionsFollowProject(app, G)).toBe(true)
    expect(await sessionsFollowProject(app, H)).toBe(true)
    for (const id of started) {
      const item = app.sessionItem(id)
      await expect(item.locator('[data-tool-icon="shell"]')).toBeVisible()
      await expect(item.getByTestId('session-item-name')).toHaveText('Shell')
      const dot = item.getByTestId('session-item-status')
      await expect(dot).toHaveAttribute('data-state', 'running')
      await expect(dot).toBeVisible()
      expect(
        isGreen(await dot.evaluate((element) => getComputedStyle(element).backgroundColor)),
      ).toBe(true)
    }
    expect(await highlightedRows(app)).toEqual([s3])

    await app.sessionItem(s1).getByTestId('session-item-button').click()
    await expect(app.session()).toHaveAttribute('data-session-id', s1)
    expect(await highlightedRows(app)).toEqual([s1])
    await app.run('echo clicked', { focus: false })
    expect(await app.outputOf('echo clicked', s1)).toEqual(['clicked'])
    for (const id of [s2, s3]) expect(await app.terminalText(id)).not.toContain('clicked')
  })

  test('the number of sessions is not limited', async ({ app, world }) => {
    const { G } = world.repos
    await app.addProject(G)
    await expect(app.projectItems()).toHaveCount(1)

    const started: string[] = []
    for (let count = 0; count < 12; count++) started.push(await app.startSession(G, 'shell'))
    await expect(app.sessionItems(G)).toHaveCount(12)
    expect(await app.sessionIds(G)).toEqual(started)
    expect(await sessionsFollowProject(app, G)).toBe(true)
    for (const id of started) {
      await expect(app.sessionItem(id)).toHaveAttribute('data-status', 'running')
    }
    await expect(app.session()).toHaveAttribute('data-session-id', started.at(-1)!)
    await app.waitForPrompt()
    await app.run('echo last', { focus: false })
    expect(await app.outputOf('echo last')).toEqual(['last'])
  })

  test('output that arrives while a session is not shown is all there when it is shown again', async ({
    app,
    world,
  }) => {
    const { G } = world.repos
    await app.addProject(G)
    await expect(app.projectItems()).toHaveCount(1)
    const s1 = await startShell(app, G)
    const s2 = await startShell(app, G)
    await app.selectSession(s1)

    for (const count of [3_000, 12_000]) {
      const earlier = await numberedLines(app, s1)
      const command = `sleep 2; seq -f 'line %g' 1 ${count}`
      await app.run(command, { waitForPrompt: false })
      await app.selectSession(s2)
      // S2 is shown before S1 starts printing.
      expect(await numberedLines(app, s1)).toEqual(earlier)
      await app.waitForPrompt(60_000, s1)
      await expect(app.sessionItem(s1)).toHaveAttribute('data-status', 'running')
      await app.selectSession(s1)
      if (count === 3_000) {
        expect(await numberedLines(app, s1)).toEqual(lineRange(1, 3_000))
      } else {
        // At least 10,000 lines of scrollback: everything from line 2001 on is kept.
        const lines = await numberedLines(app, s1)
        const first = lines.indexOf('line 2001')
        expect(first).toBeGreaterThanOrEqual(0)
        expect(lines.slice(first)).toEqual(lineRange(2_001, 12_000))
      }
    }
  })

  test('a session shown again after the window was resized fills the area at the new size', async ({
    app,
    world,
  }) => {
    const { G } = world.repos
    await app.addProject(G)
    await expect(app.projectItems()).toHaveCount(1)
    const s1 = await startShell(app, G)
    const s2 = await startShell(app, G)
    await app.selectSession(s1)
    const before = await app.terminalSize()

    await app.selectSession(s2)
    await app.setWindowSize(1000, 640)
    await app.selectSession(s1)
    await expect
      .poll(async () => {
        const geometry = await app.terminalGeometry()
        const size = await app.terminalSize()
        const slackX = geometry.areaWidth - geometry.scrollbarWidth - size.cols * geometry.cellWidth
        const slackY = geometry.areaHeight - size.rows * geometry.cellHeight
        // The grid fills the area: besides the scrollbar, less than one cell is left.
        return (
          slackX >= 0 && slackX < geometry.cellWidth && slackY >= 0 && slackY < geometry.cellHeight
        )
      })
      .toBe(true)
    const size = await app.terminalSize()
    expect(size.cols).not.toBe(before.cols)
    expect(size.rows).not.toBe(before.rows)
    await app.run('stty size')
    expect(await app.outputOf('stty size')).toEqual([`${size.rows} ${size.cols}`])
  })
})

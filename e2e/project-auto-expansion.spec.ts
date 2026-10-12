import type { AppDriver } from './support/app'
import { expectShown } from './support/issues'
import { isExpanded, movePointerAway, rowsShownBelow, setExpanded } from './support/projects'
import { expect, test, type Launch } from './support/test'
import type { World } from './support/world'
import {
  createWorktree,
  newWorktreeDialog,
  openNewWorktreeDialog,
  startWorktreeSession,
  typeBranch,
  worktreeNamed,
} from './support/worktrees'

interface Scenario {
  app: AppDriver
  G: string
  H: string
  /** G's worktree. */
  W: string
  /** The session in G's main worktree. */
  s1: string
  /** The session in W. */
  s2: string
  /** The session in H. */
  t: string
}

/**
 * G with a session S1 in its main worktree and a worktree W with a session
 * S2; H with a session T. In sidebar order: S1, S2, T.
 */
async function scenario(launch: Launch, world: World): Promise<Scenario> {
  const { G, H } = world.repos
  const app = await launch({ projects: [G, H] })
  const W = await createWorktree(app, G, 'feature-x')
  const s1 = await app.startSession(G, 'shell')
  const s2 = await startWorktreeSession(app, W, 'shell')
  const t = await app.startSession(H, 'shell')
  for (const id of [s1, s2, t]) await app.waitForPrompt(20_000, id)
  expect(await app.sessionIds()).toEqual([s1, s2, t])
  return { app, G, H, W, s1, s2, t }
}

/** Shows T and collapses G, as every step starts. */
async function startStep({ app, G, t }: Scenario): Promise<void> {
  await app.selectSession(t)
  await setExpanded(app, G, false)
  await expectShown(app, `session:${t}`)
  expect(await isExpanded(app, G)).toBe(false)
}

/** Checks that a session of G is the current one, with G expanded and its row selected. */
async function expectCurrentInG({ app, G }: Scenario, id: string): Promise<void> {
  await expectShown(app, `session:${id}`)
  await expect.poll(() => isExpanded(app, G)).toBe(true)
  await expect(app.sessionItem(id)).toBeVisible()
  await expect(app.sessionItem(id).getByTestId('session-item-button')).toHaveAttribute(
    'data-active',
    '',
  )
}

test.describe('a collapsed project expands when one of its sessions becomes the current one', () => {
  test('selected with the keyboard, the Window menu, Back or Forward', async ({
    launch,
    world,
  }) => {
    const sc = await scenario(launch, world)
    const { app, G, W, s1, s2, t } = sc

    // 1 and 2: ⌘1 and ⌘2, with W's row and S2's row below G.
    await startStep(sc)
    await app.page.keyboard.press('Meta+1')
    await expectCurrentInG(sc, s1)
    await startStep(sc)
    await app.page.keyboard.press('Meta+2')
    await expectCurrentInG(sc, s2)
    expect(await rowsShownBelow(app, G)).toEqual([
      `session:${s1}`,
      `worktree:${W}`,
      `session:${s2}`,
    ])

    // 3: the previous and the next session, from the last to the first, by key and by menu.
    for (const [select, id] of [
      [() => app.page.keyboard.press('Meta+Shift+BracketLeft'), s2],
      [() => app.page.keyboard.press('Meta+Shift+BracketRight'), s1],
      [() => app.chooseMenuItem('Window', 'Select Previous Session'), s2],
      [() => app.chooseMenuItem('Window', 'Select Next Session'), s1],
    ] as const) {
      await startStep(sc)
      await select()
      await expectCurrentInG(sc, id)
    }

    // 4: Back to S1, shown before T; Forward to S1, shown after T. By key, button and menu.
    for (const [back, forward] of [
      [
        () => app.page.keyboard.press('Meta+BracketLeft'),
        () => app.page.keyboard.press('Meta+BracketRight'),
      ],
      [() => app.backButton().click(), () => app.forwardButton().click()],
      [() => app.chooseMenuItem('Window', 'Back'), () => app.chooseMenuItem('Window', 'Forward')],
    ] as const) {
      await app.page.keyboard.press('Meta+1')
      await expectCurrentInG(sc, s1)
      await startStep(sc)
      await back()
      await expectCurrentInG(sc, s1)

      await app.selectSession(t)
      await app.page.keyboard.press('Meta+1')
      await expectCurrentInG(sc, s1)
      await back()
      await expectShown(app, `session:${t}`)
      await setExpanded(app, G, false)
      await forward()
      await expectCurrentInG(sc, s1)
    }

    // 7: ⌘1 to ⌘3 select the same sessions with G collapsed as with G expanded.
    for (const expanded of [true, false]) {
      for (const [key, id] of [
        ['Meta+1', s1],
        ['Meta+2', s2],
        ['Meta+3', t],
      ] as const) {
        await setExpanded(app, G, expanded)
        await app.page.keyboard.press(key)
        await expectShown(app, `session:${id}`)
      }
    }
    await expect.poll(() => isExpanded(app, G)).toBe(false)
    await app.expectEnglishUi()
  })

  test('started from the project’s menus, or shown when the current session closes', async ({
    launch,
    world,
  }) => {
    const sc = await scenario(launch, world)
    const { app, G, s1, s2, t } = sc

    // 5: from the row's + menu and from its context menu.
    const started: string[] = []
    for (const from of ['button', 'context-menu'] as const) {
      await startStep(sc)
      const id = await app.startSession(G, 'shell', { from })
      await expectCurrentInG(sc, id)
      started.push(id)
    }
    for (const id of started) await app.closeSession(id)
    expect(await app.sessionIds()).toEqual([s1, s2, t])

    // 6: closing T, the last session, shows S2, the one before it.
    await startStep(sc)
    await app.page.keyboard.press('Meta+W')
    await expect(app.closeSessionDialog()).toBeVisible()
    await app.page.getByTestId('close-session-confirm').click()
    await expect(app.sessionItem(t)).toHaveCount(0)
    await expectCurrentInG(sc, s2)
  })

  test('also after a worktree is created from its menus', async ({ launch, world }) => {
    const sc = await scenario(launch, world)
    const { app, G } = sc

    // 8: from the row's + menu, then from its context menu.
    await startStep(sc)
    const X = await createWorktree(app, G, 'x-from-menu')
    await expect.poll(() => isExpanded(app, G)).toBe(true)
    await expect(worktreeNamed(app, G, 'x-from-menu')).toBeVisible()
    expect(await rowsShownBelow(app, G)).toContain(`worktree:${X}`)

    await startStep(sc)
    await openNewWorktreeDialog(app, G, 'context-menu')
    await typeBranch(app, 'y-from-context-menu')
    const create = app.page.getByTestId('worktree-create')
    await expect(create).toBeEnabled()
    await create.click()
    await expect(newWorktreeDialog(app)).toBeHidden({ timeout: 30_000 })
    await movePointerAway(app)
    await expect.poll(() => isExpanded(app, G)).toBe(true)
    await expect(worktreeNamed(app, G, 'y-from-context-menu')).toBeVisible()
  })
})

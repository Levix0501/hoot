import fs from 'node:fs'
import path from 'node:path'
import type { AppDriver } from './support/app'
import { clickIssuesButton, expectList, expectShown, projectRowButton } from './support/issues'
import { boxOf } from './support/layout'
import { sameColor } from './support/pixels'
import {
  blur,
  clickProjectRow,
  createRepository,
  folderIcon,
  isExpanded,
  movePointerAway,
  rowButtons,
  rowsShownBelow,
  setExpanded,
} from './support/projects'
import { expect, test } from './support/test'
import { createWorktree, startWorktreeSession } from './support/worktrees'

/** How long the rows below a project take to slide open or closed, as the sidebar does. */
const SLIDE_MS = 200

/** Whether Back and Forward can be used now. */
async function navigation(app: AppDriver): Promise<{ back: boolean; forward: boolean }> {
  return {
    back: await app.backButton().isEnabled(),
    forward: await app.forwardButton().isEnabled(),
  }
}

/** Checks a project's state as the sidebar shows it: its icon and the rows below it. */
async function expectProject(
  app: AppDriver,
  root: string,
  expanded: boolean,
  below: string[],
): Promise<void> {
  await expect.poll(() => isExpanded(app, root)).toBe(expanded)
  expect(await folderIcon(app, root)).toBe(expanded ? 'folder-open' : 'folder')
  await expect.poll(() => rowsShownBelow(app, root)).toEqual(expanded ? below : [])
}

interface HeightSample {
  /** Milliseconds since the click. */
  time: number
  height: number
}

/**
 * Clicks a project's name and records, in every frame from the click until
 * `forMs` later, the height of the area of the rows below the project.
 */
async function clickAndFollow(app: AppDriver, root: string, forMs = 500): Promise<HeightSample[]> {
  await app.page.evaluate(
    ([projectRoot, duration]) => {
      const area = () =>
        document
          .querySelector(`[data-testid="project"][data-project-root="${projectRoot}"]`)
          ?.querySelector(':scope > [data-testid="project-rows"]')
      const height = () => area()?.getBoundingClientRect().height ?? 0
      const following = {
        samples: [] as Array<{ time: number; height: number }>,
        done: new Promise<void>((resolve) => {
          window.addEventListener(
            'click',
            () => {
              const clicked = performance.now()
              following.samples.push({ time: 0, height: height() })
              const frame = () => {
                const now = performance.now() - clicked
                following.samples.push({ time: now, height: height() })
                if (now < duration!) requestAnimationFrame(frame)
                else resolve()
              }
              requestAnimationFrame(frame)
            },
            { capture: true, once: true },
          )
        }),
      }
      ;(window as unknown as { following: typeof following }).following = following
    },
    [root, forMs] as const,
  )
  await app.projectItem(root).getByTestId('project-name').click()
  return app.page.evaluate(async () => {
    const { following } = window as unknown as {
      following: { samples: HeightSample[]; done: Promise<void> }
    }
    await following.done
    return following.samples
  })
}

/** The usual time between two frames, in milliseconds. */
function frameTime(samples: HeightSample[]): number {
  const gaps = samples
    .slice(2)
    .map((sample, index) => sample.time - samples[index + 1]!.time)
    .toSorted((a, b) => a - b)
  return gaps[Math.floor(gaps.length / 2)]!
}

/**
 * How the height went from `from` to `to`: how long from the frame in which
 * it started changing, the last to show `from`, to the first to show `to`,
 * and how many frames showed a height in between. A height within half a
 * pixel of another shows as that one.
 */
function slide(samples: HeightSample[], from: number, to: number) {
  const shows = (sample: HeightSample, height: number) => Math.abs(sample.height - height) < 0.5
  const started = samples.findIndex((sample) => !shows(sample, from)) - 1
  const arrived = samples.findIndex((sample, index) => index > started && shows(sample, to))
  const between = samples.filter((sample) => !shows(sample, from) && !shows(sample, to))
  return {
    started,
    arrived,
    duration:
      started < 0 || arrived === -1 ? Infinity : samples[arrived]!.time - samples[started]!.time,
    between: between.length,
  }
}

test.describe('expanding and collapsing projects', () => {
  test('clicking a project’s row collapses and expands it, without changing the page shown or the history', async ({
    launch,
    world,
  }) => {
    const { G, H } = world.repos
    const app = await launch({ projects: [G, H] })
    const s = await app.startSession(G, 'shell')
    const W = await createWorktree(app, G, 'feature-x')
    const w = await startWorktreeSession(app, W, 'shell')
    const t = await app.startSession(H, 'shell')
    for (const id of [s, w, t]) await app.waitForPrompt(20_000, id)
    await movePointerAway(app)
    const below = [`session:${s}`, `worktree:${W}`, `session:${w}`]

    // 1: expanded, with its rows below it.
    await expectShown(app, `session:${t}`)
    await expectProject(app, G, true, below)
    const before = await navigation(app)
    expect(before).toEqual({ back: true, forward: false })

    // 2 and 3: on its name, then elsewhere on the row (its folder icon).
    await clickProjectRow(app, G)
    await expectProject(app, G, false, below)
    await expectShown(app, `session:${t}`)
    expect(await navigation(app)).toEqual(before)
    await app.projectItem(G).getByTestId('project-folder-icon').click()
    await movePointerAway(app)
    await expectProject(app, G, true, below)
    await expectShown(app, `session:${t}`)
    expect(await navigation(app)).toEqual(before)
    // Back and Forward show what they would have shown.
    await app.backButton().click()
    await expectShown(app, `session:${w}`)
    await app.forwardButton().click()
    await expectShown(app, `session:${t}`)

    // 4: the same while G's issue list is shown.
    await clickIssuesButton(app, G)
    await expectList(app, G)
    const onList = await navigation(app)
    for (const click of [
      () => clickProjectRow(app, G),
      async () => {
        await app.projectItem(G).getByTestId('project-folder-icon').click()
        await movePointerAway(app)
      },
    ]) {
      const expanded = await isExpanded(app, G)
      await click()
      await expectProject(app, G, !expanded, below)
      await expectShown(app, `list:${G}`)
      expect(await navigation(app)).toEqual(onList)
    }
    await app.backButton().click()
    await expectShown(app, `session:${t}`)
    await app.forwardButton().click()
    await expectShown(app, `list:${G}`)

    // 5: the row's buttons expand and collapse nothing.
    await app.selectSession(t)
    for (const expanded of [true, false]) {
      await setExpanded(app, G, expanded)
      const buttons = rowButtons(app, G)
      await buttons.issues!.click()
      await expectList(app, G)
      await movePointerAway(app)
      expect(await isExpanded(app, G)).toBe(expanded)
      for (const [button, item] of [
        [buttons.newSession!, 'new-worktree'],
        [buttons.actions!, 'remove-project'],
      ] as const) {
        await button.click()
        await expect(app.page.getByTestId(item)).toBeVisible()
        await app.closeMenus()
        await movePointerAway(app)
        await app.page.waitForTimeout(300)
        expect(await isExpanded(app, G)).toBe(expanded)
      }
      await expectProject(app, G, expanded, below)
    }
    await app.expectEnglishUi()
  })

  test('the project of the current session collapses too, and expands when the session is selected again', async ({
    launch,
    world,
  }) => {
    const { G } = world.repos
    const app = await launch({ projects: [G] })
    const s = await app.startSession(G, 'shell')
    await app.waitForPrompt(20_000, s)

    // 1: collapsed, with the session still shown.
    await clickProjectRow(app, G)
    await expectProject(app, G, false, [`session:${s}`])
    await expectShown(app, `session:${s}`)
    await app.page.waitForTimeout(500)
    expect(await isExpanded(app, G)).toBe(false)

    // 2: ⌘1, the key of the session, selects it again.
    await app.page.keyboard.press('Meta+1')
    await expectProject(app, G, true, [`session:${s}`])
    await expect(app.sessionItem(s).getByTestId('session-item-button')).toHaveAttribute(
      'data-active',
      '',
    )
    await expectShown(app, `session:${s}`)
  })

  test('the rows below a project slide in as long as the sidebar slides, or show and hide at once with reduced motion', async ({
    launch,
    world,
  }) => {
    const { G } = world.repos
    const app = await launch({ projects: [G] })
    const W = await createWorktree(app, G, 'feature-x')
    for (const id of [await app.startSession(G, 'shell'), await app.startSession(G, 'shell')]) {
      await app.waitForPrompt(20_000, id)
    }
    await expect.poll(async () => (await rowsShownBelow(app, G)).length).toBe(3)
    expect(await rowsShownBelow(app, G)).toContain(`worktree:${W}`)
    await movePointerAway(app)
    await app.settle()
    const full = await app.page
      .locator(`[data-testid="project"][data-project-root="${G}"] > [data-testid="project-rows"]`)
      .evaluate((area) => area.getBoundingClientRect().height)
    expect(full).toBeGreaterThan(60)

    // 1: through heights in between, in as long as the sidebar slides.
    for (const [from, to] of [
      [full, 0],
      [0, full],
    ] as const) {
      const samples = await clickAndFollow(app, G)
      const frame = frameTime(samples)
      const { started, arrived, duration, between } = slide(samples, from, to)
      const report = JSON.stringify({ from, to, frame, samples })
      expect(samples[0]!.height, report).toBeCloseTo(from, 1)
      expect(started, report).toBeGreaterThanOrEqual(0)
      expect(arrived, report).toBeGreaterThan(started + 1)
      expect(between, report).toBeGreaterThan(0)
      expect(Math.abs(duration - SLIDE_MS), report).toBeLessThanOrEqual(frame)
      expect(samples.at(-1)!.height, report).toBeCloseTo(to, 1)
      await movePointerAway(app)
      await app.settle()
    }

    // 2: with reduced motion, all gone or all there in the first frame after the click.
    await app.page.emulateMedia({ reducedMotion: 'reduce' })
    for (const to of [0, full]) {
      const samples = await clickAndFollow(app, G, 300)
      const report = JSON.stringify({ to, samples })
      expect(samples[1]!.height, report).toBeCloseTo(to, 1)
      expect(
        samples.slice(1).every((sample) => Math.abs(sample.height - to) < 0.01),
        report,
      ).toBe(true)
      await movePointerAway(app)
    }
  })

  test('projects stay expanded or collapsed after Hoot quits, kept in settings.json', async ({
    launch,
    world,
  }) => {
    const { G, H } = world.repos
    const settingsFile = path.join(world.userData, 'settings.json')
    const settings = () =>
      fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile, 'utf8') : ''
    let app = await launch({ projects: [G, H] })
    const W = await createWorktree(app, G, 'feature-x')
    /** Expands or collapses G, and waits until settings.json has changed. */
    const setG = async (expanded: boolean) => {
      const before = settings()
      await setExpanded(app, G, expanded)
      await expect.poll(settings).not.toBe(before)
    }
    const restart = async (projects: number) => {
      await app.quit()
      await app.waitForExit()
      app = await launch()
      await expect(app.projectItems()).toHaveCount(projects)
    }

    // 1: G collapsed and H expanded, as they were left.
    await setG(false)
    expect(await isExpanded(app, H)).toBe(true)
    await restart(2)
    await expectProject(app, G, false, [`worktree:${W}`])
    await expectProject(app, H, true, [])

    // 2: with the settings.json from before G was collapsed, G is expanded.
    await setG(true)
    const copy = settings()
    await setG(false)
    await app.quit()
    await app.waitForExit()
    fs.writeFileSync(settingsFile, copy)
    app = await launch()
    await expect(app.projectItems()).toHaveCount(2)
    await expectProject(app, G, true, [`worktree:${W}`])

    // 3: a project added to the list is expanded.
    const K = createRepository(path.join(world.root, 'more', 'K'))
    await app.addProject(K)
    await expect(app.projectItems()).toHaveCount(3)
    await expectProject(app, K, true, [])

    // 4: removed while collapsed and added again, G is expanded, also after quitting.
    await setG(false)
    await app.projectItem(G).getByTestId('project-actions-button').click()
    await app.page.getByTestId('remove-project').click()
    await expect(app.projectItems()).toHaveCount(2)
    await app.addProject(G)
    await expect(app.projectItems()).toHaveCount(3)
    await expectProject(app, G, true, [`worktree:${W}`])
    await restart(3)
    await expectProject(app, G, true, [`worktree:${W}`])
    await expectProject(app, K, true, [])
    await app.expectEnglishUi()
  })
})

test('the keyboard expands and collapses a project from its row, as a click does', async ({
  launch,
  world,
}) => {
  const { G } = world.repos
  const app = await launch({ projects: [G] })
  const s = await app.startSession(G, 'shell')
  await app.waitForPrompt(20_000, s)
  await projectRowButton(app, G).focus()
  await app.page.keyboard.press('Enter')
  await expectProject(app, G, false, [`session:${s}`])
  await app.page.keyboard.press('Space')
  await expectProject(app, G, true, [`session:${s}`])
  await blur(app)
  await expectShown(app, `session:${s}`)
})

test('the rows below a project are cut off only above and below: a session’s close button shows whole, with its focus ring', async ({
  launch,
  world,
}) => {
  const { G } = world.repos
  const app = await launch({ projects: [G], deviceScaleFactor: 1 })
  const s = await app.startSession(G, 'shell')
  const W = await createWorktree(app, G, 'feature-x')
  const w = await startWorktreeSession(app, W, 'shell')
  for (const id of [s, w]) await app.waitForPrompt(20_000, id)
  await movePointerAway(app)
  await app.settle()

  // In G's main worktree and in its worktree: the close button reaches a pixel
  // past the right side of the rows, and its focus ring further.
  for (const id of [s, w]) {
    await app.sessionItem(id).getByTestId('session-item-button').focus()
    await app.page.keyboard.press('Tab')
    const close = app.sessionItem(id).getByTestId('session-item-close')
    await expect(close).toBeFocused()
    const box = await boxOf(close)
    const screenshot = await app.screenshot()
    const y = Math.round((box.top + box.bottom) / 2)
    const ring = {
      left: screenshot.pixel(Math.round(box.left) - 1, y),
      right: screenshot.pixel(Math.round(box.right), y),
      beyond: screenshot.pixel(Math.round(box.right) + 4, y),
    }
    const report = JSON.stringify({ id, box, ring })
    expect(sameColor(ring.right, ring.left), report).toBe(true)
    expect(sameColor(ring.right, ring.beyond), report).toBe(false)
  }
})

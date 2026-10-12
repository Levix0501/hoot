import path from 'node:path'
import type { AppDriver } from './support/app'
import {
  clickIssuesButton,
  expectList,
  expectShown,
  newIssueDialog,
  openIssue,
  openNewIssueDialog,
  projectRowButton,
  viewTab,
} from './support/issues'
import { boxOf, sameCssColor } from './support/layout'
import {
  blur,
  createRepository,
  isExpanded,
  movePointerAway,
  projectCard,
  rowButtons,
  setExpanded,
  shownButtons,
} from './support/projects'
import { writeSubstitute } from './support/substitutes'
import { expect, test } from './support/test'
import { createWorktree, hoverWorktree, sidebarRows, worktreeItem } from './support/worktrees'

/** What the new session menu of a project's row lists, with every tool installed. */
const TOOL_MENU =
  'Start a session with\nClaude Code\nBypass permissions\nCodex\nFull Access\nOpenCode\nAuto-approve\nShell\nRe-detect Tools'

const ALL_BUTTONS = ['issues', 'newSession', 'actions']

/** The text of each open menu, outermost first. */
async function openMenus(app: AppDriver): Promise<string[]> {
  return app.page
    .locator('[role="menu"]')
    .evaluateAll((menus) => menus.map((menu) => (menu as HTMLElement).innerText))
}

/** The usual time between two frames, in milliseconds. */
async function frameTime(app: AppDriver): Promise<number> {
  return app.page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const times: number[] = []
        const tick = (time: number) => {
          times.push(time)
          if (times.length < 12) {
            requestAnimationFrame(tick)
            return
          }
          const gaps = times
            .slice(1)
            .map((value, index) => value - times[index]!)
            .toSorted((a, b) => a - b)
          resolve(gaps[Math.floor(gaps.length / 2)]!)
        }
        requestAnimationFrame(tick)
      }),
  )
}

test.describe('a project’s row', () => {
  test('is one line, with the project’s name and how many of its issues are open, and is selected while an Issues page of the project shows', async ({
    launch,
    world,
  }) => {
    const { G, H } = world.repos
    const app = await launch({
      projects: [G, H],
      issues: [
        { root: G, title: 'A' },
        { root: G, title: 'B' },
      ],
    })
    const s = await app.startSession(G, 'shell')
    await app.waitForPrompt(20_000, s)
    await movePointerAway(app)

    // 1: G and its count on one line, H's name alone; neither shows its folder.
    await expect(app.projectItem(G).getByTestId('project-open-issues')).toHaveText('2')
    for (const root of [G, H]) {
      const row = projectRowButton(app, root)
      const name = await boxOf(row.getByTestId('project-name'))
      const box = await boxOf(row)
      expect(box.bottom - box.top).toBe(32)
      expect(name.top).toBeGreaterThanOrEqual(box.top)
      expect(name.bottom).toBeLessThanOrEqual(box.bottom)
      await expect(row.getByTestId('project-name')).toHaveText(path.basename(root))
      const text = await app.projectItem(root).evaluate((item) => ({
        shown: (item as HTMLElement).innerText,
        titles: Array.from(item.querySelectorAll('[title]')).map((e) => e.getAttribute('title')),
      }))
      expect(text.shown).not.toContain(root)
      expect(text.shown).not.toContain(path.dirname(root))
      expect(text.titles.filter((title) => title?.includes('/'))).toEqual([])
    }
    const name = await boxOf(projectRowButton(app, G).getByTestId('project-name'))
    const count = await boxOf(projectRowButton(app, G).getByTestId('project-open-issues'))
    expect(count.left).toBeGreaterThanOrEqual(name.right)
    expect(count.top).toBeLessThan(name.bottom)
    expect(count.bottom).toBeGreaterThan(name.top)
    expect((await projectRowButton(app, G).innerText()).replaceAll(/\s+/g, ' ').trim()).toBe('G 2')
    await expect(app.projectItem(H).getByTestId('project-open-issues')).toHaveCount(0)
    expect((await projectRowButton(app, H).innerText()).trim()).toBe('H')

    // 2: selected on each Issues page of G, also while its new issue dialog is open over the list,
    // in the sidebar's selected look; never with a session shown.
    const look = (root: string) =>
      projectRowButton(app, root).evaluate((element) => ({
        background: getComputedStyle(element).backgroundColor,
        accent: getComputedStyle(document.documentElement).getPropertyValue('--sidebar-accent'),
      }))
    const pages = [
      async () => clickIssuesButton(app, G),
      async () => openNewIssueDialog(app, G),
      async () => {
        await app.page.keyboard.press('Escape')
        await expect(newIssueDialog(app)).toBeHidden()
        await openIssue(app, G, 'A')
      },
    ]
    for (const show of pages) {
      await show()
      await movePointerAway(app)
      await expect(projectRowButton(app, G)).toHaveAttribute('data-active', '')
      await expect(projectRowButton(app, H)).not.toHaveAttribute('data-active')
      const selected = await look(G)
      expect(sameCssColor(selected.background, selected.accent)).toBe(true)
      expect(sameCssColor((await look(H)).background, selected.accent)).toBe(false)
    }
    await app.selectSession(s)
    await movePointerAway(app)
    await expect(app.page.locator('[data-testid="project-item-button"][data-active]')).toHaveCount(
      0,
    )
    await app.expectEnglishUi()
  })

  for (const [width, height] of [
    [1200, 780],
    [720, 480],
  ] as const) {
    test(`shows its buttons only while pointed at, while the keyboard focus is in it, or while their menu is open (${width}×${height})`, async ({
      launch,
      world,
    }) => {
      writeSubstitute(world.interactiveBin, 'claude', world.records)
      writeSubstitute(world.loginBin, 'codex', world.records)
      writeSubstitute(world.laterBin, 'opencode', world.records)
      const { G, H } = world.repos
      const app = await launch({ projects: [G, H], issues: [{ root: G, title: 'A' }] })
      await app.resizeWindow(width, height)
      // In H, so that it can be shown from its row while G is collapsed.
      const s = await app.startSession(H, 'shell')
      await app.waitForPrompt(20_000, s)
      await movePointerAway(app)
      await app.focusTerminal()

      // 1: none of them without the pointer, the focus or a menu.
      await expect.poll(() => shownButtons(app, G)).toEqual([])
      expect(await shownButtons(app, H)).toEqual([])

      // 2: Issues, + and ⋯, right of the open issue count, while the pointer is on G's row.
      await app.projectItem(G).getByTestId('project-name').hover()
      await expect.poll(() => shownButtons(app, G)).toEqual(ALL_BUTTONS)
      expect(await shownButtons(app, H)).toEqual([])
      const count = await boxOf(app.projectItem(G).getByTestId('project-open-issues'))
      const buttons = rowButtons(app, G)
      let left = count.right
      for (const name of ALL_BUTTONS) {
        const box = await boxOf(buttons[name]!)
        expect(box.left, name).toBeGreaterThanOrEqual(left)
        left = box.right
      }
      await movePointerAway(app)
      await expect.poll(() => shownButtons(app, G)).toEqual([])

      // 3: while the keyboard focus is in the row; Issues takes it, and Enter or Space presses it.
      for (const key of ['Enter', 'Space']) {
        await app.selectSession(s)
        await movePointerAway(app)
        await app.page.getByTestId('add-project').focus()
        await app.page.keyboard.press('Tab')
        await expect(projectRowButton(app, G)).toBeFocused()
        await expect.poll(() => shownButtons(app, G)).toEqual(ALL_BUTTONS)
        await app.page.keyboard.press('Tab')
        await expect(buttons.issues!).toBeFocused()
        await app.page.keyboard.press(key)
        await expectList(app, G)
        for (const next of ['newSession', 'actions']) {
          await app.page.keyboard.press('Tab')
          await expect(buttons[next]!).toBeFocused()
        }
        await app.page.keyboard.press('Tab')
        await expect.poll(() => shownButtons(app, G)).toEqual([])
        expect(await app.projectItem(G).evaluate((row) => row.matches(':focus-within'))).toBe(false)
      }

      // 4: + and ⋯ while their menus are open, with the pointer on the menu.
      for (const [name, item] of [
        ['newSession', 'tool-shell'],
        ['actions', 'remove-project'],
      ] as const) {
        await app.selectSession(s)
        await buttons[name]!.click()
        await expect(app.page.getByTestId(item)).toBeVisible()
        await app.page.locator('[role="menu"]').hover()
        await expect.poll(() => shownButtons(app, G)).toContain(name)
        await app.closeMenus()
        await movePointerAway(app)
        await expect.poll(() => shownButtons(app, G)).toEqual([])
      }

      // 5: Issues shows the list in the view it showed last, and expands or collapses nothing.
      await clickIssuesButton(app, G)
      await viewTab(app, 'backlog').click()
      await expectList(app, G, 'backlog')
      for (const expanded of [false, true]) {
        await app.selectSession(s)
        await setExpanded(app, G, expanded)
        await clickIssuesButton(app, G)
        await expectList(app, G, 'backlog')
        expect(await isExpanded(app, G)).toBe(expanded)
      }

      // 6: the menus list what they listed before.
      await blur(app)
      await app.openToolMenu(G)
      expect(await openMenus(app)).toEqual([`${TOOL_MENU}\nNew Worktree…`])
      await app.closeMenus()
      await buttons.actions!.click()
      await expect(app.page.locator('[role="menu"]')).toBeVisible()
      expect(await openMenus(app)).toEqual(['Remove from list'])
      await app.closeMenus()
      await app.openContextToolMenu(G)
      expect(await openMenus(app)).toEqual([
        'New Session\nNew Worktree…\nRemove from list',
        TOOL_MENU,
      ])
      await app.page.keyboard.press('Escape')
      await app.closeMenus()
      await app.expectEnglishUi()
    })
  }

  test('shows its card beside it when the pointer rests on it, with the project’s name and folder', async ({
    launch,
    world,
  }) => {
    // G in the home directory, J outside it.
    const G = createRepository(path.join(world.home, 'repos', 'G'))
    const J = createRepository(path.join(world.root, 'elsewhere', 'J'))
    const app = await launch({ projects: [G, J] })
    const s = await app.startSession(J, 'shell')
    await app.waitForPrompt(20_000, s)
    await movePointerAway(app)
    await expect(projectCard(app)).toHaveCount(0)
    const frame = await frameTime(app)

    // 1: 600 milliseconds after the pointer comes to rest on G's name, and not before.
    await app.page.evaluate(() => {
      const timing = { entered: -1, shown: -1 }
      ;(window as unknown as { cardTiming: typeof timing }).cardTiming = timing
      document
        .querySelector('[data-testid="project-item"]')!
        .addEventListener('mouseenter', () => (timing.entered = performance.now()), { once: true })
      new MutationObserver((_, observer) => {
        if (document.querySelector('[data-testid="project-card"]')) {
          timing.shown = performance.now()
          observer.disconnect()
        }
      }).observe(document.body, { childList: true, subtree: true })
    })
    const name = await boxOf(app.projectItem(G).getByTestId('project-name'))
    await app.page.mouse.move(name.left + 4, (name.top + name.bottom) / 2)
    await expect(projectCard(app)).toBeVisible()
    const timing = await app.page.evaluate(
      () => (window as unknown as { cardTiming: { entered: number; shown: number } }).cardTiming,
    )
    const delay = timing.shown - timing.entered
    expect(timing.entered).toBeGreaterThan(0)
    expect(Math.abs(delay - 600), `${delay} ms, frames of ${frame} ms`).toBeLessThanOrEqual(frame)
    expect(await projectCard(app).evaluate((card) => getComputedStyle(card).opacity)).toBe('1')

    // 2: right of the row, overlapping it vertically.
    const card = await boxOf(projectCard(app))
    const row = await boxOf(app.projectItem(G))
    expect(card.left).toBeGreaterThan(row.right)
    expect(card.top).toBeLessThan(row.bottom)
    expect(card.bottom).toBeGreaterThan(row.top)

    // 3: a folder icon and G; a line; a folder icon and G's folder, written with ~.
    const contents = await projectCard(app).evaluate((element) => {
      const lines: string[] = []
      const walk = (node: Element) => {
        for (const child of Array.from(node.children)) {
          if (child.tagName.toLowerCase() === 'svg') {
            lines.push(
              `icon:${Array.from(child.classList).find((token) => token.startsWith('lucide-'))}`,
            )
          } else if (child.getAttribute('role') === 'separator') {
            lines.push('separator')
          } else if (child.children.length === 0) {
            lines.push(`text:${child.textContent}`)
          } else {
            walk(child)
          }
        }
      }
      walk(element)
      return {
        lines,
        text: (element as HTMLElement).innerText,
        controls: element.querySelectorAll('button, a, input, textarea, select, [role="button"]')
          .length,
      }
    })
    expect(contents.lines).toEqual([
      'icon:lucide-folder',
      'text:G',
      'separator',
      'icon:lucide-folder',
      'text:~/repos/G',
    ])
    expect(contents.text.split('\n').filter(Boolean)).toEqual(['G', '~/repos/G'])
    expect(contents.controls).toBe(0)

    // 5: gone once the pointer has left the row, other than for the card.
    await app.page.mouse.move(card.right + 40, card.bottom + 40)
    await expect(projectCard(app)).toHaveCount(0)

    // 4: J's card, with its folder in full.
    await app.projectItem(J).getByTestId('project-name').hover()
    await expect(projectCard(app)).toBeVisible()
    await expect(projectCard(app).getByTestId('project-card-name')).toHaveText('J')
    await expect(projectCard(app).getByTestId('project-card-path')).toHaveText(J)
    await movePointerAway(app)
    await expect(projectCard(app)).toHaveCount(0)

    // The keyboard focus in the row does not show it.
    await projectRowButton(app, G).focus()
    await app.page.waitForTimeout(1_000)
    await expect(projectCard(app)).toHaveCount(0)
    await app.expectEnglishUi()
  })
})

test('a worktree’s row shows its buttons, its folder when pointed at, and does nothing when clicked', async ({
  launch,
  world,
}) => {
  const { G } = world.repos
  const app = await launch({ projects: [G] })
  const X = await createWorktree(app, G, 'feature-x')
  const s = await app.startSession(G, 'shell')
  await app.waitForPrompt(20_000, s)
  await movePointerAway(app)
  await app.focusTerminal()

  for (const testId of ['worktree-new-session-button', 'worktree-actions-button']) {
    const button = worktreeItem(app, X).getByTestId(testId)
    expect(
      await button.evaluate((element) => element.checkVisibility({ opacityProperty: true })),
    ).toBe(true)
  }
  expect((await hoverWorktree(app, X)).path).toBe(X)

  const rows = await sidebarRows(app)
  await worktreeItem(app, X).getByTestId('worktree-row').click()
  await movePointerAway(app)
  await app.page.waitForTimeout(500)
  await expectShown(app, `session:${s}`)
  expect(await sidebarRows(app)).toEqual(rows)
  expect(await isExpanded(app, G)).toBe(true)
  await expect(app.page.locator('[role="menu"], [role="dialog"]')).toHaveCount(0)
})

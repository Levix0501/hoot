import fs from 'node:fs'
import path from 'node:path'
import { expect, type Locator } from '@playwright/test'
import type { AppDriver } from './app'
import { issuesButton, projectRowButton } from './issues'
import { git } from './worktrees'

/** A project in the sidebar: its row, and the rows below it while it is expanded. */
export function projectEntry(app: AppDriver, root: string): Locator {
  return app.page.locator(`[data-testid="project"][data-project-root="${root}"]`)
}

/** The area of the rows below a project's row, which slides open and closed; gone while collapsed. */
export function rowsArea(app: AppDriver, root: string): Locator {
  return projectEntry(app, root).locator(':scope > [data-testid="project-rows"]')
}

/**
 * The rows below a project's row that show, in order: `session:<id>` and
 * `worktree:<root>`.
 */
export async function rowsShownBelow(app: AppDriver, root: string): Promise<string[]> {
  return projectEntry(app, root)
    .locator('[data-testid="session-item"], [data-testid="worktree-item"]')
    .evaluateAll((rows) =>
      rows
        .filter((row) => {
          const box = row.getBoundingClientRect()
          return row.checkVisibility({ opacityProperty: true }) && box.height > 0
        })
        .map((row) =>
          row.getAttribute('data-testid') === 'session-item'
            ? `session:${row.getAttribute('data-session-id')}`
            : `worktree:${row.getAttribute('data-worktree-path')}`,
        ),
    )
}

/** Whether a project is expanded, as its row says to assistive technologies. */
export async function isExpanded(app: AppDriver, root: string): Promise<boolean> {
  return (await projectRowButton(app, root).getAttribute('aria-expanded')) === 'true'
}

/** The lucide icon at the left end of a project's row: `folder`, `folder-open`, or `null` for another. */
export async function folderIcon(app: AppDriver, root: string): Promise<string | null> {
  return app
    .projectItem(root)
    .getByTestId('project-item-button')
    .locator('svg')
    .first()
    .evaluate(
      (icon) =>
        ['folder', 'folder-open'].find((name) => icon.classList.contains(`lucide-${name}`)) ?? null,
    )
}

/** Moves the pointer off the sidebar's rows, to the window's top left corner. */
export async function movePointerAway(app: AppDriver): Promise<void> {
  await app.page.mouse.move(1, 1)
}

/** Takes the keyboard focus off whatever has it, such as a row's button. */
export async function blur(app: AppDriver): Promise<void> {
  await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
}

/**
 * Clicks a project's row on its name, which expands or collapses the
 * project, and waits until it is in the other state and its rows have slid;
 * then moves the pointer off the row.
 */
export async function clickProjectRow(app: AppDriver, root: string): Promise<void> {
  const expanded = await isExpanded(app, root)
  await app.projectItem(root).getByTestId('project-name').click()
  await expect(projectRowButton(app, root)).toHaveAttribute('aria-expanded', String(!expanded))
  await movePointerAway(app)
  await app.settle()
}

/** Expands or collapses a project by clicking its row, unless it is in that state already. */
export async function setExpanded(app: AppDriver, root: string, expanded: boolean): Promise<void> {
  if ((await isExpanded(app, root)) !== expanded) await clickProjectRow(app, root)
}

/** The buttons of a project's row, by name. */
export function rowButtons(app: AppDriver, root: string): Record<string, Locator> {
  return {
    issues: issuesButton(app, root),
    newSession: app.newSessionButton(root),
    actions: app.projectItem(root).getByTestId('project-actions-button'),
  }
}

/**
 * The buttons a project's row shows, by name, left to right: those the user
 * can see, neither left out nor fully transparent.
 */
export async function shownButtons(app: AppDriver, root: string): Promise<string[]> {
  const names: Record<string, string> = {
    'project-issues-button': 'issues',
    'new-session-button': 'newSession',
    'project-actions-button': 'actions',
  }
  const shown = await app
    .projectItem(root)
    .locator('[data-sidebar="menu-action"]')
    .evaluateAll((buttons) =>
      buttons
        .filter(
          (button) =>
            button.checkVisibility({ opacityProperty: true, visibilityProperty: true }) &&
            button.getBoundingClientRect().width > 0,
        )
        .map((button) => ({
          testId: button.getAttribute('data-testid') ?? '',
          left: button.getBoundingClientRect().left,
        }))
        .toSorted((a, b) => a.left - b.left),
    )
  return shown.map((button) => names[button.testId] ?? button.testId)
}

/** The card of a project's row, while it shows. */
export function projectCard(app: AppDriver): Locator {
  return app.page.getByTestId('project-card')
}

/** A Git repository with one commit, made at `directory`; returns its path. */
export function createRepository(directory: string): string {
  fs.mkdirSync(directory, { recursive: true })
  git(directory, 'init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(directory, 'README.md'), `# ${path.basename(directory)}\n`)
  git(directory, 'add', '.')
  git(directory, 'commit', '-q', '-m', 'initial')
  return directory
}

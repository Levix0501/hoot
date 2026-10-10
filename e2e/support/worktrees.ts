import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { expect, type Locator } from '@playwright/test'
import type { ToolId } from '../../src/shared/tools'
import type { AppDriver } from './app'
import type { World } from './world'

/** Runs git outside Hoot, as the tests do, and returns what it printed. */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'hoot e2e',
      GIT_AUTHOR_EMAIL: 'e2e@example.com',
      GIT_COMMITTER_NAME: 'hoot e2e',
      GIT_COMMITTER_EMAIL: 'e2e@example.com',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
    },
  }).trim()
}

/** Hoot's worktree directory in the world's home: `~/.hoot/worktrees`. */
export function worktreesDir(world: World): string {
  return path.join(world.home, '.hoot', 'worktrees')
}

/** Where the test repositories of the worktree scenarios are made. */
function reposDir(world: World): string {
  const directory = path.join(world.root, 'worktree-repos')
  fs.mkdirSync(directory, { recursive: true })
  return directory
}

/** A repository with a first commit on `branch`, which is checked out. */
function initRepository(directory: string, branch = 'main', file = 'README.md'): string {
  fs.mkdirSync(directory, { recursive: true })
  git(directory, 'init', '-q', '-b', branch)
  fs.writeFileSync(path.join(directory, file), `# ${path.basename(directory)}\n`)
  git(directory, 'add', '.')
  git(directory, 'commit', '-q', '-m', 'initial')
  return directory
}

/** Adds a branch with one more commit than the checked-out branch, which stays checked out. */
function addBranchWithCommit(repository: string, branch: string): void {
  const current = git(repository, 'branch', '--show-current')
  git(repository, 'checkout', '-q', '-b', branch)
  fs.writeFileSync(path.join(repository, `${branch}.txt`), `${branch}\n`)
  git(repository, 'add', '.')
  git(repository, 'commit', '-q', '-m', `on ${branch}`)
  git(repository, 'checkout', '-q', current)
}

/**
 * G: `main` checked out, `develop` one commit ahead of it, and a
 * remote-tracking branch `origin/remote-only` without a local branch.
 */
export function createG(world: World): string {
  const G = initRepository(path.join(reposDir(world), 'G'))
  addBranchWithCommit(G, 'develop')
  git(G, 'update-ref', 'refs/remotes/origin/remote-only', 'HEAD')
  return G
}

/** H: a repository without linked worktrees. */
export function createH(world: World): string {
  return initRepository(path.join(reposDir(world), 'H'))
}

/** The repositories of O, by their paths relative to O. */
export interface ORepositories {
  O: string
  inner: string
  deep: string
  loose: string
  empty: string
  pkg: string
  side: string
  link: string
}

/**
 * O: `main` and `develop`, ignoring `/inner/`, `/build/` and `/node_modules/`,
 * with the repositories `inner` (`main` and `develop`, ignoring `/deep/`),
 * `inner/deep` (`main`), `loose` (`trunk`, neither tracked nor ignored),
 * `empty` (no commits), `node_modules/pkg`, the linked worktree
 * `.claude/worktrees/side` (branch `side`) and the link `link` to a
 * repository outside O.
 */
export function createO(world: World): ORepositories {
  const base = reposDir(world)
  const O = path.join(base, 'O')
  fs.mkdirSync(O, { recursive: true })
  git(O, 'init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(O, '.gitignore'), '/inner/\n/build/\n/node_modules/\n')
  fs.writeFileSync(path.join(O, 'README.md'), '# O\n')
  git(O, 'add', '.')
  git(O, 'commit', '-q', '-m', 'initial')
  addBranchWithCommit(O, 'develop')

  const inner = path.join(O, 'inner')
  fs.mkdirSync(inner)
  git(inner, 'init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(inner, '.gitignore'), '/deep/\n')
  fs.writeFileSync(path.join(inner, 'inner.txt'), 'inner\n')
  git(inner, 'add', '.')
  git(inner, 'commit', '-q', '-m', 'initial')
  addBranchWithCommit(inner, 'develop')

  const deep = initRepository(path.join(inner, 'deep'))
  const loose = initRepository(path.join(O, 'loose'), 'trunk')
  const empty = path.join(O, 'empty')
  fs.mkdirSync(empty)
  git(empty, 'init', '-q')
  const pkg = initRepository(path.join(O, 'node_modules', 'pkg'))
  const side = path.join(O, '.claude', 'worktrees', 'side')
  git(O, 'worktree', 'add', '-q', '-b', 'side', side, 'main')
  const outside = initRepository(path.join(base, 'outside'))
  const link = path.join(O, 'link')
  fs.symlinkSync(outside, link)
  return { O, inner, deep, loose, empty, pkg, side, link }
}

/** P: a repository with the initialized submodule `mod`. */
export function createP(world: World): { P: string; mod: string } {
  const base = reposDir(world)
  const source = initRepository(path.join(base, 'module-source'), 'main', 'module.txt')
  const P = initRepository(path.join(base, 'P'))
  git(P, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', source, 'mod')
  git(P, 'commit', '-q', '-m', 'add submodule')
  return { P, mod: path.join(P, 'mod') }
}

function writeHook(repository: string, name: string, script: string): void {
  const hooks = path.join(repository, '.git', 'hooks')
  fs.mkdirSync(hooks, { recursive: true })
  fs.writeFileSync(path.join(hooks, name), script, { mode: 0o755 })
}

/**
 * K: its post-checkout hook prints `hook says no` on standard error and exits
 * with 1; it ignores `/in/`, a repository without hooks.
 */
export function createK(world: World): { K: string; inRepository: string } {
  const K = path.join(reposDir(world), 'K')
  fs.mkdirSync(K, { recursive: true })
  git(K, 'init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(K, '.gitignore'), '/in/\n')
  git(K, 'add', '.')
  git(K, 'commit', '-q', '-m', 'initial')
  const inRepository = initRepository(path.join(K, 'in'))
  writeHook(K, 'post-checkout', '#!/bin/sh\necho "hook says no" >&2\nexit 1\n')
  return { K, inRepository }
}

/** L: its post-checkout hook waits 3 seconds and exits with 0. */
export function createL(world: World): string {
  const L = initRepository(path.join(reposDir(world), 'L'))
  writeHook(L, 'post-checkout', '#!/bin/sh\nsleep 3\nexit 0\n')
  return L
}

/** M: a repository whose directory is named `My App`. */
export function createM(world: World): string {
  return initRepository(path.join(reposDir(world), 'My App'))
}

/** app₁ and app₂: two repositories named `app` in different directories. */
export function createApps(world: World): { app1: string; app2: string } {
  const base = reposDir(world)
  return {
    app1: initRepository(path.join(base, 'one', 'app')),
    app2: initRepository(path.join(base, 'two', 'app')),
  }
}

/** A linked worktree as `git worktree list --porcelain` lists it. */
export interface Registration {
  path: string
  head: string | null
  branch: string | null
  detached: boolean
  locked: boolean
  lockReason: string | null
  prunable: boolean
}

/** The linked worktrees a repository registers (its main worktree left out). */
export function registrations(repository: string): Registration[] {
  const entries: Registration[] = []
  let current: Registration | null = null
  for (const field of git(repository, 'worktree', 'list', '--porcelain', '-z').split('\0')) {
    if (field === '') {
      current = null
    } else if (field.startsWith('worktree ')) {
      current = {
        path: field.slice('worktree '.length),
        head: null,
        branch: null,
        detached: false,
        locked: false,
        lockReason: null,
        prunable: false,
      }
      entries.push(current)
    } else if (current) {
      const [label, ...rest] = field.split(' ')
      const value = rest.join(' ')
      if (label === 'HEAD') current.head = value
      else if (label === 'branch') current.branch = value.replace(/^refs\/heads\//, '')
      else if (label === 'detached') current.detached = true
      else if (label === 'locked') {
        current.locked = true
        current.lockReason = value || null
      } else if (label === 'prunable') current.prunable = true
    }
  }
  return entries.slice(1)
}

/** The paths a repository registers as linked worktrees. */
export function registeredPaths(repository: string): string[] {
  return registrations(repository)
    .map((entry) => entry.path)
    .toSorted()
}

export function localBranches(repository: string): string[] {
  return git(repository, 'for-each-ref', '--format=%(refname:short)', 'refs/heads')
    .split('\n')
    .filter(Boolean)
    .toSorted()
}

export function commitOf(repository: string, revision: string): string {
  return git(repository, 'rev-parse', revision)
}

/** The entries of a directory, or `[]` when it does not exist. */
export function entriesOf(directory: string): string[] {
  try {
    return fs.readdirSync(directory).toSorted()
  } catch {
    return []
  }
}

/**
 * Puts a stand-in for git first on the login shell PATH, where Hoot looks for
 * git. It runs the real git, and after each run records its arguments and
 * the paths of the linked worktrees each of `repositories` then registers,
 * read from their Git directories.
 */
export function recordGitRuns(world: World, repositories: readonly string[]) {
  const real = execFileSync('/usr/bin/which', ['git'], { encoding: 'utf8' }).trim()
  const log = path.join(world.records, 'git-runs.jsonl')
  const commonDirs = repositories.map((repository) =>
    path.resolve(repository, git(repository, 'rev-parse', '--git-common-dir')),
  )
  const script = `#!${process.execPath}
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const repositories = ${JSON.stringify(repositories)}
const commonDirs = ${JSON.stringify(commonDirs)}
const result = spawnSync(${JSON.stringify(real)}, process.argv.slice(2), { stdio: 'inherit' })
const registered = {}
repositories.forEach((repository, index) => {
  const admin = path.join(commonDirs[index], 'worktrees')
  let names = []
  try {
    names = fs.readdirSync(admin)
  } catch {}
  registered[repository] = names
    .map((name) => {
      try {
        return path.dirname(fs.readFileSync(path.join(admin, name, 'gitdir'), 'utf8').trim())
      } catch {
        return null
      }
    })
    .filter((entry) => entry !== null)
})
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args: process.argv.slice(2), registered }) + '\\n')
process.exit(result.status === null ? 1 : result.status)
`
  fs.writeFileSync(path.join(world.loginBin, 'git'), script, { mode: 0o755 })
  return {
    /** Every recorded run, oldest first. */
    runs(): Array<{ args: string[]; registered: Record<string, string[]> }> {
      try {
        return fs
          .readFileSync(log, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      } catch {
        return []
      }
    },
    /**
     * The index of the first run after which `repository` no longer registers
     * `worktree`, counted from the last run before that in which it did.
     */
    clearedAt(repository: string, worktree: string): number {
      const runs = this.runs()
      let seen = -1
      runs.forEach((run, index) => {
        if (run.registered[repository]?.includes(worktree)) seen = index
      })
      if (seen === -1) return -1
      const cleared = runs.findIndex(
        (run, index) => index > seen && !run.registered[repository]?.includes(worktree),
      )
      return cleared
    },
  }
}

/* The worktree rows of the sidebar. */

export function worktreeItems(app: AppDriver, projectRoot?: string): Locator {
  return projectRoot === undefined
    ? app.page.getByTestId('worktree-item')
    : app.page.locator(`[data-testid="worktree-item"][data-project-root="${projectRoot}"]`)
}

/** The row of the worktree with this root. */
export function worktreeItem(app: AppDriver, worktreePath: string): Locator {
  return app.page.locator(`[data-testid="worktree-item"][data-worktree-path="${worktreePath}"]`)
}

/** The row of a project's worktree with this display name. */
export function worktreeNamed(app: AppDriver, projectRoot: string, name: string): Locator {
  return worktreeItems(app, projectRoot).filter({
    has: app.page.getByTestId('worktree-name').getByText(name, { exact: true }),
  })
}

/** The display names of a project's worktree rows, in sidebar order. */
export async function worktreeNames(app: AppDriver, projectRoot: string): Promise<string[]> {
  return worktreeItems(app, projectRoot)
    .getByTestId('worktree-name')
    .evaluateAll((names) => names.map((name) => name.textContent ?? ''))
}

/**
 * The rows of the sidebar in order: `project:<root>`, `session:<id>` and
 * `worktree:<display name>`.
 */
export async function sidebarRows(app: AppDriver): Promise<string[]> {
  return app.page.evaluate(() =>
    Array.from(
      document.querySelectorAll(
        '[data-testid="project-item"], [data-testid="session-item"], [data-testid="worktree-item"]',
      ),
    ).map((row) => {
      const testId = row.getAttribute('data-testid')
      if (testId === 'project-item') return `project:${row.getAttribute('data-project-root')}`
      if (testId === 'session-item') return `session:${row.getAttribute('data-session-id')}`
      const name = row.querySelector('[data-testid="worktree-name"]')?.textContent ?? ''
      return `worktree:${name}`
    }),
  )
}

/** The session rows below a worktree's row. */
export async function worktreeSessionIds(app: AppDriver, worktreePath: string): Promise<string[]> {
  return app.page
    .locator(`[data-testid="worktree-session-list"][data-worktree-path="${worktreePath}"]`)
    .getByTestId('session-item')
    .evaluateAll((items) => items.map((item) => item.getAttribute('data-session-id') ?? ''))
}

/** Points at a worktree's row and returns what its tooltip shows: the path and the inner members. */
export async function hoverWorktree(
  app: AppDriver,
  worktreePath: string,
): Promise<{ path: string; members: string[] }> {
  await app.page.mouse.move(1, 1)
  await worktreeItem(app, worktreePath).getByTestId('worktree-row').hover()
  const tooltip = app.page.getByTestId('worktree-tooltip')
  await expect(tooltip).toBeVisible()
  const shown = {
    path: (await tooltip.getByTestId('worktree-tooltip-path').textContent()) ?? '',
    members: await tooltip
      .getByTestId('worktree-tooltip-member')
      .evaluateAll((members) => members.map((member) => member.textContent ?? '')),
  }
  await app.page.mouse.move(1, 1)
  return shown
}

/** Opens a worktree row's `⋯` menu. */
export async function openWorktreeActions(app: AppDriver, worktreePath: string): Promise<void> {
  await expect(app.page.locator('[role="menu"][data-closed]')).toHaveCount(0)
  await worktreeItem(app, worktreePath).getByTestId('worktree-actions-button').click()
  await expect(app.page.locator('[role="menu"]')).toBeVisible()
}

/** Opens a worktree row's context menu. */
export async function openWorktreeContextMenu(app: AppDriver, worktreePath: string) {
  await expect(app.page.locator('[role="menu"][data-closed]')).toHaveCount(0)
  await worktreeItem(app, worktreePath).getByTestId('worktree-row').click({ button: 'right' })
  await expect(app.page.locator('[role="menu"]')).toBeVisible()
}

/** The labels of the items of the open menu (submenus left closed) and whether each is enabled. */
export async function menuEntries(
  app: AppDriver,
): Promise<Array<[label: string, enabled: boolean]>> {
  return app.page
    .locator('[role="menu"]')
    .last()
    .locator('[role="menuitem"]')
    .evaluateAll((items) =>
      items.map((item) => [
        item.textContent?.trim() ?? '',
        !item.hasAttribute('data-disabled') && item.getAttribute('aria-disabled') !== 'true',
      ]),
    )
}

/**
 * Starts a session in a worktree from its row's `+` (or with `from:
 * 'context-menu'`, its context menu) and returns its id once its process runs.
 */
export async function startWorktreeSession(
  app: AppDriver,
  worktreePath: string,
  tool: ToolId,
  options: { from?: 'button' | 'context-menu' } = {},
): Promise<string> {
  const before = new Set(await app.sessionIds())
  const started = async () => (await app.sessionIds()).find((id) => !before.has(id))
  await expect(async () => {
    if (!(await started())) {
      if (!(await app.toolItem(tool).isVisible())) {
        if (options.from === 'context-menu') {
          if (!(await app.page.getByTestId('worktree-context-new-session').isVisible())) {
            await worktreeItem(app, worktreePath)
              .getByTestId('worktree-row')
              .click({ button: 'right', timeout: 5_000 })
          }
          await app.page.getByTestId('worktree-context-new-session').click({ timeout: 5_000 })
        } else {
          await worktreeItem(app, worktreePath)
            .getByTestId('worktree-new-session-button')
            .click({ timeout: 5_000 })
        }
      }
      await app.toolItem(tool).click({ timeout: 5_000 })
    }
    expect(await started()).toBeDefined()
  }).toPass({ timeout: 30_000 })
  const id = (await started())!
  await expect(app.sessionItem(id)).toHaveAttribute('data-status', /^(running|exited)$/)
  return id
}

/* The new worktree dialog. */

export function newWorktreeDialog(app: AppDriver): Locator {
  return app.page.getByTestId('new-worktree-dialog')
}

/** Opens a project's new worktree dialog from its `+` menu or its context menu, and waits for its form. */
export async function openNewWorktreeDialog(
  app: AppDriver,
  projectRoot: string,
  from: 'button' | 'context-menu' = 'button',
): Promise<void> {
  await expect(app.page.locator('[role="menu"][data-closed]')).toHaveCount(0)
  if (from === 'button') {
    await app.openToolMenu(projectRoot)
    await app.page.getByTestId('new-worktree').click()
  } else {
    await app.projectItem(projectRoot).click({ button: 'right' })
    await app.page.getByTestId('context-new-worktree').click()
  }
  await expect(newWorktreeDialog(app)).toBeVisible()
  await expect(app.page.getByTestId('worktree-branch-input')).toBeVisible()
}

export async function typeBranch(app: AppDriver, name: string): Promise<void> {
  await app.page.getByTestId('worktree-branch-input').fill(name)
}

/** The base branch a select shows, or `null` when none is chosen. */
export async function selectedBranch(trigger: Locator): Promise<string | null> {
  const value = trigger.locator('[data-slot="select-value"]')
  if ((await value.getAttribute('data-placeholder')) !== null) return null
  return (await value.textContent())?.trim() ?? null
}

/** The base branch select of the project, or of an inner repository. */
export function baseSelect(app: AppDriver, relativePath?: string): Locator {
  return relativePath === undefined
    ? app.page.getByTestId('worktree-base-select')
    : nestedRow(app, relativePath).getByTestId('worktree-nested-base-select')
}

export function nestedRow(app: AppDriver, relativePath: string): Locator {
  return app.page.locator(`[data-testid="worktree-nested"][data-relative-path="${relativePath}"]`)
}

/** The options of a branch select, read by opening it. */
export async function branchOptions(app: AppDriver, trigger: Locator): Promise<string[]> {
  await trigger.click()
  const options = app.page.locator('[role="listbox"]:visible [role="option"]')
  await expect(options.first()).toBeVisible()
  const labels = await options.evaluateAll((items) =>
    items.map((item) => item.textContent?.trim() ?? ''),
  )
  await app.page.keyboard.press('Escape')
  // A select keeps its list in the page while it is closed.
  await expect(app.page.locator('[role="listbox"]:visible')).toHaveCount(0)
  return labels
}

/** Chooses a branch in a branch select. */
export async function chooseBranch(app: AppDriver, trigger: Locator, branch: string) {
  await trigger.click()
  await app.page
    .locator('[role="listbox"]:visible [role="option"]')
    .filter({ has: app.page.getByText(branch, { exact: true }) })
    .click()
  await expect(app.page.locator('[role="listbox"]:visible')).toHaveCount(0)
  await expect.poll(() => selectedBranch(trigger)).toBe(branch)
}

/** Includes or leaves out an inner repository. */
export async function setIncluded(app: AppDriver, relativePath: string, included: boolean) {
  const checkbox = nestedRow(app, relativePath).getByTestId('worktree-nested-checkbox')
  if ((await checkbox.getAttribute('aria-checked')) !== String(included)) await checkbox.click()
  await expect(checkbox).toHaveAttribute('aria-checked', String(included))
}

/**
 * Creates a worktree through a project's new worktree dialog and returns its
 * root once its row is in the sidebar.
 */
export async function createWorktree(
  app: AppDriver,
  projectRoot: string,
  branch: string,
  options: {
    base?: string
    nestedBases?: Record<string, string>
    exclude?: string[]
  } = {},
): Promise<string> {
  await openNewWorktreeDialog(app, projectRoot)
  await typeBranch(app, branch)
  if (options.base) await chooseBranch(app, baseSelect(app), options.base)
  for (const relativePath of options.exclude ?? []) await setIncluded(app, relativePath, false)
  for (const [relativePath, base] of Object.entries(options.nestedBases ?? {})) {
    await chooseBranch(app, baseSelect(app, relativePath), base)
  }
  const create = app.page.getByTestId('worktree-create')
  await expect(create).toBeEnabled()
  await create.click()
  await expect(newWorktreeDialog(app)).toBeHidden({ timeout: 30_000 })
  const row = worktreeNamed(app, projectRoot, branch)
  await expect(row).toHaveCount(1)
  return (await row.getAttribute('data-worktree-path'))!
}

/* Deleting worktrees. */

export function deleteDialog(app: AppDriver): Locator {
  return app.page.getByTestId('delete-worktree-dialog')
}

/** Chooses Delete in a worktree row's `⋯` menu and waits for the confirmation. */
export async function requestDelete(app: AppDriver, worktreePath: string): Promise<void> {
  await openWorktreeActions(app, worktreePath)
  await app.page.getByTestId('worktree-delete').click()
  await expect(deleteDialog(app)).toBeVisible()
  await expect(deleteDialog(app)).toHaveAttribute('data-phase', 'confirm')
}

/** What the open delete confirmation lists for each repository. */
export async function listedChanges(
  app: AppDriver,
): Promise<Array<{ repository: string; total: number; files: string[]; detached: boolean }>> {
  return deleteDialog(app)
    .getByTestId('worktree-changes')
    .evaluateAll((entries) =>
      entries.map((entry) => ({
        repository: entry.getAttribute('data-repository') ?? '',
        total: Number(entry.getAttribute('data-total')),
        files: Array.from(entry.querySelectorAll('[data-testid="worktree-changed-file"]')).map(
          (file) => file.textContent ?? '',
        ),
        detached: entry.querySelector('[data-testid="worktree-detached-commits"]') !== null,
      })),
    )
}

/** Emits the window's `focus` event, as when the user switches to Hoot, without focusing it. */
export async function emitWindowFocus(app: AppDriver): Promise<void> {
  await app.electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]!.emit('focus')
  })
}

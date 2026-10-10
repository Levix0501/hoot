import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from './support/test'
import {
  createG,
  createO,
  createWorktree,
  deleteDialog,
  emitWindowFocus,
  git,
  hoverWorktree,
  initRepository,
  localBranches,
  menuEntries,
  openWorktreeActions,
  openWorktreeContextMenu,
  registeredPaths,
  registrations,
  sidebarRows,
  startWorktreeSession,
  worktreeItem,
  worktreeItems,
  worktreeNames,
  worktreeNamed,
} from './support/worktrees'

test.describe('worktrees in the sidebar', () => {
  test('worktrees made outside Hoot are listed, with their state, and can be removed or deleted', async ({
    launch,
    world,
  }) => {
    const G = createG(world)
    const outside = path.dirname(G)
    const ext = path.join(outside, 'G-ext')
    const det = path.join(outside, 'G-det')
    const lock = path.join(outside, 'G-lock')
    const gone = path.join(outside, 'G-gone')
    git(G, 'worktree', 'add', '-q', '-b', 'zeta', ext)
    git(G, 'worktree', 'add', '-q', '--detach', det)
    git(G, 'worktree', 'add', '-q', '-b', 'alpha', lock)
    git(G, 'worktree', 'lock', '--reason', 'on usb', lock)
    git(G, 'worktree', 'add', '-q', '-b', 'beta', gone)
    fs.rmSync(gone, { recursive: true, force: true })
    const app = await launch({ projects: [G] })

    await expect(worktreeItems(app, G)).toHaveCount(4)
    const short = git(det, 'rev-parse', '--short', 'HEAD')
    const names = await worktreeNames(app, G)
    expect(names.toSorted()).toEqual([short, 'alpha', 'beta', 'zeta'].toSorted())
    expect(names.filter((name) => ['alpha', 'beta', 'zeta'].includes(name))).toEqual([
      'alpha',
      'beta',
      'zeta',
    ])
    await expect(worktreeItem(app, det).getByTestId('worktree-name')).toHaveText(short)
    expect((await hoverWorktree(app, ext)).path).toBe(ext)

    // Locked: marked, and Delete is unavailable, with the reason.
    await expect(worktreeItem(app, lock)).toHaveAttribute('data-locked', 'true')
    await expect(worktreeItem(app, lock).getByTestId('worktree-locked')).toHaveText('Locked')
    await openWorktreeActions(app, lock)
    expect(await menuEntries(app)).toEqual([
      ['Reveal in Finder', true],
      ['Copy Path', true],
      ['Delete', false],
    ])
    await expect(app.page.getByTestId('worktree-lock-note')).toHaveText(
      'This worktree is locked: on usb',
    )
    await app.closeMenus()
    await openWorktreeContextMenu(app, lock)
    expect(await menuEntries(app)).toEqual([
      ['New Session', true],
      ['Reveal in Finder', true],
      ['Copy Path', true],
      ['Delete', false],
    ])
    await expect(app.page.getByTestId('worktree-lock-note')).toHaveText(
      'This worktree is locked: on usb',
    )
    await app.closeMenus()

    // Missing: marked, no new sessions, and Remove is all it offers.
    await expect(worktreeItem(app, gone)).toHaveAttribute('data-missing', 'true')
    await expect(worktreeItem(app, gone).getByTestId('worktree-missing')).toHaveText('Missing')
    await expect(worktreeItem(app, gone).getByTestId('worktree-new-session-button')).toBeDisabled()
    await openWorktreeActions(app, gone)
    expect(await menuEntries(app)).toEqual([['Remove', true]])
    await app.closeMenus()
    await openWorktreeContextMenu(app, gone)
    expect(await menuEntries(app)).toEqual([['Remove', true]])
    await app.closeMenus()

    // The others offer everything; their + lists only the tools.
    for (const worktree of [ext, det]) {
      await openWorktreeActions(app, worktree)
      expect(await menuEntries(app)).toEqual([
        ['Reveal in Finder', true],
        ['Copy Path', true],
        ['Delete', true],
      ])
      await app.closeMenus()
      await openWorktreeContextMenu(app, worktree)
      expect(await menuEntries(app)).toEqual([
        ['New Session', true],
        ['Reveal in Finder', true],
        ['Copy Path', true],
        ['Delete', true],
      ])
      await app.closeMenus()
      await worktreeItem(app, worktree).getByTestId('worktree-new-session-button').click()
      await expect(app.toolItem('shell')).toBeVisible()
      await expect(app.toolItem('claude')).toBeVisible()
      await expect(app.page.getByTestId('new-worktree')).toHaveCount(0)
      await app.closeMenus()
    }
    await app.expectEnglishUi()

    // Removing the missing worktree clears its registration and keeps its branch.
    await openWorktreeActions(app, gone)
    await app.page.getByTestId('worktree-remove').click()
    await expect(worktreeItem(app, gone)).toHaveCount(0)
    expect(registeredPaths(G)).not.toContain(gone)
    expect(registrations(G).filter((entry) => entry.prunable)).toEqual([])
    expect(localBranches(G)).toContain('beta')

    // A worktree made outside Hoot is deleted like one Hoot made.
    await openWorktreeActions(app, ext)
    await app.page.getByTestId('worktree-delete').click()
    await expect(deleteDialog(app)).toHaveAttribute('data-phase', 'confirm')
    await expect(deleteDialog(app)).toHaveAttribute('data-dirty', 'false')
    await app.page.getByTestId('worktree-delete-confirm').click()
    await expect(deleteDialog(app)).toBeHidden()
    await expect(worktreeItem(app, ext)).toHaveCount(0)
    expect(fs.existsSync(ext)).toBe(false)
    expect(registeredPaths(G)).not.toContain(ext)
    expect(registrations(G).filter((entry) => entry.prunable)).toEqual([])
    expect(localBranches(G)).toContain('zeta')
  })

  test('a locked worktree whose folder is missing can be removed, below its lock note', async ({
    launch,
    world,
  }) => {
    const G = createG(world)
    const usb = path.join(path.dirname(G), 'G-usb')
    git(G, 'worktree', 'add', '-q', '-b', 'usb', usb)
    git(G, 'worktree', 'lock', '--reason', 'on usb', usb)
    fs.rmSync(usb, { recursive: true, force: true })
    const app = await launch({ projects: [G] })

    const row = worktreeItem(app, usb)
    await expect(row).toHaveAttribute('data-missing', 'true')
    await expect(row).toHaveAttribute('data-locked', 'true')
    await expect(row.getByTestId('worktree-new-session-button')).toBeDisabled()
    await openWorktreeContextMenu(app, usb)
    expect(await menuEntries(app)).toEqual([['Remove', true]])
    await expect(app.page.getByTestId('worktree-lock-note')).toHaveText(
      'This worktree is locked: on usb',
    )
    await app.closeMenus()
    await openWorktreeActions(app, usb)
    expect(await menuEntries(app)).toEqual([['Remove', true]])
    await expect(app.page.getByTestId('worktree-lock-note')).toHaveText(
      'This worktree is locked: on usb',
    )
    await app.expectEnglishUi()

    await app.page.getByTestId('worktree-remove').click()
    await expect(row).toHaveCount(0)
    expect(registrations(G)).toEqual([])
    expect(localBranches(G)).toContain('usb')
  })

  test('changes made outside Hoot show within 2 seconds, and a missing folder once the window has the focus', async ({
    launch,
    world,
  }) => {
    const G = createG(world)
    const { O, inner } = createO(world)
    const outside = path.dirname(G)
    const app = await launch({ projects: [G, O] })
    const shell = await app.startSession(G, 'shell')
    await app.waitForPrompt(20_000, shell)
    await expect(worktreeNames(app, O)).resolves.toEqual(['side'])
    // The window never has the focus in these tests; nothing below changes that.
    const within = { timeout: 2_000 }

    const added = path.join(outside, 'G-new')
    git(G, 'worktree', 'add', '-q', '-b', 'ext2', added)
    await expect(worktreeNamed(app, G, 'ext2')).toHaveCount(1, within)

    await app.run(`git worktree lock ${added}`)
    await expect(worktreeItem(app, added)).toHaveAttribute('data-locked', 'true', within)
    await app.run(`git worktree unlock ${added}`)
    await expect(worktreeItem(app, added)).toHaveAttribute('data-locked', 'false', within)

    git(G, 'worktree', 'remove', added)
    await expect(worktreeItem(app, added)).toHaveCount(0, within)

    const cli = path.join(outside, 'O-cli')
    git(O, 'worktree', 'add', '-q', '-b', 'w', cli)
    await expect(worktreeNamed(app, O, 'w')).toHaveCount(1, within)
    git(inner, 'worktree', 'add', '-q', '-b', 'w', path.join(cli, 'inner'))
    await expect
      .poll(async () => (await hoverWorktree(app, cli)).members, within)
      .toEqual(['inner'])

    const removed = path.join(outside, 'G-rm')
    git(G, 'worktree', 'add', '-q', '-b', 'gone2', removed)
    await expect(worktreeNamed(app, G, 'gone2')).toHaveCount(1, within)
    fs.rmSync(removed, { recursive: true, force: true })
    await emitWindowFocus(app)
    await expect(worktreeItem(app, removed)).toHaveAttribute('data-missing', 'true')
    await expect(worktreeItem(app, removed).getByTestId('worktree-missing')).toBeVisible()
  })

  test('repositories made in or moved into a project while Hoot runs are followed as nested repositories too', async ({
    launch,
    world,
  }) => {
    const G = createG(world)
    const ext = path.join(path.dirname(G), 'G-ext')
    git(G, 'worktree', 'add', '-q', '-b', 'ext', ext)
    const app = await launch({ projects: [G] })
    await expect(worktreeNamed(app, G, 'ext')).toHaveCount(1)
    expect((await hoverWorktree(app, ext)).members).toEqual([])
    // As in the other test, the window's focus stays as it is.
    const within = { timeout: 2_000 }

    // Outside Hoot: a new repository in G, which G does not track, then its worktree in G-ext.
    const fresh = initRepository(path.join(G, 'fresh'))
    git(fresh, 'worktree', 'add', '-q', '-b', 'ext', path.join(ext, 'fresh'))
    await expect
      .poll(async () => (await hoverWorktree(app, ext)).members, within)
      .toEqual(['fresh'])

    git(fresh, 'worktree', 'remove', path.join(ext, 'fresh'))
    await expect.poll(async () => (await hoverWorktree(app, ext)).members, within).toEqual([])

    // A folder that holds a repository below its top, moved into G, then the repository's worktree.
    const holder = path.join(path.dirname(G), 'holder')
    initRepository(path.join(holder, 'lib'))
    fs.renameSync(holder, path.join(G, 'holder'))
    const lib = path.join(G, 'holder', 'lib')
    git(lib, 'worktree', 'add', '-q', '-b', 'ext', path.join(ext, 'holder', 'lib'))
    await expect
      .poll(async () => (await hoverWorktree(app, ext)).members, within)
      .toEqual(['holder/lib'])
  })

  test('sessions are in sidebar order, which the shortcuts follow', async ({ launch, world }) => {
    const G = createG(world)
    const { O } = createO(world)
    const app = await launch({ projects: [G, O] })
    const a = await createWorktree(app, G, 'a-tree')
    const b = await createWorktree(app, G, 'b-tree')

    const s1 = await app.startSession(G, 'shell')
    const s2 = await app.startSession(G, 'shell')
    const s3 = await startWorktreeSession(app, b, 'shell')
    const s4 = await startWorktreeSession(app, a, 'shell')
    const s5 = await app.startSession(O, 'shell')
    for (const id of [s1, s2, s3, s4, s5]) await app.waitForPrompt(20_000, id)

    const rows = await sidebarRows(app)
    expect(rows.slice(0, rows.indexOf(`project:${O}`))).toEqual([
      `project:${G}`,
      `session:${s1}`,
      `session:${s2}`,
      'worktree:a-tree',
      `session:${s4}`,
      'worktree:b-tree',
      `session:${s3}`,
    ])

    for (const [keys, current] of [
      ['Meta+1', s1],
      ['Meta+2', s2],
      ['Meta+3', s4],
      ['Meta+4', s3],
      ['Meta+5', s5],
      ['Meta+Shift+BracketRight', s1],
      ['Meta+Shift+BracketLeft', s5],
    ] as const) {
      await app.page.keyboard.press(keys)
      await expect(app.session(), keys).toHaveAttribute('data-session-id', current)
    }
  })
})

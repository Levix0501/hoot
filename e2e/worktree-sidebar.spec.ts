import fs from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { expect, test } from './support/test'
import {
  createG,
  createO,
  createWorktree,
  deleteDialog,
  emitWindowFocus,
  git,
  hoverWorktree,
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
  worktreesDir,
} from './support/worktrees'

test.describe('worktrees in the sidebar', () => {
  test('only the worktrees in the project folder are listed, as they are when Hoot starts', async ({
    launch,
    world,
  }) => {
    const G = createG(world)
    const folder = path.join(worktreesDir(world), 'G')
    const first = await launch({ projects: [G] })
    for (const branch of ['alpha', 'beta', 'zeta', 'det']) {
      expect(await createWorktree(first, G, branch)).toBe(path.join(folder, branch))
    }
    await first.close()

    // Outside Hoot, while it does not run.
    const [alpha, beta, zeta, det, manual] = ['alpha', 'beta', 'zeta', 'det', 'manual'].map(
      (name) => path.join(folder, name),
    )
    git(G, 'worktree', 'lock', '--reason', 'on usb', alpha)
    git(det, 'checkout', '-q', '--detach')
    const outside = path.dirname(G)
    const ext = path.join(outside, 'G-ext')
    git(G, 'worktree', 'add', '-q', '-b', 'ext', ext)
    git(G, 'worktree', 'add', '-q', '-b', 'manual', manual)
    const gone = path.join(outside, 'G-gone')
    git(G, 'worktree', 'add', '-q', '-b', 'gone', gone)
    fs.rmSync(beta, { recursive: true, force: true })
    fs.rmSync(gone, { recursive: true, force: true })
    const app = await launch({ projects: [G] })

    await expect(worktreeItems(app, G)).toHaveCount(5)
    const listed = await worktreeItems(app, G).evaluateAll((items) =>
      items.map((item) => item.getAttribute('data-worktree-path') ?? ''),
    )
    expect(listed.toSorted()).toEqual([alpha, beta, det, manual, zeta].toSorted())
    await expect(worktreeItem(app, ext)).toHaveCount(0)
    await expect(worktreeItem(app, gone)).toHaveCount(0)
    const names = await worktreeNames(app, G)
    expect(names.filter((name) => ['alpha', 'beta', 'manual', 'zeta'].includes(name))).toEqual([
      'alpha',
      'beta',
      'manual',
      'zeta',
    ])
    const short = git(det, 'rev-parse', '--short', 'HEAD')
    await expect(worktreeItem(app, det).getByTestId('worktree-name')).toHaveText(short)
    expect((await hoverWorktree(app, zeta)).path).toBe(zeta)

    // Locked: marked, and Delete is unavailable, with the reason.
    await expect(worktreeItem(app, alpha)).toHaveAttribute('data-locked', 'true')
    await expect(worktreeItem(app, alpha).getByTestId('worktree-locked')).toHaveText('Locked')
    await openWorktreeActions(app, alpha)
    expect(await menuEntries(app)).toEqual([
      ['Reveal in Finder', true],
      ['Copy Path', true],
      ['Delete', false],
    ])
    await expect(app.page.getByTestId('worktree-lock-note')).toHaveText(
      'This worktree is locked: on usb',
    )
    await app.closeMenus()
    await openWorktreeContextMenu(app, alpha)
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
    await expect(worktreeItem(app, beta)).toHaveAttribute('data-missing', 'true')
    await expect(worktreeItem(app, beta).getByTestId('worktree-missing')).toHaveText('Missing')
    await expect(worktreeItem(app, beta).getByTestId('worktree-new-session-button')).toBeDisabled()
    await openWorktreeActions(app, beta)
    expect(await menuEntries(app)).toEqual([['Remove', true]])
    await app.closeMenus()
    await openWorktreeContextMenu(app, beta)
    expect(await menuEntries(app)).toEqual([['Remove', true]])
    await app.closeMenus()

    // The others offer everything; their + lists only the tools.
    for (const worktree of [zeta, det, manual]) {
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

    // Asked directly, Hoot neither deletes G-ext nor clears G-gone's registration.
    const deleted = await app.page.evaluate(
      ([root, worktree]) => window.hoot.deleteWorktree(root!, worktree!, true),
      [G, ext],
    )
    expect(deleted.ok).toBe(false)
    const removed = await app.page.evaluate(
      ([root, worktree]) => window.hoot.removeWorktree(root!, worktree!),
      [G, gone],
    )
    expect(removed.ok).toBe(false)
    expect(fs.existsSync(ext)).toBe(true)
    expect(registeredPaths(G)).toEqual(expect.arrayContaining([ext, gone]))

    // Removing the missing worktree clears its registration and keeps its branch.
    await openWorktreeActions(app, beta)
    await app.page.getByTestId('worktree-remove').click()
    await expect(worktreeItem(app, beta)).toHaveCount(0)
    expect(registeredPaths(G)).not.toContain(beta)
    expect(localBranches(G)).toContain('beta')
  })

  test('a locked worktree whose folder is missing can be removed, below its lock note', async ({
    launch,
    world,
  }) => {
    const G = createG(world)
    // Made with git in G's project folder, where Hoot makes worktrees.
    const usb = path.join(worktreesDir(world), 'G', 'usb')
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

  test('changes made outside Hoot show when the window gets the focus, or when a worktree is used, and not before', async ({
    launch,
    world,
  }) => {
    const G = createG(world)
    const { O, loose } = createO(world)
    const app = await launch({ projects: [G, O] })
    const w: Record<string, string> = {}
    for (const name of ['w1', 'w2', 'w3', 'w4', 'w5', 'w6']) {
      w[name] = await createWorktree(app, G, name)
    }
    const o1 = await createWorktree(app, O, 'o1')
    const shell = await app.startSession(G, 'shell')
    await app.waitForPrompt(20_000, shell)
    const rows = await sidebarRows(app)
    expect((await hoverWorktree(app, o1)).members).toEqual(['inner', 'inner/deep', 'loose'])

    // Step 1: changes outside Hoot, the window's focus as it is. The window
    // never has the focus in these tests; nothing below changes that.
    await app.run(`git worktree lock ${w.w1}`)
    git(G, 'worktree', 'remove', w.w2!)
    fs.rmSync(w.w3!, { recursive: true, force: true })
    git(w.w4!, 'switch', '-q', '-c', 'w4b')
    const added = path.join(path.dirname(G), 'G-new')
    git(G, 'worktree', 'add', '-q', '-b', 'ext2', added)
    git(loose, 'worktree', 'remove', path.join(o1, 'loose'))
    await delay(3_000)
    expect(await sidebarRows(app)).toEqual(rows)
    await expect(worktreeItem(app, w.w1!)).toHaveAttribute('data-locked', 'false')
    await expect(worktreeItem(app, w.w2!)).toHaveAttribute('data-missing', 'false')
    await expect(worktreeItem(app, w.w3!)).toHaveAttribute('data-missing', 'false')
    await expect(worktreeItem(app, w.w4!).getByTestId('worktree-name')).toHaveText('w4')
    await expect(worktreeNamed(app, G, 'ext2')).toHaveCount(0)
    expect((await hoverWorktree(app, o1)).members).toEqual(['inner', 'inner/deep', 'loose'])

    // Step 2: the window gets the focus, and keeps it from now on.
    await emitWindowFocus(app)
    const within = { timeout: 2_000 }
    await expect(worktreeItem(app, w.w1!)).toHaveAttribute('data-locked', 'true', within)
    await expect(worktreeItem(app, w.w2!)).toHaveCount(0, within)
    await expect(worktreeItem(app, w.w3!)).toHaveAttribute('data-missing', 'true', within)
    await expect(worktreeItem(app, w.w4!).getByTestId('worktree-name')).toHaveText('w4b', within)
    await expect(worktreeNamed(app, G, 'ext2')).toHaveCount(0)
    expect((await hoverWorktree(app, o1)).members).toEqual(['inner', 'inner/deep'])

    // Step 3: w5 removed outside Hoot, then a session started from its row.
    git(G, 'worktree', 'remove', w.w5!)
    const sessions = await app.sessionIds()
    await worktreeItem(app, w.w5!).getByTestId('worktree-new-session-button').click()
    await app.toolItem('shell').click()
    await expect(worktreeItem(app, w.w5!)).toHaveCount(0)
    expect(await app.sessionIds()).toEqual(sessions)

    // Step 4: w6's folder deleted outside Hoot, then Delete chosen on its row.
    fs.rmSync(w.w6!, { recursive: true, force: true })
    await openWorktreeActions(app, w.w6!)
    await app.page.getByTestId('worktree-delete').click()
    await expect(worktreeItem(app, w.w6!)).toHaveAttribute('data-missing', 'true')
    await expect(deleteDialog(app)).toHaveCount(0)
    expect(registeredPaths(G)).toContain(w.w6)
    expect(await app.sessionIds()).toEqual(sessions)
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

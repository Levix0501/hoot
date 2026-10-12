import fs from 'node:fs'
import path from 'node:path'
import type { Locator } from '@playwright/test'
import type { AppDriver, MenuEntry } from './support/app'
import {
  claudeArguments,
  claudeCodeButton,
  claudeRuns,
  clickClaudeCodeButton,
  expectClaudeCodeButton,
  expectHootPlugin,
  sendShownIssue,
  terminalHasFocus,
} from './support/claude-code'
import {
  addProjectsBeforeLaunch,
  changeDatabase,
  databaseFile,
  readDatabase,
} from './support/database'
import { snapshotTree } from './support/fs-snapshot'
import {
  clickProjectRow,
  deleteShownIssue,
  expectList,
  expectShown,
  goBack,
  editShownIssueTitle,
  goForward,
  issueListPage,
  issuePage,
  newIssueDialog,
  openIssue,
  openNewIssueDialog,
  setShownIssueStatus,
} from './support/issues'
import { readRecord, readRuns, say, writeSubstitute } from './support/substitutes'
import { expect, test } from './support/test'
import type { World } from './support/world'
import {
  createWorktree,
  openWorktreeActions,
  openWorktreeContextMenu,
  startWorktreeSession,
  worktreeItem,
} from './support/worktrees'

/** Puts a stand-in for every coding tool on the login shell PATH; returns `claude`'s file. */
function writeSubstitutes(world: World): string {
  writeSubstitute(world.loginBin, 'codex', world.records)
  writeSubstitute(world.laterBin, 'opencode', world.records)
  return writeSubstitute(world.interactiveBin, 'claude', world.records)
}

/** The latest run of the stand-in for `claude`, once there are `count` runs, with its arguments sorted out. */
async function claudeRun(world: World, count: number) {
  const run = (await claudeRuns(world, count)).at(-1)!
  return { ...run, ...claudeArguments(run.args) }
}

/** Makes the stand-in run with this pid set its terminal title, and waits until the terminal has it. */
async function setTitle(app: AppDriver, sessionId: string, pid: number, title: string) {
  const marker = `title-set-${Date.now()}`
  say(app.world.records, 'claude', pid, `\x1b]0;${title}\x07${marker}\r\n`)
  await app.waitForTerminalText(marker, 15_000, sessionId)
}

/** Checks the name a session's row shows, and the session header when the session is shown. */
async function expectName(app: AppDriver, id: string, name: string): Promise<void> {
  await expect(app.sessionItemName(id)).toHaveText(name)
  if ((await app.currentSessionId()) === id) {
    await expect(app.page.getByTestId('session-name')).toHaveText(name)
  }
}

/** The kinds of the elements shown in an element, in order: tag, test id and tool icon. */
async function shownElementKinds(locator: Locator): Promise<string[]> {
  return locator.evaluate((root) =>
    [root, ...Array.from(root.querySelectorAll('*'))]
      .filter((element) => element.checkVisibility({ visibilityProperty: true }))
      .map((element) =>
        [
          element.tagName.toLowerCase(),
          element.getAttribute('data-testid') ?? '',
          element.getAttribute('data-tool-icon') ?? '',
        ].join(' '),
      ),
  )
}

/** The text of each open menu, outermost first. */
async function openMenus(app: AppDriver): Promise<string[]> {
  return app.page
    .locator('[role="menu"]')
    .evaluateAll((menus) => menus.map((menu) => (menu as HTMLElement).innerText))
}

/** Every item of the menu bar, as `label|role|type|accelerator`, nested under its menu's. */
function menuBarItems(entries: MenuEntry[]): unknown[] {
  return entries.map((entry) => {
    const item = `${entry.label}|${entry.role}|${entry.type}|${entry.accelerator}`
    return entry.submenu ? { [item]: menuBarItems(entry.submenu) } : item
  })
}

/** What the new session menus of the project's row and its worktree's row list. */
const TOOL_MENU =
  'Start a session with\nClaude Code\nBypass permissions\nCodex\nFull Access\nOpenCode\nAuto-approve\nShell\nRe-detect Tools'

/** The menu bar as it was before issues could be sent to Claude Code. */
const MENU_BAR = [
  {
    'Hoot|appmenu|submenu|null': [
      'About Hoot|about|normal|null',
      '|null|separator|null',
      'Services|services|normal|null',
      '|null|separator|null',
      'Hide Hoot|hide|normal|Command+H',
      'Hide Others|hideothers|normal|Command+Alt+H',
      'Show All|unhide|normal|null',
      '|null|separator|null',
      'Quit Hoot|quit|normal|CommandOrControl+Q',
    ],
  },
  {
    'File|null|submenu|null': [
      'Add Project…|null|normal|CmdOrCtrl+O',
      '|null|separator|null',
      'Close Session|null|normal|CmdOrCtrl+W',
    ],
  },
  {
    'Edit|editmenu|submenu|null': [
      'Undo|undo|normal|CommandOrControl+Z',
      'Redo|redo|normal|Shift+CommandOrControl+Z',
      '|null|separator|null',
      'Cut|cut|normal|CommandOrControl+X',
      'Copy|copy|normal|CommandOrControl+C',
      'Paste|paste|normal|CommandOrControl+V',
      'Paste and Match Style|pasteandmatchstyle|normal|Cmd+Option+Shift+V',
      'Delete|delete|normal|null',
      'Select All|selectall|normal|CommandOrControl+A',
      '|null|separator|null',
      {
        'Substitutions|null|submenu|null': [
          'Show Substitutions|showsubstitutions|normal|null',
          '|null|separator|null',
          'Smart Quotes|togglesmartquotes|normal|null',
          'Smart Dashes|togglesmartdashes|normal|null',
          'Text Replacement|toggletextreplacement|normal|null',
        ],
      },
      {
        'Speech|null|submenu|null': [
          'Start Speaking|startspeaking|normal|null',
          'Stop Speaking|stopspeaking|normal|null',
        ],
      },
    ],
  },
  {
    'View|null|submenu|null': [
      'Hide Sidebar|null|normal|CmdOrCtrl+B',
      '|null|separator|null',
      'Toggle Full Screen|togglefullscreen|normal|Control+Command+F',
    ],
  },
  {
    'Agents|null|submenu|null': [
      {
        'Claude Code|null|submenu|null': [
          'Bypass permissions|null|radio|null',
          'Auto|null|radio|null',
          'Accept edits|null|radio|null',
          'Plan|null|radio|null',
          'Manual|null|radio|null',
        ],
      },
      {
        'Codex|null|submenu|null': [
          'Full Access|null|radio|null',
          'Default|null|radio|null',
          'Read Only|null|radio|null',
        ],
      },
      {
        'OpenCode|null|submenu|null': ['Auto-approve|null|radio|null', 'Standard|null|radio|null'],
      },
    ],
  },
  {
    'Window|windowmenu|submenu|null': [
      'Minimize|minimize|normal|CommandOrControl+M',
      'Zoom|zoom|normal|null',
      '|null|separator|null',
      'Back|null|normal|CmdOrCtrl+[',
      'Forward|null|normal|CmdOrCtrl+]',
      '|null|separator|null',
      'Select Next Session|null|normal|CmdOrCtrl+Shift+]',
      'Select Previous Session|null|normal|CmdOrCtrl+Shift+[',
      '|null|separator|null',
      'Bring All to Front|front|normal|null',
    ],
  },
]

test.describe('sending an issue to Claude Code', () => {
  test('starts Claude Code in the project root at the permission level, named after the issue, with Hoot’s skill and the issue as its first message', async ({
    launch,
    world,
  }) => {
    writeSubstitutes(world)
    const { G, H } = world.repos
    const description = [
      '  Steps: open "Settings" and click `Save`.',
      '',
      '/hoot:other should not run',
      'Cost is $1 and $ARGUMENTS stays literal  ',
    ].join('\n')
    const app = await launch({
      projects: [G, H],
      issues: [
        { root: G, title: 'Fix the login bug', description },
        { root: G, title: 'Only a title' },
        { root: G, title: '/other is broken' },
        { root: G, title: '--verbose flag broken' },
      ],
    })
    await app.selectPermissionLevel('Claude Code', 'Accept edits')
    const s = await app.startSession(G, 'shell')
    const issue = await openIssue(app, G, 'Fix the login bug')
    const c = await sendShownIssue(app)

    // Run once, in the project root, at the level picked, and with no other
    // options than the plugin's and the name's.
    const run = await claudeRun(world, 1)
    await expect.poll(() => readRecord(world.records, 'claude')?.cwd).toBe(G)
    expect(run.options).toEqual(['--permission-mode', 'acceptEdits'])
    expect(run.name).toBe('Fix the login bug')
    expect(run.prompts).toEqual([`/hoot:split-issue # Fix the login bug\n\n${description}`])
    expectHootPlugin(run.pluginDir)

    // In the sidebar after S, with Claude Code's icon; shown, with the focus in its
    // terminal; named after its tool until it sets a terminal title.
    expect(await app.sessionIds(G)).toEqual([s, c])
    await expect(app.sessionItem(c)).toHaveAttribute('data-tool', 'claude')
    await expect(app.sessionItem(c).locator('[data-tool-icon="claude"]')).toBeVisible()
    await expectShown(app, `session:${c}`)
    await expect.poll(() => terminalHasFocus(app, c)).toBe(true)
    await expectName(app, c, 'Claude Code')
    await setTitle(app, c, run.pid, '✳ Fix the login bug')
    await expectName(app, c, 'Fix the login bug')

    // Back shows the issue's page, Forward the session again.
    await goBack(app)
    await expectShown(app, `issue:${issue}`)
    await goForward(app)
    await expectShown(app, `session:${c}`)

    // Without a description, the first message is the title alone.
    await openIssue(app, G, 'Only a title')
    await sendShownIssue(app)
    expect((await claudeRun(world, 2)).prompts).toEqual(['/hoot:split-issue # Only a title'])

    // A title starting with a slash stays in the heading, one starting with dashes is the name.
    await openIssue(app, G, '/other is broken')
    await sendShownIssue(app)
    const slash = await claudeRun(world, 3)
    expect(slash.prompts).toEqual(['/hoot:split-issue # /other is broken'])
    expect(slash.name).toBe('/other is broken')
    await openIssue(app, G, '--verbose flag broken')
    await sendShownIssue(app)
    const dashes = await claudeRun(world, 4)
    expect(dashes.name).toBe('--verbose flag broken')
    expect(dashes.prompts).toEqual(['/hoot:split-issue # --verbose flag broken'])
    expect(dashes.options).toEqual(['--permission-mode', 'acceptEdits'])
    await app.expectEnglishUi()
  })

  test('leaves the NUL characters of the title and description out of what it sends', async ({
    launch,
    world,
  }) => {
    writeSubstitutes(world)
    const { G, H } = world.repos
    // While Hoot does not run, with SQLite.
    addProjectsBeforeLaunch(world.userData, [G, H], [{ root: G, title: 'Fix login' }])
    const file = databaseFile(world.userData)
    changeDatabase(
      file,
      "UPDATE issues SET title = 'Fix' || char(0) || ' login', description = 'a' || char(0) || 'b'",
    )
    // As bytes: some versions of node:sqlite read text only up to a NUL character.
    const hex = (text: string) => Buffer.from(text).toString('hex').toUpperCase()
    expect(
      readDatabase(file, (db) =>
        db.prepare('SELECT hex(title) AS title, hex(description) AS description FROM issues').all(),
      ).map((row) => ({ ...row })),
    ).toEqual([{ title: hex('Fix\0 login'), description: hex('a\0b') }])
    const app = await launch()
    await expect(app.projectItems()).toHaveCount(2)
    await clickProjectRow(app, G)
    await expectList(app, G)
    await issueListPage(app).getByTestId('issue-row').click()
    await expect(issuePage(app)).toBeVisible()
    await sendShownIssue(app)

    const run = await claudeRun(world, 1)
    expect(run.name).toBe('Fix login')
    expect(run.prompts).toEqual(['/hoot:split-issue # Fix login\n\nab'])
  })

  test('loads the skill only in the sessions issues are sent to, and writes nothing to Claude Code’s configuration or the project', async ({
    launch,
    world,
  }) => {
    writeSubstitutes(world)
    const { G, H } = world.repos
    const claudeDir = path.join(world.home, '.claude')
    const claudeJson = path.join(world.home, '.claude.json')
    fs.mkdirSync(claudeDir)
    fs.writeFileSync(path.join(claudeDir, 'settings.json'), '{}\n')
    fs.writeFileSync(claudeJson, '{ "numStartups": 1 }\n')
    const configurationAndProject = async () => ({
      claudeDir: fs.existsSync(claudeDir) ? await snapshotTree(claudeDir) : null,
      claudeJson: fs.existsSync(claudeJson) ? fs.readFileSync(claudeJson, 'utf8') : null,
      project: await snapshotTree(G),
    })
    const before = await configurationAndProject()
    const app = await launch({ projects: [G, H], issues: [{ root: G, title: 'Alpha' }] })
    await openIssue(app, G, 'Alpha')
    await sendShownIssue(app)
    expectHootPlugin((await claudeRun(world, 1)).pluginDir)

    // From the new session menu: only the arguments of each tool's level.
    await app.startSession(G, 'claude')
    expect((await claudeRun(world, 2)).args).toEqual(['--dangerously-skip-permissions'])
    await app.startSession(G, 'codex')
    await expect.poll(() => readRuns(world.records, 'codex').length).toBe(1)
    expect(readRuns(world.records, 'codex')[0]!.args).toEqual([
      '--dangerously-bypass-approvals-and-sandbox',
    ])
    await app.startSession(G, 'opencode')
    await expect.poll(() => readRuns(world.records, 'opencode').length).toBe(1)
    expect(readRuns(world.records, 'opencode')[0]!.args).toEqual(['--auto'])
    const shell = await app.startSession(G, 'shell')
    await app.waitForPrompt(20_000, shell)
    const check = 'echo "$0"; [[ -o login ]] && echo login-shell'
    await app.run(check)
    expect(await app.outputOf(check, shell)).toEqual([world.env.SHELL, 'login-shell'])

    expect(await configurationAndProject()).toEqual(before)
  })

  test('starts a session that behaves like any other Claude Code session', async ({
    launch,
    world,
  }) => {
    const claude = writeSubstitutes(world)
    const { G, H } = world.repos
    const app = await launch({
      projects: [G, H],
      issues: [
        { root: G, title: 'Alpha' },
        { root: G, title: 'Beta' },
      ],
    })
    const c0 = await app.startSession(G, 'claude')
    await claudeRuns(world, 1)
    await openIssue(app, G, 'Alpha')
    const c1 = await sendShownIssue(app)
    const { pid } = await claudeRun(world, 2)

    // Named after its terminal title, not after the issue's title once it changes.
    await expectName(app, c1, 'Claude Code')
    await setTitle(app, c1, pid, '✳ Alpha')
    await expectName(app, c1, 'Alpha')
    await openIssue(app, G, 'Alpha')
    await editShownIssueTitle(app, 'Alpha renamed')
    await expect(issuePage(app).getByTestId('issue-title')).toHaveValue('Alpha renamed')
    await expectName(app, c1, 'Alpha')

    // Marking the issue done and deleting it leave the session as it is.
    await setShownIssueStatus(app, 'done')
    await expect(app.sessionItem(c1)).toHaveAttribute('data-status', 'running')
    await expectName(app, c1, 'Alpha')
    await deleteShownIssue(app)
    await expect(app.sessionItem(c1)).toHaveAttribute('data-status', 'running')
    await expectName(app, c1, 'Alpha')

    // Its row and its header show what those of a Claude Code session from the menu show.
    await app.selectSession(c0)
    for (const id of [c0, c1])
      await expect(app.sessionItem(id)).toHaveAttribute('data-status', 'running')
    await app.sessionItem(c0).hover()
    const row0 = await shownElementKinds(app.sessionItem(c0))
    const header0 = await shownElementKinds(app.sessionHeader())
    await app.selectSession(c1)
    await app.sessionItem(c1).hover()
    expect(await shownElementKinds(app.sessionItem(c1))).toEqual(row0)
    expect(await shownElementKinds(app.sessionHeader())).toEqual(header0)
    expect(row0.some((kind) => kind.includes('session-item-close'))).toBe(true)
    expect(row0.some((kind) => kind.endsWith(' claude'))).toBe(true)

    // Closing it asks first, as for any running session.
    await app.closeSession(c1)

    // When it cannot start: the error, no session left, and the button still sends.
    fs.rmSync(claude)
    await openIssue(app, G, 'Beta')
    const sessions = await app.sessionIds()
    await claudeCodeButton(app).click()
    await expect(app.toasts('Could not start Claude Code.')).toBeVisible()
    await expect(app.toasts('Could not start Claude Code.')).toContainText(
      'Claude Code is not available',
    )
    await expect.poll(() => app.sessionIds()).toEqual(sessions)
    await openIssue(app, G, 'Beta')
    await expectClaudeCodeButton(app, 'send', true)
  })

  test('leaves the menus, the other pages and the other sessions as they were', async ({
    launch,
    world,
  }) => {
    writeSubstitutes(world)
    const { G, H } = world.repos
    const app = await launch({ projects: [G, H], issues: [{ root: G, title: 'Alpha' }] })

    // The project row's menus.
    await app.openToolMenu(G)
    await expect(app.page.getByTestId('tool-entry-claude')).toHaveAttribute(
      'data-available',
      'true',
    )
    expect(await openMenus(app)).toEqual([`${TOOL_MENU}\nNew Worktree…`])
    await app.closeMenus()
    await app.openContextToolMenu(G)
    expect(await openMenus(app)).toEqual([
      'New Session\nNew Worktree…\nRemove from list',
      TOOL_MENU,
    ])
    await app.page.keyboard.press('Escape')
    await app.closeMenus()
    await app.projectItem(G).getByTestId('project-actions-button').click()
    await expect(app.page.locator('[role="menu"]')).toBeVisible()
    expect(await openMenus(app)).toEqual(['Remove from list'])
    await app.closeMenus()

    // A worktree row's menus, and the arguments of a session started from them.
    const W = await createWorktree(app, G, 'feature-x')
    await worktreeItem(app, W).getByTestId('worktree-new-session-button').click()
    await expect(app.toolItem('shell')).toBeVisible()
    expect(await openMenus(app)).toEqual([TOOL_MENU])
    await app.closeMenus()
    await openWorktreeContextMenu(app, W)
    await app.page.getByTestId('worktree-context-new-session').click()
    await expect(app.toolItem('shell')).toBeVisible()
    expect(await openMenus(app)).toEqual([
      'New Session\nReveal in Finder\nCopy Path\nDelete',
      TOOL_MENU,
    ])
    await app.page.keyboard.press('Escape')
    await app.closeMenus()
    await openWorktreeActions(app, W)
    expect(await openMenus(app)).toEqual(['Reveal in Finder\nCopy Path\nDelete'])
    await app.closeMenus()
    await startWorktreeSession(app, W, 'claude')
    expect((await claudeRun(world, 1)).args).toEqual(['--dangerously-skip-permissions'])

    // The menu bar.
    expect(menuBarItems(await app.applicationMenu())).toEqual(MENU_BAR)

    // No button on the issue list or in the new issue dialog.
    await clickProjectRow(app, G)
    await expectList(app, G)
    await expect(app.mainArea().getByText('Claude Code')).toHaveCount(0)
    await expect(app.mainArea().getByTestId('issue-claude-code')).toHaveCount(0)
    await openNewIssueDialog(app, G)
    await expect(newIssueDialog(app).getByText('Claude Code')).toHaveCount(0)
    await expect(newIssueDialog(app).getByTestId('issue-claude-code')).toHaveCount(0)
  })
})

test('an issue whose project folder is gone is not sent, like any session that cannot start', async ({
  launch,
  world,
}) => {
  writeSubstitutes(world)
  const { G, H } = world.repos
  const app = await launch({ projects: [G, H], issues: [{ root: H, title: 'Alpha' }] })
  const alpha = await openIssue(app, H, 'Alpha')
  fs.rmSync(H, { recursive: true, force: true })
  await clickClaudeCodeButton(app)
  await expect(app.toasts('Could not start Claude Code.')).toContainText(
    'The folder no longer exists',
  )
  await expect(app.sessionItems()).toHaveCount(0)
  // Without another session, the page shown before the session is shown again.
  await expectShown(app, `issue:${alpha}`)
  await expectClaudeCodeButton(app, 'send', true)
  expect(readRuns(world.records, 'claude')).toEqual([])
})

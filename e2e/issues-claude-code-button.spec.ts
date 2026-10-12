import fs from 'node:fs'
import path from 'node:path'
import type { Locator } from '@playwright/test'
import {
  claudeCodeButton,
  claudeCodeTooltip,
  claudeRuns,
  clickClaudeCodeButton,
  expectClaudeCodeButton,
  issueActions,
  SEND_HINT,
  sendShownIssue,
  terminalHasFocus,
} from './support/claude-code'
import { expectShown, goBack, issuePage, openIssue, setShownIssueState } from './support/issues'
import type { AppDriver } from './support/app'
import { quitSubstitute, readRuns, writeSubstitute } from './support/substitutes'
import { expect, test } from './support/test'

const INSTALL_COMMAND = 'npm install -g @anthropic-ai/claude-code'
const SHOW_HINT = 'Show the Claude Code session started from this issue'

/** Changes the title or the description of the issue whose page is shown, with Edit and Save. */
async function editShownIssue(
  app: AppDriver,
  changes: { title?: string; description?: string },
): Promise<void> {
  const page = issuePage(app)
  await page.getByTestId('issue-edit').click()
  if (changes.title !== undefined) await page.getByTestId('issue-title-input').fill(changes.title)
  if (changes.description !== undefined) {
    await page.getByTestId('issue-description-input').fill(changes.description)
  }
  await page.getByTestId('issue-save').click()
  await expect(page).toHaveAttribute('data-editing', 'false')
}

/** Waits until the new session menu shows Claude Code as available or not installed. */
async function expectClaudeCodeInMenu(
  app: AppDriver,
  root: string,
  shown: 'available' | 'Checking…' | 'Not installed',
): Promise<void> {
  await app.openToolMenu(root)
  const entry = app.page.getByTestId('tool-entry-claude')
  await expect(entry).toHaveAttribute('data-available', String(shown === 'available'))
  if (shown !== 'available') await expect(entry).toContainText(shown)
  await app.closeMenus()
}

test.describe('the Claude Code button of an issue', () => {
  test('comes first among the actions of an open issue, with Claude Code’s icon, and only there', async ({
    launch,
    world,
  }) => {
    writeSubstitute(world.interactiveBin, 'claude', world.records)
    const { G, H } = world.repos
    const app = await launch({
      projects: [G, H],
      issues: [
        { root: G, title: 'Alpha' },
        { root: G, title: 'Beta', status: 'done' },
      ],
    })
    await openIssue(app, G, 'Alpha')

    // First, before Edit, with the icon of Claude Code in the new session menu.
    await expectClaudeCodeButton(app, 'send', true)
    await expect(issueActions(app)).toHaveText([
      'Send to Claude Code',
      'Edit',
      'Close Issue',
      'Delete',
    ])
    const icon = (locator: Locator) => locator.locator('svg').evaluate((svg) => svg.innerHTML)
    const buttonIcon = await icon(claudeCodeButton(app))
    await app.openToolMenu(G)
    expect(await icon(app.toolItem('claude'))).toBe(buttonIcon)
    expect(buttonIcon).toContain('<path')
    await app.closeMenus()
    expect(await claudeCodeTooltip(app)).toBe(SEND_HINT)
    await app.expectEnglishUi()

    // Not in the edit state.
    await issuePage(app).getByTestId('issue-edit').click()
    await expect(issuePage(app)).toHaveAttribute('data-editing', 'true')
    await expect(claudeCodeButton(app)).toHaveCount(0)
    await issuePage(app).getByTestId('issue-cancel-edit').click()
    await expect(issueActions(app).first()).toHaveText('Send to Claude Code')
    await expect(issueActions(app).nth(1)).toHaveText('Edit')

    // Not on a closed issue's page, until it is reopened.
    await openIssue(app, G, 'Beta')
    await expect(issuePage(app).getByTestId('issue-reopen')).toBeVisible()
    await expect(claudeCodeButton(app)).toHaveCount(0)
    await setShownIssueState(app, 'open')
    await expectClaudeCodeButton(app, 'send', true)
    await expect(issueActions(app).first()).toHaveText('Send to Claude Code')
    await setShownIssueState(app, 'closed')
    await expect(claudeCodeButton(app)).toHaveCount(0)
  })

  test('shows the session an issue was sent to while it is in the sidebar, and only that one', async ({
    launch,
    world,
  }) => {
    const claude = writeSubstitute(world.interactiveBin, 'claude', world.records)
    const { G, H } = world.repos
    const app = await launch({
      projects: [G, H],
      issues: [
        { root: G, title: 'Alpha' },
        { root: G, title: 'Gamma' },
      ],
    })
    const c0 = await app.startSession(G, 'claude')
    await claudeRuns(world, 1)
    const alpha = await openIssue(app, G, 'Alpha')

    // A Claude Code session from the new session menu is not the issue's.
    await expect(app.sessionItem(c0)).toHaveAttribute('data-status', 'running')
    await expectClaudeCodeButton(app, 'send', true)

    // Sent: the button shows the session from then on.
    const c1 = await sendShownIssue(app)
    const c1Run = (await claudeRuns(world, 2))[1]!
    await goBack(app)
    await expectShown(app, `issue:${alpha}`)
    await expectClaudeCodeButton(app, 'show', true)
    expect(await claudeCodeTooltip(app)).toBe(SHOW_HINT)
    await app.expectEnglishUi()

    // It shows the session as its row does, starting nothing.
    const sessions = await app.sessionIds()
    await claudeCodeButton(app).click()
    await expectShown(app, `session:${c1}`)
    await expect.poll(() => terminalHasFocus(app, c1)).toBe(true)
    expect(await app.sessionIds()).toEqual(sessions)
    await goBack(app)
    await expectShown(app, `issue:${alpha}`)

    // Another issue's button still sends.
    await openIssue(app, G, 'Gamma')
    await expectClaudeCodeButton(app, 'send', true)

    // Renaming the session or editing the issue changes nothing.
    await app.sessionItem(c1).getByTestId('session-item-button').dblclick()
    const rename = app.sessionItem(c1).getByTestId('session-rename-input')
    await rename.fill('Renamed')
    await rename.press('Enter')
    await expect(app.sessionItemName(c1)).toHaveText('Renamed')
    await openIssue(app, G, 'Alpha')
    await expectClaudeCodeButton(app, 'show', true)
    await editShownIssue(app, { title: 'Alpha 2' })
    await expectClaudeCodeButton(app, 'show', true)
    await expect(app.sessionItemName(c1)).toHaveText('Renamed')

    // A session that ended on a signal stays in the sidebar, and the button shows it.
    process.kill(c1Run.pid, 'SIGTERM')
    await expect(app.sessionItem(c1)).toHaveAttribute('data-status', 'exited')
    await expectClaudeCodeButton(app, 'show', true)
    await claudeCodeButton(app).click()
    await expectShown(app, `session:${c1}`)
    await goBack(app)
    await expectShown(app, `issue:${alpha}`)

    // Closed, the session leaves the button sending again.
    await app.sessionItem(c1).hover()
    await app.sessionItem(c1).getByTestId('session-item-close').click()
    await expect(app.sessionItem(c1)).toHaveCount(0)
    await expectClaudeCodeButton(app, 'send', true)
    const c2 = await sendShownIssue(app)
    const c2Run = (await claudeRuns(world, 3))[2]!
    await goBack(app)
    await expectShown(app, `issue:${alpha}`)
    await expectClaudeCodeButton(app, 'show', true)

    // Closing the issue hides the button; reopening it brings it back as it was.
    await setShownIssueState(app, 'closed')
    await expect(claudeCodeButton(app)).toHaveCount(0)
    await setShownIssueState(app, 'open')
    await expectClaudeCodeButton(app, 'show', true)

    // Nothing that keeps an issue from being sent keeps the button from showing its session.
    fs.rmSync(claude)
    await app.page.getByTestId('sidebar-redetect-tools').click()
    await expectClaudeCodeInMenu(app, G, 'Not installed')
    await editShownIssue(app, { description: 'a'.repeat(100_001 - 'Alpha 2'.length) })
    await expectClaudeCodeButton(app, 'show', true)
    await claudeCodeButton(app).click()
    await expectShown(app, `session:${c2}`)
    await goBack(app)
    await expectShown(app, `issue:${alpha}`)

    // A session whose process exits with code 0 closes by itself, and the button
    // sends again, which it cannot do now.
    quitSubstitute(c2Run.pid)
    await expect(app.sessionItem(c2)).toHaveCount(0)
    await expectClaudeCodeButton(app, 'send', false)
    const tooltip = await claudeCodeTooltip(app)
    expect(tooltip).toContain('Claude Code is not installed')
    expect(tooltip).toContain(INSTALL_COMMAND)
    expect(tooltip).toContain('too long to send')
    // Showing the session never started Claude Code again.
    expect(readRuns(world.records, 'claude')).toHaveLength(3)
  })

  test('cannot send while Claude Code is still being checked for', async ({ launch, world }) => {
    writeSubstitute(world.interactiveBin, 'claude', world.records)
    // The first detection waits for the login shell, which waits for this file.
    const gate = path.join(world.root, 'login-shell-may-start')
    fs.appendFileSync(
      path.join(world.home, '.zshrc'),
      `while [ ! -e '${gate}' ]; do sleep 0.1; done\n`,
    )
    const { G, H } = world.repos
    const app = await launch({ projects: [G, H], issues: [{ root: G, title: 'Alpha' }] })
    await openIssue(app, G, 'Alpha')

    await expectClaudeCodeInMenu(app, G, 'Checking…')
    await expectClaudeCodeButton(app, 'send', false)
    expect(await claudeCodeTooltip(app)).toBe(
      'Hoot is still checking whether Claude Code is installed.',
    )
    await clickClaudeCodeButton(app)
    await expect(app.sessionItems()).toHaveCount(0)
    await app.expectEnglishUi()

    fs.writeFileSync(gate, '')
    await expectClaudeCodeButton(app, 'send', true)
    await expectClaudeCodeInMenu(app, G, 'available')
    expect(await claudeCodeTooltip(app)).toBe(SEND_HINT)
    expect(readRuns(world.records, 'claude')).toEqual([])
  })

  test('cannot send while Claude Code is not installed, or an issue that is too long, and says every reason', async ({
    launch,
    world,
  }) => {
    const { G, H } = world.repos
    const longest = `${'a'.repeat(99_997)}😀`
    const app = await launch({
      projects: [G, H],
      issues: [
        { root: G, title: 'Short' },
        { root: G, title: 'T', description: `${longest}a` },
        { root: G, title: 'U', description: longest },
      ],
    })

    // Without claude on the login shell PATH.
    await openIssue(app, G, 'Short')
    await expectClaudeCodeInMenu(app, G, 'Not installed')
    await expectClaudeCodeButton(app, 'send', false)
    const notInstalled = await claudeCodeTooltip(app)
    expect(notInstalled).toContain('Claude Code is not installed')
    expect(notInstalled).toContain(INSTALL_COMMAND)
    expect(notInstalled).not.toContain('too long')
    await clickClaudeCodeButton(app)
    await expect(app.sessionItems()).toHaveCount(0)
    await app.expectEnglishUi()

    // Not installed, and 100,001 code units long: both reasons.
    await openIssue(app, G, 'T')
    await expectClaudeCodeButton(app, 'send', false)
    const both = await claudeCodeTooltip(app)
    expect(both).toContain('Claude Code is not installed')
    expect(both).toContain(INSTALL_COMMAND)
    expect(both).toContain('This issue is too long to send. Shorten it first.')

    // Installed and detected again: the short issue can be sent, the long one still cannot.
    writeSubstitute(world.laterBin, 'claude', world.records)
    await app.page.getByTestId('sidebar-redetect-tools').click()
    await expectClaudeCodeInMenu(app, G, 'available')
    await expectClaudeCodeButton(app, 'send', false)
    expect(await claudeCodeTooltip(app)).toBe('This issue is too long to send. Shorten it first.')
    await clickClaudeCodeButton(app)
    await expect(app.sessionItems()).toHaveCount(0)
    await openIssue(app, G, 'Short')
    await expectClaudeCodeButton(app, 'send', true)
    expect(await claudeCodeTooltip(app)).toBe(SEND_HINT)

    // 100,000 code units can be sent; one more cannot, until it is taken out again.
    await openIssue(app, G, 'U')
    await expectClaudeCodeButton(app, 'send', true)
    await editShownIssue(app, { description: `${longest}a` })
    await expectClaudeCodeButton(app, 'send', false)
    expect(await claudeCodeTooltip(app)).toBe('This issue is too long to send. Shorten it first.')
    await clickClaudeCodeButton(app)
    await expect(app.sessionItems()).toHaveCount(0)
    await editShownIssue(app, { description: longest })
    await expectClaudeCodeButton(app, 'send', true)

    // And an issue that long reaches Claude Code whole.
    await sendShownIssue(app)
    expect((await claudeRuns(world, 1))[0]!.args.at(-1)).toBe(`/hoot:split-issue # U\n\n${longest}`)
  })
})

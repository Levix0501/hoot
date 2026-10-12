import fs from 'node:fs'
import path from 'node:path'
import { expect, type Locator } from '@playwright/test'
import type { AppDriver } from './app'
import { issuePage } from './issues'
import { readRuns, type SubstituteRun } from './substitutes'
import type { World } from './world'

/** The skill file of Hoot's Claude Code plugin, without a newline at its end. */
export const SPLIT_ISSUE_SKILL = [
  '---',
  'name: split-issue',
  'description: Judge whether a Hoot issue fits one agent session; if not, split it into ordered issues that can each be accepted on its own.',
  'disable-model-invocation: true',
  '---',
  '',
  'Here is an issue from Hoot. Its title is the heading; the rest, if any, is its description.',
  '',
  '$ARGUMENTS',
  '',
  "Judge the issue against this project's code. Read whatever you need, but change nothing: no edits, no commits, no commands that change files.",
  '',
  '1. Workload: can one fresh Claude Code session implement the whole issue, and another fresh session then verify it in full? Answer yes or no, and say why: the parts of the code it touches, and what is still unknown. Do not estimate time.',
  '2. If yes, say that it needs no split, and stop.',
  '3. If no, split it into issues that one session can each implement and another verify. Each delivers a narrow but complete result through every layer it touches, never one layer of the whole. For each:',
  '   - Title',
  '   - Description: what it delivers, and how to accept it',
  '   - Waits on: the issues it cannot be delivered and accepted without, or none',
  '4. End with the order, one chain per line, such as `1 → 2 → 4` and `1 → 3`.',
  '',
  "Write titles and descriptions in the issue's language. Where the issue leaves open something that changes your answer, say what you assumed.",
].join('\n')

/** What the button's tooltip says while the button sends the issue. */
export const SEND_HINT = "Judge the workload and split the issue with Hoot's built-in skill"

/**
 * The button among the actions of an open issue's page that sends the issue
 * to Claude Code, or shows the session it was sent to.
 */
export function claudeCodeButton(app: AppDriver): Locator {
  return issuePage(app).getByTestId('issue-claude-code')
}

/** The buttons among the actions of the issue page shown, in order. */
export function issueActions(app: AppDriver): Locator {
  return issuePage(app).getByTestId('issue-actions').getByRole('button')
}

/** Waits until the button sends the issue (`send`) or shows its session (`show`), usable or not. */
export async function expectClaudeCodeButton(
  app: AppDriver,
  action: 'send' | 'show',
  usable: boolean,
): Promise<void> {
  const button = claudeCodeButton(app)
  await expect(button).toHaveAttribute('data-action', action)
  await expect(button).toHaveText(
    action === 'send' ? 'Send to Claude Code' : 'Show Claude Code Session',
  )
  if (usable) await expect(button).toBeEnabled()
  else await expect(button).toBeDisabled()
}

/** Points at the button, also while it is disabled, and returns what its tooltip says. */
export async function claudeCodeTooltip(app: AppDriver): Promise<string> {
  const box = await claudeCodeButton(app).boundingBox()
  if (!box) throw new Error('The issue page shows no Claude Code button')
  const tooltip = app.page.getByTestId('issue-claude-code-tooltip')
  await app.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await expect(tooltip).toBeVisible()
  const text = await tooltip.innerText()
  // Away from the button, to the bottom of the main area.
  const size =
    app.page.viewportSize() ??
    (await app.page.evaluate(() => ({ width: innerWidth, height: innerHeight })))
  await app.page.mouse.move(size.width - 40, size.height - 20)
  await expect(tooltip).toHaveCount(0)
  return text
}

/**
 * Clicks the button, also while it is disabled, as a user does, then waits
 * long enough for a session it started to show in the sidebar.
 */
export async function clickClaudeCodeButton(app: AppDriver): Promise<void> {
  await claudeCodeButton(app).click({ force: true })
  await app.page.waitForTimeout(500)
}

/**
 * Sends the issue whose page is shown to Claude Code with the button, and
 * returns the new session's id once its process runs (or has ended).
 */
export async function sendShownIssue(app: AppDriver): Promise<string> {
  await expectClaudeCodeButton(app, 'send', true)
  const before = new Set(await app.sessionIds())
  const started = async () => (await app.sessionIds()).find((id) => !before.has(id))
  await claudeCodeButton(app).click()
  await expect.poll(started).toBeDefined()
  const id = (await started())!
  await expect(app.sessionItem(id)).toHaveAttribute('data-status', /^(running|exited)$/)
  return id
}

/**
 * The arguments a run of the stand-in for `claude` received, sorted out:
 * the values of `--plugin-dir` and `--name` (the argument after the option,
 * or what follows its `=`), the prompts (arguments that neither start with
 * `-` nor are the value of `--permission-mode`, `--plugin-dir` or `--name`),
 * and every other option, with the value of `--permission-mode`.
 */
export function claudeArguments(args: readonly string[]): {
  pluginDir: string | null
  name: string | null
  prompts: string[]
  options: string[]
} {
  const sorted = {
    pluginDir: null as string | null,
    name: null as string | null,
    prompts: [] as string[],
    options: [] as string[],
  }
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    const equals = arg.startsWith('--') ? arg.indexOf('=') : -1
    const option = equals === -1 ? arg : arg.slice(0, equals)
    const value = () => (equals === -1 ? (args[++index] ?? null) : arg.slice(equals + 1))
    if (option === '--plugin-dir') sorted.pluginDir = value()
    else if (option === '--name') sorted.name = value()
    else if (option === '--permission-mode') {
      sorted.options.push(arg)
      if (equals === -1 && index + 1 < args.length) sorted.options.push(args[++index]!)
    } else if (arg.startsWith('-')) sorted.options.push(arg)
    else sorted.prompts.push(arg)
  }
  return sorted
}

/**
 * The runs of the stand-in for `claude` so far, oldest first, once there are
 * `count` of them: a run is recorded a moment after its session runs.
 */
export async function claudeRuns(world: World, count: number): Promise<SubstituteRun[]> {
  await expect.poll(() => readRuns(world.records, 'claude').length).toBe(count)
  return readRuns(world.records, 'claude')
}

/** Checks that a plugin folder is Hoot's plugin `hoot`, with the split-issue skill. */
export function expectHootPlugin(pluginDir: string | null): void {
  expect(pluginDir).not.toBeNull()
  expect(path.basename(pluginDir!)).toBe('hoot')
  const skill = fs.readFileSync(path.join(pluginDir!, 'skills', 'split-issue', 'SKILL.md'), 'utf8')
  // With or without a newline at its end.
  expect(skill.replace(/\n$/, '')).toBe(SPLIT_ISSUE_SKILL)
}

/** Whether the keyboard focus is in a session's terminal. */
export async function terminalHasFocus(app: AppDriver, sessionId: string): Promise<boolean> {
  return app.page.evaluate(
    (id) => document.activeElement === window.hootTestHooks?.terminalOf(id)?.textarea,
    sessionId,
  )
}

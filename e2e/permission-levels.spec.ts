import Color from 'colorjs.io'
import type { Locator } from '@playwright/test'
import type { AppDriver } from './support/app'
import { childPids, commandLine, isAlive } from './support/processes'
import { readRuns, substituteError, writeSubstitute } from './support/substitutes'
import { expect, test } from './support/test'
import type { World } from './support/world'

type CodingTool = 'claude' | 'codex' | 'opencode'

interface Level {
  name: string
  /** The arguments, and the only ones, the tool runs with at this level. */
  args: string[]
}

const CODING_TOOLS: CodingTool[] = ['claude', 'codex', 'opencode']

const TOOL_LABELS: Record<CodingTool, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
}

/** Each coding tool's permission levels, highest first. */
const LEVELS: Record<CodingTool, Level[]> = {
  claude: [
    { name: 'Bypass permissions', args: ['--dangerously-skip-permissions'] },
    { name: 'Auto', args: ['--permission-mode', 'auto'] },
    { name: 'Accept edits', args: ['--permission-mode', 'acceptEdits'] },
    { name: 'Plan', args: ['--permission-mode', 'plan'] },
    { name: 'Manual', args: ['--permission-mode', 'manual'] },
  ],
  codex: [
    { name: 'Full Access', args: ['--dangerously-bypass-approvals-and-sandbox'] },
    {
      name: 'Default',
      args: ['--sandbox', 'workspace-write', '--ask-for-approval', 'on-request'],
    },
    { name: 'Read Only', args: ['--sandbox', 'read-only', '--ask-for-approval', 'on-request'] },
  ],
  opencode: [
    { name: 'Auto-approve', args: ['--auto'] },
    { name: 'Standard', args: [] },
  ],
}

const ALL_LEVEL_NAMES = CODING_TOOLS.flatMap((tool) => LEVELS[tool].map((level) => level.name))
const ALL_LEVEL_ARGS = new Set(
  CODING_TOOLS.flatMap((tool) => LEVELS[tool].flatMap((level) => level.args)),
)

function argsOf(tool: CodingTool, name: string): string[] {
  const level = LEVELS[tool].find((candidate) => candidate.name === name)
  if (!level) throw new Error(`${tool} has no level ${name}`)
  return level.args
}

/** Puts a substitute for every coding tool on the login shell PATH. */
function writeSubstitutes(world: World): void {
  writeSubstitute(world.interactiveBin, 'claude', world.records)
  writeSubstitute(world.loginBin, 'codex', world.records)
  writeSubstitute(world.laterBin, 'opencode', world.records)
}

/** Starts a session of the tool and returns the arguments its substitute received. */
async function startAndRecord(app: AppDriver, root: string, tool: CodingTool): Promise<string[]> {
  const before = readRuns(app.world.records, tool).length
  await app.startSession(root, tool)
  await expect.poll(() => readRuns(app.world.records, tool).length).toBe(before + 1)
  return readRuns(app.world.records, tool).at(-1)!.args
}

async function selectLevels(app: AppDriver, levels: Record<CodingTool, string>): Promise<void> {
  for (const tool of CODING_TOOLS) await app.selectPermissionLevel(TOOL_LABELS[tool], levels[tool])
}

async function checkedLevels(app: AppDriver): Promise<Record<CodingTool, string[]>> {
  return {
    claude: await app.checkedPermissionLevels(TOOL_LABELS.claude),
    codex: await app.checkedPermissionLevels(TOOL_LABELS.codex),
    opencode: await app.checkedPermissionLevels(TOOL_LABELS.opencode),
  }
}

async function textStyle(locator: Locator): Promise<{ luminance: number; fontSize: number }> {
  const style = await locator.evaluate((element) => {
    const computed = getComputedStyle(element)
    return { color: computed.color, fontSize: computed.fontSize }
  })
  return {
    luminance: new Color(style.color).luminance,
    fontSize: Number.parseFloat(style.fontSize),
  }
}

test.describe('permission levels', () => {
  test('the Agents menu lists the levels of each coding tool and checks the selected one', async ({
    app,
  }) => {
    const menuBar = await app.applicationMenu()
    expect(menuBar.map((item) => item.label)).toContain('Agents')
    const agents = await app.agentsMenu()
    expect(agents?.map((item) => item.label)).toEqual(['Claude Code', 'Codex', 'OpenCode'])
    for (const tool of CODING_TOOLS) {
      const items = agents?.find((item) => item.label === TOOL_LABELS[tool])?.submenu ?? []
      expect(items.map((item) => [item.label, item.type])).toEqual(
        LEVELS[tool].map((level) => [level.name, 'radio']),
      )
    }
    // A clean user data directory: every tool has its highest level.
    expect(await checkedLevels(app)).toEqual({
      claude: ['Bypass permissions'],
      codex: ['Full Access'],
      opencode: ['Auto-approve'],
    })
    await app.expectEnglishUi()

    await app.selectPermissionLevel('Claude Code', 'Plan')
    expect(await checkedLevels(app)).toEqual({
      claude: ['Plan'],
      codex: ['Full Access'],
      opencode: ['Auto-approve'],
    })
  })

  test('each level starts its tool with exactly its arguments', async ({ launch, world }) => {
    writeSubstitutes(world)
    const app = await launch()
    const { G } = world.repos
    await app.addProject(G)
    await expect(app.projectItems()).toHaveCount(1)

    for (const tool of CODING_TOOLS) {
      for (const level of LEVELS[tool]) {
        await app.selectPermissionLevel(TOOL_LABELS[tool], level.name)
        expect(await startAndRecord(app, G, tool), `${tool} ${level.name}`).toEqual(level.args)
        await expect(app.session()).toHaveAttribute('data-status', 'running')
      }
    }
  })

  test('the selected levels are kept after quitting and starting again', async ({
    launch,
    world,
  }) => {
    writeSubstitutes(world)
    const { G } = world.repos
    let app = await launch()
    await app.addProject(G)
    await expect(app.projectItems()).toHaveCount(1)
    await selectLevels(app, { claude: 'Plan', codex: 'Read Only', opencode: 'Standard' })

    await app.quit()
    await app.waitForExit()

    app = await launch()
    expect(await checkedLevels(app)).toEqual({
      claude: ['Plan'],
      codex: ['Read Only'],
      opencode: ['Standard'],
    })
    await expect(app.projectItems()).toHaveCount(1)
    const received: string[][] = []
    for (const tool of CODING_TOOLS) received.push(await startAndRecord(app, G, tool))
    expect(received).toEqual([argsOf('claude', 'Plan'), argsOf('codex', 'Read Only'), []])
  })

  test('a session starts with the level selected at that moment', async ({ launch, world }) => {
    writeSubstitute(world.interactiveBin, 'claude', world.records, 'fail')
    const app = await launch()
    const { G } = world.repos
    await app.addProject(G)
    await expect(app.projectItems()).toHaveCount(1)
    expect(await app.checkedPermissionLevels('Claude Code')).toEqual(['Bypass permissions'])

    const first = await app.startSession(G, 'claude')
    await expect(app.sessionItem(first)).toHaveAttribute('data-status', 'exited')
    await app.selectPermissionLevel('Claude Code', 'Manual')
    const second = await app.startSession(G, 'claude')
    await expect.poll(() => readRuns(world.records, 'claude').length).toBe(2)
    expect(second).not.toBe(first)

    const [firstRun, secondRun] = readRuns(world.records, 'claude')
    expect(firstRun!.args).toEqual(['--dangerously-skip-permissions'])
    expect(secondRun!.args).toEqual(argsOf('claude', 'Manual'))
    expect(secondRun!.args).not.toContain('--dangerously-skip-permissions')
  })

  test('selecting a level leaves a running session as it is', async ({ launch, world }) => {
    writeSubstitutes(world)
    const app = await launch()
    const { G } = world.repos
    await app.addProject(G)
    await expect(app.projectItems()).toHaveCount(1)
    expect(await app.checkedPermissionLevels('Codex')).toEqual(['Full Access'])

    expect(await startAndRecord(app, G, 'codex')).toEqual(argsOf('codex', 'Full Access'))
    await expect(app.session()).toHaveAttribute('data-status', 'running')
    await app.waitForTerminalText('substitute codex started')
    const session = await app.sessionId()
    const [run] = readRuns(world.records, 'codex')
    const ptyHostPid = await app.ptyHostPid()
    expect(await childPids(ptyHostPid!)).toContain(run!.pid)

    await app.selectPermissionLevel('Codex', 'Read Only')
    expect(await app.checkedPermissionLevels('Codex')).toEqual(['Read Only'])
    // Give a restart, had there been one, time to happen.
    await app.page.waitForTimeout(1_500)
    await expect(app.session()).toHaveAttribute('data-status', 'running')
    expect(await app.sessionId()).toBe(session)
    expect(isAlive(run!.pid)).toBe(true)
    expect(await childPids(ptyHostPid!)).toContain(run!.pid)
    expect(readRuns(world.records, 'codex')).toHaveLength(1)

    // The next session starts at the new level; the first one keeps running as it is.
    expect(await startAndRecord(app, G, 'codex')).toEqual(argsOf('codex', 'Read Only'))
    await expect(app.sessionItem(session)).toHaveAttribute('data-status', 'running')
    expect(isAlive(run!.pid)).toBe(true)
  })

  test('the new session menu shows the selected level next to each coding tool', async ({
    launch,
    world,
  }) => {
    writeSubstitutes(world)
    const app = await launch()
    await app.setSystemAppearance('light')
    const { G } = world.repos
    await app.addProject(G)
    await expect(app.projectItems()).toHaveCount(1)

    await app.openToolMenu(G)
    const shown: Record<CodingTool, string> = {
      claude: 'Bypass permissions',
      codex: 'Full Access',
      opencode: 'Auto-approve',
    }
    for (const tool of CODING_TOOLS) {
      await expect(app.toolPermissionLevel(tool)).toHaveText(shown[tool])
      await expect(app.toolPermissionLevel(tool)).toBeVisible()
      const name = await textStyle(app.toolLabel(tool))
      const level = await textStyle(app.toolPermissionLevel(tool))
      expect(level.luminance, `${tool} level color is lighter`).toBeGreaterThan(name.luminance)
      expect(level.fontSize, `${tool} level text is smaller`).toBeLessThan(name.fontSize)
    }
    // The same while an item is highlighted.
    await app.toolItem('claude').hover()
    await expect(app.toolItem('claude')).toBeFocused()
    expect((await textStyle(app.toolPermissionLevel('claude'))).luminance).toBeGreaterThan(
      (await textStyle(app.toolLabel('claude'))).luminance,
    )
    await expect(app.toolPermissionLevel('shell')).toHaveCount(0)
    const shellEntry = (await app.page.getByTestId('tool-entry-shell').innerText()).trim()
    expect(shellEntry).toBe('Shell')
    await app.expectEnglishUi()
    await app.closeMenus()

    await app.selectPermissionLevel('Codex', 'Read Only')
    await app.openToolMenu(G)
    await expect(app.toolPermissionLevel('codex')).toHaveText('Read Only')
    await expect(app.toolPermissionLevel('claude')).toHaveText('Bypass permissions')
    await expect(app.toolPermissionLevel('opencode')).toHaveText('Auto-approve')
    await expect(app.toolPermissionLevel('shell')).toHaveCount(0)
  })

  test('the session header does not show the permission level', async ({ launch, world }) => {
    writeSubstitutes(world)
    const app = await launch()
    const { G } = world.repos
    await app.addProject(G)
    await expect(app.projectItems()).toHaveCount(1)
    await app.selectPermissionLevel('Codex', 'Read Only')
    await app.selectPermissionLevel('OpenCode', 'Standard')
    expect(await checkedLevels(app)).toEqual({
      claude: ['Bypass permissions'],
      codex: ['Read Only'],
      opencode: ['Standard'],
    })

    const header = app.page.locator('[data-testid="session"] header')
    for (const tool of CODING_TOOLS) {
      await startAndRecord(app, G, tool)
      await expect(app.session()).toHaveAttribute('data-status', 'running')
      await expect(header).toContainText(TOOL_LABELS[tool])
      const text = await header.innerText()
      for (const name of ALL_LEVEL_NAMES) expect(text, `${tool} header`).not.toContain(name)
    }
  })

  test('Shell sessions run the same program and arguments whatever the levels', async ({
    app,
    world,
  }) => {
    const { G } = world.repos
    await app.addProject(G)
    await expect(app.projectItems()).toHaveCount(1)
    const shellCommandLine = async () => {
      await app.startSession(G, 'shell')
      await app.waitForPrompt()
      return commandLine(await app.shellPid())
    }

    await selectLevels(app, { claude: 'Plan', codex: 'Read Only', opencode: 'Standard' })
    const first = await shellCommandLine()
    await selectLevels(app, {
      claude: 'Bypass permissions',
      codex: 'Full Access',
      opencode: 'Auto-approve',
    })
    const second = await shellCommandLine()

    expect(first).toBe('/bin/zsh -l')
    expect(second).toBe(first)
    expect(first!.split(' ').filter((arg) => ALL_LEVEL_ARGS.has(arg))).toEqual([])

    expect((await app.agentsMenu())?.map((item) => item.label)).not.toContain('Shell')
    await app.openToolMenu(G)
    await expect(app.toolPermissionLevel('shell')).toHaveCount(0)
    expect((await app.page.getByTestId('tool-entry-shell').innerText()).trim()).toBe('Shell')
  })

  test('a coding tool that rejects its arguments ends like any other process', async ({
    launch,
    world,
  }) => {
    writeSubstitute(world.interactiveBin, 'claude', world.records, 'fail')
    const app = await launch()
    const { G } = world.repos
    await app.addProject(G)
    await expect(app.projectItems()).toHaveCount(1)
    await app.selectPermissionLevel('Claude Code', 'Plan')

    await app.startSession(G, 'claude')
    await expect(app.session()).toHaveAttribute('data-status', 'exited')
    await app.waitForTerminalText(substituteError('claude'))
    await expect(app.page.getByTestId('session-exit-message')).toHaveText(
      'Process exited with code 1.',
    )
    await expect(app.page.getByTestId('session-status')).toHaveText('Exited (1)')
    await expect(app.page.getByTestId('session-ended-close')).toBeVisible()
    await app.expectEnglishUi()

    // Run once, by the session, and never to ask for a version or for help.
    expect(readRuns(world.records, 'claude').map((run) => run.args)).toEqual([
      argsOf('claude', 'Plan'),
    ])

    const claudeLevels = (await app.agentsMenu())?.find((item) => item.label === 'Claude Code')
    expect(claudeLevels?.submenu?.map((item) => [item.label, item.enabled])).toEqual(
      LEVELS.claude.map((level) => [level.name, true]),
    )
    await app.openToolMenu(G)
    await expect(app.page.getByTestId('tool-entry-claude')).toHaveAttribute(
      'data-available',
      'true',
    )
    await expect(app.toolItem('claude')).not.toHaveAttribute('data-disabled')
  })
})

import {
  isTerminalVariable,
  PROCESS_METADATA_VARIABLES,
  referenceLoginEnv,
  SHELL_INSTANCE_VARIABLES,
} from './support/login-env'
import { readRecord, writeSubstitute, type SubstituteRecord } from './support/substitutes'
import { expect, test } from './support/test'

test.describe('tools', () => {
  test('tools are available when the login shell PATH has them, and can be re-detected', async ({
    launch,
    world,
  }) => {
    // `claude` is only on the PATH set up by the interactive startup file (.zshrc).
    writeSubstitute(world.interactiveBin, 'claude', world.records)
    writeSubstitute(world.loginBin, 'codex', world.records)
    const app = await launch()
    const { G } = world.repos
    await app.addProject(G)
    await expect(app.projectItems()).toHaveCount(1)

    await app.openToolMenu(G)
    for (const tool of ['claude', 'codex', 'shell'] as const) {
      await expect(app.page.getByTestId(`tool-entry-${tool}`)).toHaveAttribute(
        'data-available',
        'true',
      )
      await expect(app.toolItem(tool)).not.toHaveAttribute('data-disabled')
    }
    await expect(app.page.getByTestId('tool-entry-opencode')).toHaveAttribute(
      'data-available',
      'false',
    )
    await expect(app.toolItem('opencode')).toHaveAttribute('data-disabled', '')
    await expect(app.page.getByTestId('install-command-opencode')).toHaveText(
      'npm install -g opencode-ai',
    )
    await app.expectEnglishUi()

    // A disabled tool cannot start a session.
    await app.toolItem('opencode').click({ force: true })
    await app.closeMenus()
    await expect(app.session()).toHaveCount(0)
    expect(readRecord(world.records, 'opencode')).toBeNull()

    // Without restarting, make `opencode` reachable from the login shell PATH and re-detect.
    writeSubstitute(world.laterBin, 'opencode', world.records)
    await app.openToolMenu(G)
    await expect(app.toolItem('opencode')).toHaveAttribute('data-disabled', '')
    await app.page.getByTestId('redetect-tools').click()
    await expect(app.page.getByTestId('tool-entry-opencode')).toHaveAttribute(
      'data-available',
      'true',
    )
    await expect(app.toolItem('opencode')).not.toHaveAttribute('data-disabled')
    await expect(app.page.getByTestId('install-command-opencode')).toHaveCount(0)
    await app.expectEnglishUi()

    await app.toolItem('opencode').click()
    await expect(app.session()).toHaveAttribute('data-status', 'running')
    await expect.poll(() => readRecord(world.records, 'opencode')).not.toBeNull()
  })

  test('tool sessions run the command with its highest permission level by default, in the project root, with the login shell environment', async ({
    launch,
    world,
  }) => {
    writeSubstitute(world.interactiveBin, 'claude', world.records)
    writeSubstitute(world.loginBin, 'codex', world.records)
    writeSubstitute(world.laterBin, 'opencode', world.records)
    const app = await launch()
    const { G } = world.repos
    await app.addProject(G)
    await expect(app.projectItems()).toHaveCount(1)

    const records: SubstituteRecord[] = []
    for (const tool of ['claude', 'codex', 'opencode'] as const) {
      await app.startSession(G, tool)
      await expect(app.session()).toHaveAttribute('data-status', 'running')
      await app.waitForTerminalText(`substitute ${tool} started`)
      const record = readRecord(world.records, tool)
      expect(record, `${tool} record`).not.toBeNull()
      records.push(record!)
      await app.expectEnglishUi()
    }

    const reference = referenceLoginEnv(world)
    expect(reference.PATH).toContain(world.interactiveBin)
    expect(reference.HOOT_E2E_RC_FILE).toBe('loaded')

    // A clean user data directory, and no level was picked in the Agents menu.
    expect(records.map((record) => [record.name, record.args])).toEqual([
      ['claude', ['--dangerously-skip-permissions']],
      ['codex', ['--dangerously-bypass-approvals-and-sandbox']],
      ['opencode', ['--auto']],
    ])
    for (const record of records) {
      expect(record.cwd, `${record.name} working directory`).toBe(G)

      const names = new Set([...Object.keys(reference), ...Object.keys(record.env)])
      const unexpected = [...names].filter(
        (name) =>
          reference[name] !== record.env[name] &&
          !isTerminalVariable(name) &&
          !SHELL_INSTANCE_VARIABLES.has(name) &&
          !PROCESS_METADATA_VARIABLES.has(name),
      )
      expect(unexpected, `${record.name} environment differences`).toEqual([])
    }

    const terminalVariables = records.map((record) =>
      Object.fromEntries(Object.entries(record.env).filter(([name]) => isTerminalVariable(name))),
    )
    expect(terminalVariables[0]).toMatchObject({ TERM: 'xterm-256color' })
    expect(terminalVariables[1]).toEqual(terminalVariables[0])
    expect(terminalVariables[2]).toEqual(terminalVariables[0])
  })
})

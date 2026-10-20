import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import which from 'which'
import type { AgentsState } from '../../shared/agents'
import type { CodingToolId } from '../../shared/tools'
import { writeNodeCommand, writeNodeScript } from '../tools/test-support'
import { ToolService } from '../tools/tool-service'
import { AgentService } from './agent-service'
import { linkCommand, npmCommandsFolder, npmPackagesFolder } from './test-support'

/**
 * Windows, where npm lays out a global folder in a way of its own (see
 * `npmCommandsFolder`).
 */
const windows = process.platform === 'win32'

/** cmd-shim, with which the stand-in npm makes the batch files of commands on Windows, as npm does. */
const CMD_SHIM = createRequire(import.meta.url).resolve('cmd-shim')

/** shell-quote, with which the stand-in npm writes commands elsewhere, as `writeNodeScript` does. */
const SHELL_QUOTE = createRequire(import.meta.url).resolve('shell-quote')

/**
 * A stand-in npm, a Node.js script. `prefix -g` says its global folder;
 * `install -g <package>@latest` installs a stand-in of the package there,
 * laid out as npm lays out a global folder, whose command reports the version
 * in `latest-<command>`. A test can
 * add to what it does with `npmScript`, which it runs first; it logs how it
 * was run in `npm.log`: its path, that of the command that runs it (the
 * script without `.cjs`), and its arguments.
 */
const FAKE_NPM = `const fs = require('node:fs')
const path = require('node:path')
const root = __ROOT__
const windows = process.platform === 'win32'
const write = (text) => fs.writeSync(1, text)
const say = (text) => write(text + '\\n')
const complain = (text) => fs.writeSync(2, text + '\\n')
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const self = process.argv[1].replace(/\\.cjs$/, '')
const args = process.argv.slice(2)
fs.appendFileSync(path.join(root, 'npm.log'), [self, ...args].join(' ') + '\\n')
const prefix = fs.realpathSync.native(windows ? path.dirname(self) : path.join(path.dirname(self), '..'))
let spec = null
for (const arg of args) {
  if (arg === 'prefix') {
    say(prefix)
    process.exit(0)
  }
  if (arg.endsWith('@latest')) spec = arg.slice(0, -'@latest'.length)
}

async function install(npmPackage, command, script) {
  const packages = windows ? path.join(prefix, 'node_modules') : path.join(prefix, 'lib', 'node_modules')
  const file = path.join(packages, npmPackage, 'bin', command)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (windows) {
    fs.writeFileSync(file, '#!/usr/bin/env node\\n' + script)
    await require(__CMD_SHIM__)(file, path.join(prefix, command))
    return
  }
  fs.writeFileSync(file + '.cjs', script)
  const run = 'exec ' + require(__SHELL_QUOTE__).quote([process.execPath, file + '.cjs']) + ' "$@"'
  fs.writeFileSync(file, '#!/bin/sh\\n' + run + '\\n')
  fs.chmodSync(file, 0o755)
  const link = path.join(prefix, 'bin', command)
  fs.mkdirSync(path.dirname(link), { recursive: true })
  fs.rmSync(link, { force: true })
  fs.symlinkSync(path.join('..', 'lib', 'node_modules', npmPackage, 'bin', command), link)
}

const commands = {
  '@anthropic-ai/claude-code': 'claude',
  '@openai/codex': 'codex',
  '@opencode/cli': 'opencode',
}

async function main() {
  const script = path.join(root, 'npm-script.cjs')
  if (fs.existsSync(script)) {
    const code = await require(script)({ root, prefix, spec, write, say, complain, sleep, install })
    if (code !== undefined) return code
  }
  const command = commands[spec]
  if (command === undefined) {
    complain('npm error code E404')
    return 1
  }
  const version = fs.readFileSync(path.join(root, 'latest-' + command), 'utf8')
  const report = JSON.stringify(version + ' (stand-in)\\n')
  await install(spec, command, "require('node:fs').writeSync(1, " + report + ')\\n')
  say('added 1 package')
  return 0
}

main().then((code) => {
  process.exitCode = code
})
`

const PACKAGES: Record<CodingToolId, string> = {
  claude: '@anthropic-ai/claude-code',
  codex: '@openai/codex',
  opencode: '@opencode/cli',
}

let root: string
let home: string
/** The global folder of the computer's npm. */
let prefix: string

function write(file: string, content: string, mode = 0o644): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content, { mode })
}

/** The stand-in npm's script, for the folder of the test. */
function fakeNpm(): string {
  return FAKE_NPM.replace('__ROOT__', JSON.stringify(root))
    .replace('__CMD_SHIM__', JSON.stringify(CMD_SHIM))
    .replace('__SHELL_QUOTE__', JSON.stringify(SHELL_QUOTE))
}

/**
 * Sets what the stand-in npm does first: the body of an async function of
 * `npm`, which has the folder of the test (`root`), the global folder npm
 * installs into (`prefix`), the package asked for (`spec`), `write`, `say`
 * and `complain` to write to its outputs, `sleep`, and `install`, which
 * installs a stand-in of a package's command that runs the script given. A
 * number it returns ends npm with that exit code; otherwise npm goes on.
 */
function npmScript(body: string): void {
  write(
    path.join(root, 'npm-script.cjs'),
    `const fs = require('node:fs')\nconst path = require('node:path')\nmodule.exports = async (npm) => {\n${body}\n}\n`,
  )
}

/** Installs a stand-in of an agent at a version into a global folder, as npm does. */
async function installInto(folder: string, id: CodingToolId, version: string): Promise<void> {
  const script = path.join(npmPackagesFolder(folder), PACKAGES[id], 'bin', id)
  const report = `require('node:fs').writeSync(1, ${JSON.stringify(`${version} (stand-in)\n`)})\n`
  // On Windows the batch file runs the script with node, as npm's packages ask.
  if (windows) write(script, `#!/usr/bin/env node\n${report}`)
  else writeNodeScript(script, report)
  await linkCommand(script, npmCommandsFolder(folder), id)
}

/**
 * The path at which a PATH lookup finds a command in a folder: on Windows,
 * that of its batch file, with the extension spelled as PATHEXT spells it.
 */
function commandIn(folder: string, command: string): string {
  return which.sync(path.join(folder, command))
}

function setLatest(id: CodingToolId, version: string): void {
  fs.writeFileSync(path.join(root, `latest-${id}`), version)
}

/** Puts a stand-in node that reports a version first on the login shell PATH. */
function fakeNode(version: string): void {
  write(path.join(home, '.local', 'bin', 'node'), `#!/bin/sh\necho "v${version}"\n`, 0o755)
}

/**
 * Installs a stand-in Claude Code as its official installer does: its
 * versions in ~/.local/share/claude/versions, and its command in ~/.local/bin.
 */
function installOfficialClaude(version: string): void {
  const file = path.join(home, '.local', 'share', 'claude', 'versions', version)
  write(file, `#!/bin/sh\necho "${version} (Claude Code)"\n`, 0o755)
  fs.mkdirSync(path.join(home, '.local', 'bin'), { recursive: true })
  fs.symlinkSync(file, path.join(home, '.local', 'bin', 'claude'))
}

function npmRuns(): string[] {
  const log = path.join(root, 'npm.log')
  return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []
}

beforeEach(async () => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-agents-')))
  home = path.join(root, 'home')
  prefix = path.join(root, 'npm-global')
  fs.mkdirSync(home)
  write(path.join(root, 'fake-npm'), fakeNpm())
  await writeNodeCommand(path.join(npmCommandsFolder(prefix), 'npm'), fakeNpm())
  fs.mkdirSync(npmPackagesFolder(prefix), { recursive: true })
  for (const id of ['claude', 'codex', 'opencode'] as const) setLatest(id, '2.0.0')
})

afterEach(() => {
  fs.chmodSync(npmPackagesFolder(prefix), 0o755)
  fs.chmodSync(npmCommandsFolder(prefix), 0o755)
  fs.rmSync(root, { recursive: true, force: true })
})

function setup(
  options: {
    /** Whether the computer's npm is on the login shell PATH. */
    withNpm?: boolean
    latest?: Partial<Record<CodingToolId, string | null>>
    /** The Node.js versions each latest version needs, where its command runs on Node.js. */
    latestNode?: Partial<Record<CodingToolId, string>>
    sessions?: () => string[]
    /** The platform Hoot runs on, as it is on the computer by default. */
    platform?: NodeJS.Platform
    /** Runs each time the service has the login shell environment read again, before it is. */
    beforeLoginEnvironment?: () => Promise<void>
  } = {},
) {
  // ~/.local/bin, where an official installer may put an agent, comes first.
  const loginPath = [
    path.join(home, '.local', 'bin'),
    ...(options.withNpm === false ? [] : [npmCommandsFolder(prefix)]),
    // The system's folders, which a login shell's PATH has on macOS.
    ...(windows ? [] : ['/usr/bin', '/bin']),
  ].join(path.delimiter)
  const loginEnv = { PATH: loginPath, HOME: home }
  const tools = new ToolService({
    shell: '/bin/zsh',
    // On Windows, where no login shell is read, the environment Hoot started with.
    baseEnv: loginEnv,
    cwd: home,
    resolveEnv: async () => ({ ...loginEnv }),
  })
  const latestCalls: string[] = []
  const service = new AgentService({
    detectTools: async () => {
      await options.beforeLoginEnvironment?.()
      return tools.detectWithEnvironment()
    },
    getLoginEnvironment: () => tools.getLoginEnvironment(),
    home,
    latestRelease: async (npmPackage) => {
      latestCalls.push(npmPackage)
      const id = (Object.keys(PACKAGES) as CodingToolId[]).find(
        (key) => PACKAGES[key] === npmPackage,
      )
      const latest = id ? options.latest?.[id] : undefined
      if (latest === null) return null
      return { version: latest ?? '2.0.0', node: (id && options.latestNode?.[id]) || null }
    },
    runningSessions: () => options.sessions?.() ?? [],
    launchOptions: async () => ({
      models: [],
      defaultEfforts: [],
      defaultModel: null,
      defaultEffort: null,
    }),
    now: () => now,
    platform: options.platform,
  })
  const states: AgentsState[] = []
  let now = Date.now()
  service.on('changed', (state) => states.push(state))
  const agent = (id: CodingToolId) => {
    const found = service.getState().agents.find((entry) => entry.id === id)
    if (!found) throw new Error(`No ${id}`)
    return found
  }
  /** Settles once the agent's operation has ended. */
  const ended = (id: CodingToolId) =>
    vi.waitFor(
      () => {
        const status = agent(id).operation?.status
        expect(['succeeded', 'failed', 'cancelled']).toContain(status)
        expect(agent(id).checking).toBe(false)
      },
      { timeout: 10_000, interval: 20 },
    )
  return {
    service,
    tools,
    states,
    agent,
    ended,
    latestCalls,
    setNow: (value: number) => {
      now = value
    },
  }
}

/**
 * A service whose readings of the login shell environment wait, from
 * `hold()` on, until `release()`; `reads` counts them.
 */
function heldSetup() {
  let gate: PromiseWithResolvers<void> | null = null
  let reads = 0
  const context = setup({
    beforeLoginEnvironment: async () => {
      reads += 1
      await gate?.promise
    },
  })
  return {
    ...context,
    reads: () => reads,
    hold: () => {
      gate = Promise.withResolvers<void>()
    },
    release: () => gate?.resolve(),
  }
}

describe('AgentService detection', () => {
  it('finds each agent, how it was installed, its version and the latest one', async () => {
    await installInto(prefix, 'claude', '1.0.0')
    await writeNodeCommand(
      path.join(home, '.local', 'bin', 'codex'),
      "require('node:fs').writeSync(1, 'codex-cli 2.0.0\\n')\n",
    )
    const { service, agent, latestCalls } = setup({ latest: { claude: '1.5.0' } })
    expect(agent('claude').checking).toBe(true)
    await service.detect()

    expect(agent('claude')).toMatchObject({
      checking: false,
      installation: {
        path: commandIn(npmCommandsFolder(prefix), 'claude'),
        method: 'npm',
        version: '1.0.0',
      },
      latest: '1.5.0',
      latestFailed: false,
      operation: null,
    })
    const codex = commandIn(path.join(home, '.local', 'bin'), 'codex')
    expect(agent('codex').installation).toMatchObject({
      path: codex,
      displayPath: path.join('~', path.relative(home, codex)),
      method: 'unknown',
      version: '2.0.0',
    })
    expect(agent('opencode').installation).toBeNull()
    expect(service.getState().installTarget).toEqual({
      kind: 'npm',
      prefix,
      displayPrefix: prefix,
    })
    expect(latestCalls.toSorted()).toEqual(Object.values(PACKAGES).toSorted())
  })

  it('shows the commands Install and Update run with npm', async () => {
    await installInto(prefix, 'codex', '1.0.0')
    const { service, agent } = setup()
    await service.detect()
    const npm = commandIn(npmCommandsFolder(prefix), 'npm')
    expect(agent('opencode').installCommand).toBe(
      `${npm} install -g @opencode/cli@latest --loglevel=http`,
    )
    expect(agent('codex').installation?.updateCommand).toBe(
      `${npm} install -g @openai/codex@latest --loglevel=http`,
    )
  })

  // On Windows the official installers install programs, which no script can stand in for.
  it.skipIf(windows)(
    "shows the command of an official installer's update, with ~ for the home folder",
    async () => {
      installOfficialClaude('1.0.0')
      const { service, agent } = setup()
      await service.detect()
      expect(agent('claude').installation).toMatchObject({
        method: 'official',
        updateCommand: '~/.local/bin/claude update',
      })
    },
  )

  // Windows has no permissions on folders that keep the user from creating files.
  it.skipIf(windows)(
    'tells an installation by npm whose global folder the user cannot write to',
    async () => {
      await installInto(prefix, 'codex', '1.0.0')
      installOfficialClaude('1.0.0')
      const { service, agent } = setup()
      await service.detect()
      expect(agent('codex').installation?.writable).toBe(true)
      fs.chmodSync(npmPackagesFolder(prefix), 0o555)
      await service.detect()
      expect(agent('codex').installation?.writable).toBe(false)
      // Hoot does not check the folders of the others.
      expect(agent('claude').installation?.writable).toBe(true)
    },
  )

  // On Windows node is a program, node.exe, which no script can stand in for.
  it.skipIf(windows)(
    'tells the Node.js a latest version needs where npm would install it, when the node on the login shell PATH is too old',
    async () => {
      fakeNode('20.19.6')
      await installInto(prefix, 'codex', '1.0.0')
      installOfficialClaude('1.0.0')
      const { service, agent } = setup({
        latestNode: { claude: '>=22.0.0', codex: '>=22.19.0', opencode: '>=22' },
      })
      await service.detect()
      expect(agent('codex').nodeRequirement).toEqual({ range: '>=22.19.0', found: '20.19.6' })
      // Not installed, so Install would install it with npm.
      expect(agent('opencode').nodeRequirement).toEqual({ range: '>=22', found: '20.19.6' })
      // Installed by its official installer, which npm's package does not apply to.
      expect(agent('claude').nodeRequirement).toBeNull()

      fakeNode('24.15.0')
      await service.detect()
      expect(agent('codex').nodeRequirement).toBeNull()
      expect(agent('opencode').nodeRequirement).toBeNull()
    },
  )

  it('no longer finds the agents an earlier Hoot installed in its own folder, ~/.hoot/agents', async () => {
    await installInto(path.join(home, '.hoot', 'agents'), 'codex', '1.0.0')
    const { service, agent } = setup()
    await service.detect()
    expect(agent('codex').installation).toBeNull()
  })

  // Windows has no permissions on folders that keep the user from creating files.
  it.skipIf(windows)(
    "shows that Install needs write access to npm's global folder when the user cannot create files in it",
    async () => {
      const { service, agent } = setup()
      fs.chmodSync(npmPackagesFolder(prefix), 0o555)
      await service.detect()
      expect(service.getState().installTarget).toEqual({
        kind: 'npm-not-writable',
        prefix,
        displayPrefix: prefix,
      })
      expect(agent('codex').installCommand).toBeNull()
    },
  )

  it('shows that Install needs Node.js and npm when the login shell PATH has no npm', async () => {
    const { service, agent } = setup({ withNpm: false })
    await service.detect()
    expect(service.getState().installTarget).toEqual({ kind: 'node-required' })
    expect(agent('codex').installCommand).toBeNull()
  })

  it('tells an installation that does not run, and keeps what it wrote', async () => {
    await writeNodeCommand(
      path.join(npmCommandsFolder(prefix), 'opencode'),
      "require('node:fs').writeSync(2, 'env: node: not found\\n')\nprocess.exitCode = 127\n",
    )
    const { service, agent } = setup()
    await service.detect()
    expect(agent('opencode').installation).toMatchObject({ method: 'unknown', version: null })
    expect(agent('opencode').installation?.versionOutput).toBe(
      'env: node: not found\nIt exited with code 127.',
    )
  })

  it('says when the latest version could not be read', async () => {
    await installInto(prefix, 'claude', '1.0.0')
    const { service, agent } = setup({ latest: { claude: null } })
    await service.detect()
    expect(agent('claude')).toMatchObject({ latest: null, latestFailed: true })
  })

  it('reads everything again, after a detection under way, for a call made meanwhile', async () => {
    const { service, agent } = setup()
    const first = service.detect()
    await installInto(prefix, 'opencode', '2.0.0')
    const second = service.detect()
    expect(service.detect()).toBe(second)
    await Promise.all([first, second])
    expect(agent('opencode').installation?.version).toBe('2.0.0')
  })
})

describe('AgentService detection times', () => {
  it('detects when the page opens the first time, then only 20 hours after the last detection started', async () => {
    await installInto(prefix, 'claude', '1.0.0')
    const { service, setNow } = setup()
    const start = Date.now()
    setNow(start)
    expect(service.getState().detectedAt).toBeNull()
    service.openPage()
    await vi.waitFor(() => expect(service.getState().detecting).toBe(false), { timeout: 10_000 })
    expect(service.getState().detectedAt).toBe(start)

    // A page opened sooner shows the last results without checking again.
    setNow(start + 20 * 60 * 60 * 1000 - 1)
    service.openPage()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(service.getState().detectedAt).toBe(start)

    setNow(start + 20 * 60 * 60 * 1000)
    service.openPage()
    await vi.waitFor(
      () => expect(service.getState().detectedAt).toBe(start + 20 * 60 * 60 * 1000),
      { timeout: 10_000 },
    )
    await vi.waitFor(() => expect(service.getState().detecting).toBe(false))
  })

  it('checks again when Re-detect asks, and counts the 20 hours from that detection', async () => {
    const { service, setNow } = setup()
    const start = Date.now()
    setNow(start)
    await service.detect()
    expect(service.getState().detectedAt).toBe(start)
    setNow(start + 1_000)
    await service.detect()
    expect(service.getState().detectedAt).toBe(start + 1_000)
    service.openPage()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(service.getState().detectedAt).toBe(start + 1_000)
  })
})

describe('AgentService installs', () => {
  it("installs with the computer's npm into its global folder", async () => {
    setLatest('claude', '2.1.0')
    const { service, tools, agent, ended } = setup()
    await service.detect()
    service.install('claude')
    await ended('claude')
    expect(agent('claude').operation).toEqual({
      kind: 'install',
      status: 'succeeded',
      message: '✓ Installed 2.1.0',
    })
    expect(agent('claude').installation).toMatchObject({
      path: commandIn(npmCommandsFolder(prefix), 'claude'),
      method: 'npm',
      version: '2.1.0',
    })
    expect(npmRuns()).toContain(
      `${path.join(npmCommandsFolder(prefix), 'npm')} install -g @anthropic-ai/claude-code@latest --loglevel=http`,
    )
    // The new session menu has it at once.
    expect(tools.getState().tools.find((tool) => tool.id === 'claude')?.available).toBe(true)
  })

  it('fails, saying Node.js and npm are needed, when the computer has no npm', async () => {
    const { service, agent, ended } = setup({ withNpm: false })
    await service.detect()
    service.install('claude')
    await ended('claude')
    expect(agent('claude').operation).toMatchObject({
      kind: 'install',
      status: 'failed',
      message: '✕ Install failed: Install needs Node.js and npm',
    })
    // Hoot installed nothing of its own.
    expect(fs.existsSync(path.join(home, '.hoot'))).toBe(false)
  })

  // Windows has no permissions on folders that keep the user from creating files.
  it.skipIf(windows)(
    "fails, saying write access is needed, when the user cannot write to npm's global folder",
    async () => {
      const { service, agent, ended } = setup()
      fs.chmodSync(npmCommandsFolder(prefix), 0o555)
      await service.detect()
      service.install('codex')
      await ended('codex')
      expect(agent('codex').operation).toMatchObject({
        kind: 'install',
        status: 'failed',
        message: "✕ Install failed: Install needs write access to npm's folder",
      })
      expect(npmRuns().filter((run) => run.includes(' install '))).toEqual([])
      expect(fs.existsSync(path.join(home, '.hoot'))).toBe(false)
    },
  )

  // On Windows node is a program, node.exe, which no script can stand in for.
  it.skipIf(windows)(
    'fails, saying which Node.js is needed, when the node on the login shell PATH is too old for the latest version',
    async () => {
      fakeNode('20.19.6')
      const { service, agent, ended } = setup({ latestNode: { codex: '>=22.19.0' } })
      await service.detect()
      service.install('codex')
      await ended('codex')
      expect(agent('codex').operation).toMatchObject({
        kind: 'install',
        status: 'failed',
        message: '✕ Install failed: 2.0.0 needs Node.js 22.19.0 or later (yours is 20.19.6)',
      })
      expect(npmRuns().filter((run) => run.includes(' install '))).toEqual([])
    },
  )

  // On Windows node is a program, node.exe, which no script can stand in for.
  it.skipIf(windows)(
    'installs when the node on the login shell PATH is new enough for the latest version',
    async () => {
      fakeNode('24.15.0')
      const { service, agent, ended } = setup({ latestNode: { codex: '>=22.19.0' } })
      await service.detect()
      service.install('codex')
      await ended('codex')
      expect(agent('codex').operation).toMatchObject({ status: 'succeeded' })
    },
  )

  it('fails when npm fails, with the last lines of what it wrote and all of it', async () => {
    npmScript(`
      for (let i = 1; i <= 6; i++) npm.say('line ' + i)
      npm.complain('npm error code E404')
      return 1
    `)
    const { service, agent, ended } = setup()
    await service.detect()
    service.install('opencode')
    await ended('opencode')
    expect(agent('opencode').operation).toEqual({
      kind: 'install',
      status: 'failed',
      message: '✕ Install failed: npm exited with code 1',
      reason: 'npm exited with code 1',
      tail: ['line 3', 'line 4', 'line 5', 'line 6', 'npm error code E404'],
      output: 'line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nnpm error code E404',
      command: `${path.join(npmCommandsFolder(prefix), 'npm')} install -g @opencode/cli@latest --loglevel=http`,
      exitCode: 1,
      // The test's clock stands still while npm runs.
      seconds: 0,
    })
    expect(agent('opencode').installation).toBeNull()
  })

  it('fails when npm succeeds but the agent does not run afterwards', async () => {
    npmScript(`
      await npm.install('@opencode/cli', 'opencode', 'process.exitCode = 1\\n')
      return 0
    `)
    const { service, agent, ended } = setup()
    await service.detect()
    service.install('opencode')
    await ended('opencode')
    expect(agent('opencode').operation).toMatchObject({
      status: 'failed',
      message: "✕ Install failed: npm finished, but OpenCode doesn't run",
    })
  })

  it('fails when npm succeeds but the agent is not found afterwards', async () => {
    npmScript('return 0')
    const { service, agent, ended } = setup()
    await service.detect()
    service.install('codex')
    await ended('codex')
    expect(agent('codex').operation).toMatchObject({
      status: 'failed',
      message: '✕ Install failed: npm finished, but Codex is not found',
    })
  })

  it("reports an operation as running without showing its command's output", async () => {
    npmScript(`
      npm.say('fetching')
      await npm.sleep(1000)
    `)
    const { service, agent, ended } = setup()
    await service.detect()
    service.install('claude')
    await vi.waitFor(
      () =>
        expect(agent('claude').operation).toEqual({
          kind: 'install',
          status: 'running',
          cancellable: true,
        }),
      { timeout: 5_000 },
    )
    await ended('claude')
  })
})

describe('AgentService updates', () => {
  it('updates an npm installation in its global folder, and counts the sessions still on the old version', async () => {
    await installInto(prefix, 'claude', '1.0.0')
    setLatest('claude', '2.1.0')
    let sessions = ['s1', 's2', 's3']
    const { service, agent, ended } = setup({ sessions: () => sessions })
    await service.detect()
    service.update('claude')
    // One session ends during the update.
    sessions = ['s1', 's3', 's4']
    await ended('claude')
    expect(agent('claude').operation).toMatchObject({
      kind: 'update',
      status: 'succeeded',
      message: '✓ Updated to 2.1.0. 2 running sessions still use 1.0.0.',
    })
    expect(agent('claude').installation?.version).toBe('2.1.0')
    expect(npmRuns().filter((run) => run.includes(' install '))).toEqual([
      `${path.join(npmCommandsFolder(prefix), 'npm')} install -g @anthropic-ai/claude-code@latest --loglevel=http`,
    ])
  })

  it('fails when the version did not change', async () => {
    await installInto(prefix, 'opencode', '1.0.0')
    npmScript(`
      npm.say('up to date')
      return 0
    `)
    const { service, agent, ended } = setup()
    await service.detect()
    service.update('opencode')
    await ended('opencode')
    expect(agent('opencode').operation).toMatchObject({
      status: 'failed',
      message: '✕ Update failed: npm finished, but the version is still 1.0.0',
      output: 'up to date',
      command: `${path.join(npmCommandsFolder(prefix), 'npm')} install -g @opencode/cli@latest --loglevel=http`,
      exitCode: 0,
    })
  })

  it('fails when the version afterwards is not newer', async () => {
    await installInto(prefix, 'opencode', '1.0.0')
    setLatest('opencode', '0.9.0')
    const { service, agent, ended } = setup()
    await service.detect()
    service.update('opencode')
    await ended('opencode')
    expect(agent('opencode').operation).toMatchObject({
      status: 'failed',
      message: '✕ Update failed: npm finished, but the version is 0.9.0, not newer than 1.0.0',
    })
  })

  it('fails when the agent is found somewhere else afterwards', async () => {
    await installInto(prefix, 'codex', '1.0.0')
    setLatest('codex', '1.2.0')
    // Meanwhile a Codex comes into a folder that comes first on the login shell PATH.
    const elsewhere = path.join(home, '.local', 'bin')
    await writeNodeCommand(
      path.join(elsewhere, 'codex'),
      "require('node:fs').writeSync(1, '3.0.0\\n')\n",
    )
    const aside = path.join(home, '.local', 'aside')
    fs.renameSync(elsewhere, aside)
    npmScript(`
      if (fs.existsSync(${JSON.stringify(aside)})) {
        fs.renameSync(${JSON.stringify(aside)}, ${JSON.stringify(elsewhere)})
      }
    `)
    const { service, agent, ended } = setup()
    await service.detect()
    service.update('codex')
    await ended('codex')
    const codex = commandIn(elsewhere, 'codex')
    expect(agent('codex').operation).toMatchObject({
      status: 'failed',
      message: `✕ Update failed: npm finished, but Codex is now found at ${path.join('~', path.relative(home, codex))}`,
    })
  })

  it("updates an npm installation in another global folder with that folder's npm, first on PATH", async () => {
    const other = path.join(root, 'other-global')
    await writeNodeCommand(path.join(npmCommandsFolder(other), 'npm'), fakeNpm())
    await installInto(other, 'codex', '1.0.0')
    // Found on the login shell PATH, in the folder of the computer's npm's commands.
    await linkCommand(
      path.join(npmPackagesFolder(other), '@openai', 'codex', 'bin', 'codex'),
      npmCommandsFolder(prefix),
      'codex',
    )
    setLatest('codex', '2.1.0')
    const installPath = path.join(root, 'install-path')
    npmScript(`fs.writeFileSync(${JSON.stringify(installPath)}, process.env.PATH + '\\n')`)
    const { service, agent, ended } = setup()
    await service.detect()
    expect(agent('codex').installation).toMatchObject({
      path: commandIn(npmCommandsFolder(prefix), 'codex'),
      method: 'npm',
      version: '1.0.0',
    })
    service.update('codex')
    await ended('codex')
    expect(agent('codex').operation).toMatchObject({
      status: 'succeeded',
      message: '✓ Updated to 2.1.0',
    })
    expect(npmRuns().filter((run) => run.includes(' install '))).toEqual([
      `${path.join(npmCommandsFolder(other), 'npm')} install -g @openai/codex@latest --loglevel=http`,
    ])
    // So that it runs with the node beside it.
    expect(fs.readFileSync(installPath, 'utf8').split(path.delimiter)[0]).toBe(
      npmCommandsFolder(other),
    )
    expect(fs.readdirSync(npmPackagesFolder(prefix))).toEqual([])
  })

  // Homebrew is macOS's.
  it.skipIf(windows)(
    'upgrades only the Homebrew cask or formula an installation comes from',
    async () => {
      const brewPrefix = path.join(root, 'homebrew')
      const brewLog = path.join(root, 'brew.log')
      const claude = (version: string) =>
        path.join(brewPrefix, 'Caskroom', 'claude-code', version, 'claude')
      const opencode = (version: string) =>
        path.join(brewPrefix, 'Cellar', 'opencode', version, 'bin', 'opencode')
      for (const version of ['1.0.0', '2.0.0']) {
        write(claude(version), `#!/bin/sh\necho "${version} (Claude Code)"\n`, 0o755)
        write(opencode(version), `#!/bin/sh\necho "${version}"\n`, 0o755)
      }
      fs.mkdirSync(path.join(prefix, 'bin'), { recursive: true })
      fs.symlinkSync(claude('1.0.0'), path.join(prefix, 'bin', 'claude'))
      fs.symlinkSync(opencode('1.0.0'), path.join(prefix, 'bin', 'opencode'))
      write(
        path.join(brewPrefix, 'bin', 'brew'),
        [
          '#!/bin/sh',
          `echo "$*" >> ${JSON.stringify(brewLog)}`,
          'case "$3" in',
          `  claude-code) ln -sf ${JSON.stringify(claude('2.0.0'))} ${JSON.stringify(path.join(prefix, 'bin', 'claude'))} ;;`,
          `  opencode) ln -sf ${JSON.stringify(opencode('2.0.0'))} ${JSON.stringify(path.join(prefix, 'bin', 'opencode'))} ;;`,
          'esac',
          '',
        ].join('\n'),
        0o755,
      )
      const { service, agent, ended } = setup()
      await service.detect()
      expect(agent('claude').installation?.method).toBe('homebrew')
      expect(agent('opencode').installation?.method).toBe('homebrew')
      service.update('claude')
      service.update('opencode')
      await ended('claude')
      await ended('opencode')
      for (const id of ['claude', 'opencode'] as const) {
        expect(agent(id).operation).toMatchObject({
          status: 'succeeded',
          message: '✓ Updated to 2.0.0',
        })
      }
      expect(fs.readFileSync(brewLog, 'utf8')).toBe(
        'upgrade --cask claude-code\nupgrade --formula opencode\n',
      )
      expect(npmRuns().filter((run) => run.includes(' install '))).toEqual([])
    },
  )

  // On Windows the official installers install programs, which no script can stand in for.
  it.skipIf(windows)("runs the official installer's own update command", async () => {
    const versions = path.join(home, '.local', 'share', 'claude', 'versions')
    write(
      path.join(versions, '1.0.0'),
      `#!/bin/sh\nif [ "$1" = update ]; then echo "$0 $*" >> ${JSON.stringify(path.join(root, 'update.log'))}; ln -sf ${JSON.stringify(path.join(versions, '2.0.0'))} ${JSON.stringify(path.join(prefix, 'bin', 'claude'))}; exit 0; fi\necho "1.0.0 (Claude Code)"\n`,
      0o755,
    )
    write(path.join(versions, '2.0.0'), '#!/bin/sh\necho "2.0.0 (Claude Code)"\n', 0o755)
    fs.mkdirSync(path.join(prefix, 'bin'), { recursive: true })
    fs.symlinkSync(path.join(versions, '1.0.0'), path.join(prefix, 'bin', 'claude'))
    const { service, agent, ended } = setup()
    await service.detect()
    expect(agent('claude').installation?.method).toBe('official')
    service.update('claude')
    await ended('claude')
    expect(agent('claude').operation).toMatchObject({
      status: 'succeeded',
      message: '✓ Updated to 2.0.0',
    })
    expect(fs.readFileSync(path.join(root, 'update.log'), 'utf8')).toBe(
      `${path.join(prefix, 'bin', 'claude')} update\n`,
    )
  })

  // Windows has no permissions on folders that keep the user from creating files.
  it.skipIf(windows)(
    'does not update an npm installation whose global folder the user cannot write to',
    async () => {
      await installInto(prefix, 'codex', '1.0.0')
      const { service, agent, ended } = setup()
      fs.chmodSync(npmCommandsFolder(prefix), 0o555)
      await service.detect()
      service.update('codex')
      await ended('codex')
      expect(agent('codex').operation).toMatchObject({
        status: 'failed',
        message: "✕ Update failed: npm's folder isn't writable",
      })
      expect(npmRuns().filter((run) => run.includes(' install '))).toEqual([])
    },
  )

  // On Windows node is a program, node.exe, which no script can stand in for.
  it.skipIf(windows)(
    'does not update an npm installation when the node on the login shell PATH is too old for the latest version',
    async () => {
      fakeNode('20.19.6')
      await installInto(prefix, 'codex', '1.0.0')
      const { service, agent, ended } = setup({ latestNode: { codex: '>=22.19.0' } })
      await service.detect()
      service.update('codex')
      await ended('codex')
      expect(agent('codex').operation).toMatchObject({
        status: 'failed',
        message: '✕ Update failed: 2.0.0 needs Node.js 22.19.0 or later (yours is 20.19.6)',
      })
      expect(npmRuns().filter((run) => run.includes(' install '))).toEqual([])
    },
  )

  it('does not update an installation it cannot tell the method of', async () => {
    await writeNodeCommand(
      path.join(npmCommandsFolder(prefix), 'codex'),
      "require('node:fs').writeSync(1, 'codex-cli 1.0.0\\n')\n",
    )
    const { service, agent, ended } = setup()
    await service.detect()
    expect(agent('codex').installation?.method).toBe('unknown')
    service.update('codex')
    await ended('codex')
    expect(agent('codex').operation).toMatchObject({
      status: 'failed',
      message:
        '✕ Update failed: Hoot cannot tell how Codex was installed; update it the way you installed it',
    })
    expect(npmRuns().filter((run) => run.includes('install'))).toEqual([])
  })
})

/** A stand-in npm that runs until it is told to go on, or SIGTERM ends it. */
const SLOW_NPM = `
  process.on('SIGTERM', () => {
    npm.say('stopped')
    process.exit(1)
  })
  fs.appendFileSync(path.join(npm.root, 'started.log'), 'started ' + npm.spec + '\\n')
  for (let i = 0; i < 200 && !fs.existsSync(path.join(npm.root, 'go')); i++) await npm.sleep(50)
`

/** The packages the stand-in npm started installing, in order. */
function started(): string[] {
  const log = path.join(root, 'started.log')
  return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []
}

describe('AgentService Update all', () => {
  it('updates every agent that can be updated, one after another, and lets one be cancelled', async () => {
    await installInto(prefix, 'claude', '1.0.0')
    await installInto(prefix, 'codex', '1.0.0')
    setLatest('claude', '2.0.0')
    setLatest('codex', '2.0.0')
    npmScript(SLOW_NPM)
    const { service, agent, ended } = setup()
    await service.detect()
    service.updateAll()
    await vi.waitFor(() => expect(started()).toHaveLength(1), { timeout: 10_000 })
    expect(agent('claude').operation?.status).toBe('running')
    expect(agent('codex').operation).toEqual({ kind: 'update', status: 'waiting' })
    service.cancel('codex')
    expect(agent('codex').operation).toEqual({ kind: 'update', status: 'cancelled' })
    fs.writeFileSync(path.join(root, 'go'), '')
    await ended('claude')
    expect(agent('claude').operation).toMatchObject({ status: 'succeeded' })
    expect(started()).toEqual(['started @anthropic-ai/claude-code'])
  })

  it('leaves out an agent whose install failed, even when a newer version is out', async () => {
    await installInto(prefix, 'claude', '1.0.0')
    setLatest('claude', '2.0.0')
    npmScript(
      `if (npm.spec === '@anthropic-ai/claude-code') { npm.complain('install failed'); return 1 }`,
    )
    const { service, agent, ended } = setup({ latest: { claude: '2.0.0' } })
    await service.detect()
    service.install('claude')
    await ended('claude')
    expect(agent('claude').operation).toMatchObject({ kind: 'install', status: 'failed' })
    service.updateAll()
    expect(agent('claude').operation).toMatchObject({ kind: 'install', status: 'failed' })
  })

  it('leaves out agents with no newer version, no update command or a failed version read', async () => {
    await installInto(prefix, 'claude', '1.0.0')
    await installInto(prefix, 'codex', '1.0.0')
    await writeNodeCommand(
      path.join(npmCommandsFolder(prefix), 'opencode'),
      "require('node:fs').writeSync(1, '1.0.0\\n')\n",
    )
    setLatest('claude', '2.0.0')
    setLatest('codex', '1.0.0')
    setLatest('opencode', '2.0.0')
    npmScript('return 0')
    const { service, agent, ended } = setup({
      latest: { claude: '2.0.0', codex: '1.0.0', opencode: '2.0.0' },
    })
    await service.detect()
    // Codex is up to date; OpenCode was installed where Hoot cannot tell how.
    service.updateAll()
    await ended('claude')
    expect(agent('claude').operation).not.toBeNull()
    expect(agent('codex').operation).toBeNull()
    expect(agent('opencode').operation).toBeNull()
  })
})

describe('AgentService queue and cancelling', () => {
  it('runs one operation at a time, in the order they were asked for', async () => {
    npmScript(SLOW_NPM)
    const { service, agent, ended, states } = setup()
    await service.detect()
    service.install('claude')
    service.install('codex')
    await vi.waitFor(() => expect(started()).toEqual(['started @anthropic-ai/claude-code']), {
      timeout: 10_000,
    })
    expect(agent('claude').operation?.status).toBe('running')
    expect(agent('codex').operation).toEqual({ kind: 'install', status: 'waiting' })
    expect(service.pendingOperations()).toEqual([
      { label: 'Claude Code', kind: 'install', waiting: false },
      { label: 'Codex', kind: 'install', waiting: true },
    ])
    // Asking again changes nothing.
    service.install('claude')
    fs.writeFileSync(path.join(root, 'go'), '')
    await ended('claude')
    await ended('codex')
    expect(started()).toEqual(['started @anthropic-ai/claude-code', 'started @openai/codex'])
    for (const state of states) {
      const running = state.agents.filter((entry) => entry.operation?.status === 'running')
      expect(running.length).toBeLessThanOrEqual(1)
    }
  })

  it('cancels a waiting operation without running it', async () => {
    npmScript(SLOW_NPM)
    const { service, agent, ended } = setup()
    await service.detect()
    service.install('claude')
    service.install('codex')
    service.cancel('codex')
    expect(agent('codex').operation).toEqual({ kind: 'install', status: 'cancelled' })
    fs.writeFileSync(path.join(root, 'go'), '')
    await ended('claude')
    expect(agent('claude').operation?.status).toBe('succeeded')
    expect(started()).toEqual(['started @anthropic-ai/claude-code'])
  })

  it('cancels a running operation with SIGTERM, and starts the next one', async () => {
    npmScript(SLOW_NPM)
    await installInto(prefix, 'claude', '1.0.0')
    setLatest('claude', '2.0.0')
    const { service, agent, ended } = setup()
    await service.detect()
    service.update('claude')
    service.install('codex')
    await vi.waitFor(() => expect(started()).toHaveLength(1), { timeout: 10_000 })
    service.cancel('claude')
    await ended('claude')
    expect(agent('claude').operation).toEqual({ kind: 'update', status: 'cancelled' })
    // Read again afterwards: the version is still the one before.
    expect(agent('claude').installation?.version).toBe('1.0.0')
    await vi.waitFor(() => expect(started()).toHaveLength(2), { timeout: 10_000 })
    fs.writeFileSync(path.join(root, 'go'), '')
    await ended('codex')
  })

  // On Windows SIGTERM ends a process at once: no npm there ends its step first.
  it.skipIf(windows)(
    'sends SIGTERM only once, however often it is cancelled, also when Hoot quits then',
    async () => {
      // Like npm, which ends only once the step under way has, after SIGTERM.
      npmScript(`
        let stopping = false
        process.on('SIGTERM', () => {
          fs.appendFileSync(path.join(npm.root, 'signals.log'), 'TERM\\n')
          stopping = true
        })
        fs.appendFileSync(path.join(npm.root, 'started.log'), 'started ' + npm.spec + '\\n')
        for (let i = 0; i < 200 && !fs.existsSync(path.join(npm.root, 'go')); i++) await npm.sleep(50)
        if (stopping) return 1
      `)
      const { service, agent } = setup()
      await service.detect()
      service.install('claude')
      await vi.waitFor(() => expect(started()).toHaveLength(1), { timeout: 10_000 })
      service.cancel('claude')
      expect(agent('claude').operation).toMatchObject({ status: 'running', cancellable: false })
      service.cancel('claude')
      const stopped = service.stopAll()
      await vi.waitFor(() => expect(fs.existsSync(path.join(root, 'signals.log'))).toBe(true))
      // Still running: it has not ended its step.
      expect(agent('claude').operation?.status).toBe('running')
      fs.writeFileSync(path.join(root, 'go'), '')
      await stopped
      expect(fs.readFileSync(path.join(root, 'signals.log'), 'utf8')).toBe('TERM\n')
      expect(agent('claude').operation).toEqual({ kind: 'install', status: 'cancelled' })
    },
  )

  it('stops every operation for quitting, once the running process has ended', async () => {
    npmScript(SLOW_NPM)
    const { service, agent } = setup()
    await service.detect()
    service.install('claude')
    service.install('codex')
    await vi.waitFor(() => expect(started()).toHaveLength(1), { timeout: 10_000 })
    await service.stopAll()
    expect(agent('codex').operation).toEqual({ kind: 'install', status: 'cancelled' })
    await vi.waitFor(() => expect(agent('claude').operation?.status).toBe('cancelled'))
    expect(npmRuns().filter((run) => run.includes('codex'))).toEqual([])
    expect(service.pendingOperations()).toEqual([])
    expect(started()).toHaveLength(1)
  })

  it('runs nothing asked for once it stops every operation for quitting, until it resumes', async () => {
    npmScript(SLOW_NPM)
    const { service, agent, ended } = setup()
    await service.detect()
    service.install('claude')
    await vi.waitFor(() => expect(started()).toHaveLength(1), { timeout: 10_000 })
    const stopping = service.stopAll()
    // Asked for while Hoot waits for the running one to end, and after.
    service.install('codex')
    expect(agent('codex').operation).toEqual({ kind: 'install', status: 'cancelled' })
    await stopping
    service.install('opencode')
    expect(agent('opencode').operation).toEqual({ kind: 'install', status: 'cancelled' })
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(service.pendingOperations()).toEqual([])
    expect(started()).toEqual(['started @anthropic-ai/claude-code'])
    expect(npmRuns().filter((run) => / -g (@openai|@opencode)/.test(run))).toEqual([])

    // Hoot keeps running after all, as when restarting into an update fails.
    service.resume()
    fs.writeFileSync(path.join(root, 'go'), '')
    service.install('codex')
    await ended('codex')
    expect(agent('codex').operation).toEqual({
      kind: 'install',
      status: 'succeeded',
      message: '✓ Installed 2.0.0',
    })
  })

  it('keeps the result of a command that has ended, cancelled while the agent is read again', async () => {
    const { service, agent, ended, reads, hold, release } = heldSetup()
    await service.detect()
    hold()
    const before = reads()
    service.install('claude')
    // Once npm has ended, the agent is read again, which waits.
    await vi.waitFor(() => expect(reads()).toBe(before + 1), { timeout: 10_000 })
    expect(agent('claude').operation).toMatchObject({ status: 'running', cancellable: false })
    service.cancel('claude')
    release()
    await ended('claude')
    expect(agent('claude').operation).toEqual({
      kind: 'install',
      status: 'succeeded',
      message: '✓ Installed 2.0.0',
    })
  })

  it('waits for the result of a command that has ended, for quitting, and leaves nothing pending', async () => {
    const { service, agent, reads, hold, release } = heldSetup()
    await service.detect()
    hold()
    const before = reads()
    service.install('claude')
    service.install('codex')
    await vi.waitFor(() => expect(reads()).toBe(before + 1), { timeout: 10_000 })
    let stopped = false
    const stopping = service.stopAll().then(() => {
      stopped = true
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(stopped).toBe(false)
    release()
    await stopping
    expect(agent('claude').operation).toMatchObject({ status: 'succeeded' })
    expect(agent('codex').operation).toEqual({ kind: 'install', status: 'cancelled' })
    expect(service.pendingOperations()).toEqual([])
    expect(npmRuns().filter((run) => run.includes('codex'))).toEqual([])
  })
})

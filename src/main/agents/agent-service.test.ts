import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentsState } from '../../shared/agents'
import type { CodingToolId } from '../../shared/tools'
import { ToolService } from '../tools/tool-service'
import { agentPaths } from './agent-paths'
import { AgentService } from './agent-service'

/**
 * A stand-in npm. `prefix -g` says its global folder; `install -g
 * <package>@latest` (with `--prefix`, into that folder instead) installs a
 * stand-in of the package, whose command reports the version in
 * `latest-<command>`. A test can add to what it does in `npm-script`, which it
 * runs first; it logs how it was run in `npm.log`.
 */
const FAKE_NPM = `#!/bin/sh
root=__ROOT__
echo "$0 $*" >> "$root/npm.log"
prefix="$(cd "$(dirname "$0")/.." && pwd -P)"
spec=
while [ $# -gt 0 ]; do
  case "$1" in
    prefix) echo "$prefix"; exit 0 ;;
    --prefix) prefix="$2"; shift ;;
    *@latest) spec="\${1%@latest}" ;;
  esac
  shift
done
[ -f "$root/npm-script" ] && . "$root/npm-script"
case "$spec" in
  @anthropic-ai/claude-code) command=claude ;;
  @openai/codex) command=codex ;;
  @opencode/cli) command=opencode ;;
  *) echo "npm error code E404" >&2; exit 1 ;;
esac
version="$(cat "$root/latest-$command")"
mkdir -p "$prefix/lib/node_modules/$spec/bin" "$prefix/bin"
printf '#!/bin/sh\\necho "%s (stand-in)"\\n' "$version" > "$prefix/lib/node_modules/$spec/bin/$command"
chmod 755 "$prefix/lib/node_modules/$spec/bin/$command"
ln -sf "../lib/node_modules/$spec/bin/$command" "$prefix/bin/$command"
echo "added 1 package"
`

/** The stand-in of the npm that comes with Hoot, which Hoot's executable runs as Node.js. */
const FAKE_HOOT_NPM = `const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
fs.appendFileSync(
  __ROOT__ + '/hoot-npm.log',
  JSON.stringify({
    args: process.argv.slice(2),
    runAsNode: process.env.ELECTRON_RUN_AS_NODE,
    hootNode: process.env.HOOT_NODE,
    path: process.env.PATH,
  }) + '\\n',
)
const result = spawnSync('/bin/sh', [__ROOT__ + '/fake-npm', ...process.argv.slice(2)], {
  stdio: 'inherit',
})
process.exit(result.status ?? 1)
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

/** Installs a stand-in of an agent at a version into a global folder, as npm does. */
function installInto(folder: string, id: CodingToolId, version: string): void {
  const command = path.join(folder, 'lib', 'node_modules', PACKAGES[id], 'bin', id)
  write(command, `#!/bin/sh\necho "${version} (stand-in)"\n`, 0o755)
  fs.mkdirSync(path.join(folder, 'bin'), { recursive: true })
  fs.rmSync(path.join(folder, 'bin', id), { force: true })
  fs.symlinkSync(command, path.join(folder, 'bin', id))
}

function setLatest(id: CodingToolId, version: string): void {
  fs.writeFileSync(path.join(root, `latest-${id}`), version)
}

function npmRuns(): string[] {
  const log = path.join(root, 'npm.log')
  return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []
}

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-agents-')))
  home = path.join(root, 'home')
  prefix = path.join(root, 'npm-global')
  fs.mkdirSync(home)
  const npm = FAKE_NPM.replace('__ROOT__', JSON.stringify(root))
  write(path.join(root, 'fake-npm'), npm, 0o755)
  write(path.join(prefix, 'bin', 'npm'), npm, 0o755)
  fs.mkdirSync(path.join(prefix, 'lib', 'node_modules'), { recursive: true })
  write(path.join(root, 'npm-cli.cjs'), FAKE_HOOT_NPM.replaceAll('__ROOT__', JSON.stringify(root)))
  for (const id of ['claude', 'codex', 'opencode'] as const) setLatest(id, '2.0.0')
})

afterEach(() => {
  fs.chmodSync(path.join(prefix, 'lib', 'node_modules'), 0o755)
  fs.chmodSync(path.join(prefix, 'bin'), 0o755)
  fs.rmSync(root, { recursive: true, force: true })
})

function setup(
  options: {
    /** Whether the computer's npm is on the login shell PATH. */
    withNpm?: boolean
    latest?: Partial<Record<CodingToolId, string | null>>
    sessions?: () => string[]
    /** Runs each time the login shell environment is read, before it is. */
    beforeLoginEnvironment?: () => Promise<void>
  } = {},
) {
  const paths = agentPaths({
    home,
    packaged: false,
    resourcesPath: '/nowhere',
    appPath: root,
    executable: process.execPath,
  })
  paths.npmCli = path.join(root, 'npm-cli.cjs')
  const loginPath = [
    ...(options.withNpm === false ? [] : [path.join(prefix, 'bin')]),
    '/usr/bin',
    '/bin',
  ].join(':')
  const tools = new ToolService({
    shell: '/bin/zsh',
    baseEnv: {},
    cwd: home,
    agentsBinDirectory: paths.binDirectory,
    resolveEnv: async () => {
      await options.beforeLoginEnvironment?.()
      return { PATH: loginPath, HOME: home }
    },
  })
  const latestCalls: string[] = []
  const service = new AgentService({
    detectTools: () => tools.detectWithEnvironment(),
    getLoginEnvironment: () => tools.getLoginEnvironment(),
    paths,
    home,
    latestVersion: async (npmPackage) => {
      latestCalls.push(npmPackage)
      const id = (Object.keys(PACKAGES) as CodingToolId[]).find(
        (key) => PACKAGES[key] === npmPackage,
      )
      const latest = id ? options.latest?.[id] : undefined
      return latest === undefined ? '2.0.0' : latest
    },
    runningSessions: () => options.sessions?.() ?? [],
  })
  const states: AgentsState[] = []
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
  return { service, paths, tools, states, agent, ended, latestCalls }
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
    installInto(prefix, 'claude', '1.0.0')
    const { service, paths, agent, latestCalls } = setup({ latest: { claude: '1.5.0' } })
    installInto(paths.directory, 'codex', '2.0.0')
    expect(agent('claude').checking).toBe(true)
    await service.detect()

    expect(agent('claude')).toMatchObject({
      checking: false,
      installation: {
        path: path.join(prefix, 'bin', 'claude'),
        method: 'npm',
        version: '1.0.0',
      },
      latest: '1.5.0',
      latestFailed: false,
      operation: null,
    })
    expect(agent('codex').installation).toMatchObject({
      path: path.join(paths.binDirectory, 'codex'),
      displayPath: '~/.hoot/agents/bin/codex',
      method: 'hoot',
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

  it("installs into Hoot's folder when the user cannot create files in npm's global folder", async () => {
    const { service } = setup()
    fs.chmodSync(path.join(prefix, 'lib', 'node_modules'), 0o555)
    await service.detect()
    expect(service.getState().installTarget).toEqual({
      kind: 'hoot',
      directory: path.join(home, '.hoot', 'agents'),
      displayDirectory: '~/.hoot/agents',
    })
  })

  it("installs into Hoot's folder when the login shell PATH has no npm", async () => {
    const { service } = setup({ withNpm: false })
    await service.detect()
    expect(service.getState().installTarget?.kind).toBe('hoot')
  })

  it('tells an installation that does not run, and keeps what it wrote', async () => {
    write(
      path.join(prefix, 'bin', 'opencode'),
      '#!/bin/sh\necho "env: node: not found" >&2\nexit 127\n',
      0o755,
    )
    const { service, agent } = setup()
    await service.detect()
    expect(agent('opencode').installation).toMatchObject({ method: 'unknown', version: null })
    expect(agent('opencode').installation?.versionOutput).toBe(
      'env: node: not found\nIt exited with code 127.',
    )
  })

  it('says when the latest version could not be read', async () => {
    installInto(prefix, 'claude', '1.0.0')
    const { service, agent } = setup({ latest: { claude: null } })
    await service.detect()
    expect(agent('claude')).toMatchObject({ latest: null, latestFailed: true })
  })

  it('reads everything again, after a detection under way, for a call made meanwhile', async () => {
    const { service, agent } = setup()
    const first = service.detect()
    installInto(prefix, 'opencode', '2.0.0')
    const second = service.detect()
    expect(service.detect()).toBe(second)
    await Promise.all([first, second])
    expect(agent('opencode').installation?.version).toBe('2.0.0')
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
      path: path.join(prefix, 'bin', 'claude'),
      method: 'npm',
      version: '2.1.0',
    })
    expect(npmRuns()).toContain(
      `${path.join(prefix, 'bin', 'npm')} install -g @anthropic-ai/claude-code@latest --loglevel=http`,
    )
    // The new session menu has it at once.
    expect(tools.getState().tools.find((tool) => tool.id === 'claude')?.available).toBe(true)
  })

  it("installs with Hoot's npm into Hoot's folder when the computer has no npm", async () => {
    const { service, paths, agent, ended } = setup({ withNpm: false })
    await service.detect()
    service.install('codex')
    await ended('codex')
    expect(agent('codex').operation).toMatchObject({
      status: 'succeeded',
      message: '✓ Installed 2.0.0',
    })
    expect(agent('codex').installation).toMatchObject({
      path: path.join(paths.binDirectory, 'codex'),
      method: 'hoot',
    })
    expect(
      fs.existsSync(path.join(paths.directory, 'lib', 'node_modules', '@openai', 'codex')),
    ).toBe(true)
    const [run] = fs
      .readFileSync(path.join(root, 'hoot-npm.log'), 'utf8')
      .trim()
      .split('\n')
      .map(
        (line) =>
          JSON.parse(line) as { args: string[]; runAsNode: string; hootNode: string; path: string },
      )
    expect(run?.args).toEqual([
      'install',
      '-g',
      '--prefix',
      paths.directory,
      '@openai/codex@latest',
      '--loglevel=http',
    ])
    expect(run?.runAsNode).toBe('1')
    expect(run?.hootNode).toBe(process.execPath)
    expect(run?.path).toBe(`/usr/bin:/bin:${paths.nodeDirectory}:${paths.binDirectory}`)
    // Nothing went into the computer's global folder.
    expect(fs.readdirSync(path.join(prefix, 'lib', 'node_modules'))).toEqual([])
  })

  it('fails when npm fails, with the last lines of what it wrote and all of it', async () => {
    write(
      path.join(root, 'npm-script'),
      'for i in 1 2 3 4 5 6; do echo "line $i"; done\necho "npm error code E404" >&2\nexit 1\n',
    )
    const { service, agent, ended } = setup()
    await service.detect()
    service.install('opencode')
    await ended('opencode')
    expect(agent('opencode').operation).toEqual({
      kind: 'install',
      status: 'failed',
      message: '✕ Install failed: npm exited with code 1',
      tail: ['line 3', 'line 4', 'line 5', 'line 6', 'npm error code E404'],
      output: 'line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nnpm error code E404',
    })
    expect(agent('opencode').installation).toBeNull()
  })

  it('fails when npm succeeds but the agent does not run afterwards', async () => {
    write(
      path.join(root, 'npm-script'),
      [
        'mkdir -p "$prefix/lib/node_modules/@opencode/cli/bin" "$prefix/bin"',
        `printf '#!/bin/sh\\nexit 1\\n' > "$prefix/lib/node_modules/@opencode/cli/bin/opencode"`,
        'chmod 755 "$prefix/lib/node_modules/@opencode/cli/bin/opencode"',
        'ln -sf ../lib/node_modules/@opencode/cli/bin/opencode "$prefix/bin/opencode"',
        'exit 0',
        '',
      ].join('\n'),
    )
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
    write(path.join(root, 'npm-script'), 'exit 0\n')
    const { service, agent, ended } = setup()
    await service.detect()
    service.install('codex')
    await ended('codex')
    expect(agent('codex').operation).toMatchObject({
      status: 'failed',
      message: '✕ Install failed: npm finished, but Codex is not found',
    })
  })

  it('shows the last line of what the command writes while it runs', async () => {
    write(
      path.join(root, 'npm-script'),
      'printf "\\033[32mfetching\\033[0m ⠋"\nprintf "\\rfetching ⠙"\nsleep 1\n',
    )
    const { service, agent, ended } = setup()
    await service.detect()
    service.install('claude')
    await vi.waitFor(
      () => expect(agent('claude').operation).toMatchObject({ lastLine: 'fetching ⠙' }),
      {
        timeout: 5_000,
      },
    )
    expect(agent('claude').operation?.status).toBe('running')
    await ended('claude')
  })
})

describe('AgentService updates', () => {
  it('updates an npm installation in its global folder, and counts the sessions still on the old version', async () => {
    installInto(prefix, 'claude', '1.0.0')
    setLatest('claude', '2.1.0')
    let sessions = ['s1', 's2', 's3']
    const { service, paths, agent, ended } = setup({ sessions: () => sessions })
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
      `${path.join(prefix, 'bin', 'npm')} install -g @anthropic-ai/claude-code@latest --loglevel=http`,
    ])
    expect(fs.existsSync(paths.directory)).toBe(false)
  })

  it("updates the installation in Hoot's folder with Hoot's npm", async () => {
    const { service, paths, agent, ended } = setup()
    installInto(paths.directory, 'codex', '1.0.0')
    setLatest('codex', '1.2.0')
    await service.detect()
    service.update('codex')
    await ended('codex')
    expect(agent('codex').operation).toMatchObject({
      status: 'succeeded',
      message: '✓ Updated to 1.2.0',
    })
    expect(fs.readFileSync(path.join(root, 'hoot-npm.log'), 'utf8')).toContain('--prefix')
    expect(fs.existsSync(path.join(prefix, 'lib', 'node_modules', '@openai'))).toBe(false)
  })

  it('fails when the version did not change', async () => {
    installInto(prefix, 'opencode', '1.0.0')
    write(path.join(root, 'npm-script'), 'echo "up to date"\nexit 0\n')
    const { service, agent, ended } = setup()
    await service.detect()
    service.update('opencode')
    await ended('opencode')
    expect(agent('opencode').operation).toMatchObject({
      status: 'failed',
      message: '✕ Update failed: npm finished, but the version is still 1.0.0',
      output: 'up to date',
    })
  })

  it('fails when the version afterwards is not newer', async () => {
    installInto(prefix, 'opencode', '1.0.0')
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
    const { service, paths, agent, ended } = setup()
    installInto(paths.directory, 'codex', '1.0.0')
    setLatest('codex', '1.2.0')
    // Meanwhile a Codex comes on the login shell PATH, which comes first.
    const elsewhere = path.join(prefix, 'bin', 'codex')
    write(
      path.join(root, 'npm-script'),
      `printf '#!/bin/sh\\necho 3.0.0\\n' > ${JSON.stringify(elsewhere)}\nchmod 755 ${JSON.stringify(elsewhere)}\n`,
    )
    await service.detect()
    service.update('codex')
    await ended('codex')
    expect(agent('codex').operation).toMatchObject({
      status: 'failed',
      message: `✕ Update failed: npm finished, but Codex is now found at ${elsewhere}`,
    })
  })

  it("updates an npm installation in another global folder with that folder's npm, first on PATH", async () => {
    const other = path.join(root, 'other-global')
    write(path.join(other, 'bin', 'npm'), FAKE_NPM.replace('__ROOT__', JSON.stringify(root)), 0o755)
    installInto(other, 'codex', '1.0.0')
    // Found on the login shell PATH, in the folder of the computer's npm's commands.
    fs.mkdirSync(path.join(prefix, 'bin'), { recursive: true })
    fs.symlinkSync(
      path.join(other, 'lib', 'node_modules', '@openai', 'codex', 'bin', 'codex'),
      path.join(prefix, 'bin', 'codex'),
    )
    setLatest('codex', '2.1.0')
    const installPath = path.join(root, 'install-path')
    write(path.join(root, 'npm-script'), `echo "$PATH" > ${JSON.stringify(installPath)}\n`)
    const { service, agent, ended } = setup()
    await service.detect()
    expect(agent('codex').installation).toMatchObject({
      path: path.join(prefix, 'bin', 'codex'),
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
      `${path.join(other, 'bin', 'npm')} install -g @openai/codex@latest --loglevel=http`,
    ])
    // So that it runs with the node beside it.
    expect(fs.readFileSync(installPath, 'utf8').split(':')[0]).toBe(path.join(other, 'bin'))
    expect(fs.readdirSync(path.join(prefix, 'lib', 'node_modules'))).toEqual([])
  })

  it('upgrades only the Homebrew cask or formula an installation comes from', async () => {
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
  })

  it("runs the official installer's own update command", async () => {
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

  it('does not update an installation it cannot tell the method of', async () => {
    write(path.join(prefix, 'bin', 'codex'), '#!/bin/sh\necho "codex-cli 1.0.0"\n', 0o755)
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
const SLOW_NPM = [
  `trap 'echo "stopped"; exit 1' TERM`,
  'echo "started $spec" >> "$root/started.log"',
  'i=0',
  'while [ $i -lt 200 ] && [ ! -f "$root/go" ]; do sleep 0.05; i=$((i+1)); done',
  '',
].join('\n')

/** The packages the stand-in npm started installing, in order. */
function started(): string[] {
  const log = path.join(root, 'started.log')
  return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []
}

describe('AgentService queue and cancelling', () => {
  it('runs one operation at a time, in the order they were asked for', async () => {
    write(path.join(root, 'npm-script'), SLOW_NPM)
    const { service, agent, ended, states } = setup()
    await service.detect()
    service.install('claude')
    service.install('codex')
    await vi.waitFor(() => expect(started()).toEqual(['started @anthropic-ai/claude-code']))
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
    write(path.join(root, 'npm-script'), SLOW_NPM)
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
    write(path.join(root, 'npm-script'), SLOW_NPM)
    installInto(prefix, 'claude', '1.0.0')
    setLatest('claude', '2.0.0')
    const { service, agent, ended } = setup()
    await service.detect()
    service.update('claude')
    service.install('codex')
    await vi.waitFor(() => expect(started()).toHaveLength(1))
    service.cancel('claude')
    await ended('claude')
    expect(agent('claude').operation).toEqual({ kind: 'update', status: 'cancelled' })
    // Read again afterwards: the version is still the one before.
    expect(agent('claude').installation?.version).toBe('1.0.0')
    await vi.waitFor(() => expect(started()).toHaveLength(2))
    fs.writeFileSync(path.join(root, 'go'), '')
    await ended('codex')
  })

  it('sends SIGTERM only once, however often it is cancelled, also when Hoot quits then', async () => {
    // Like npm, which ends only once the step under way has, after SIGTERM.
    write(
      path.join(root, 'npm-script'),
      [
        `trap 'echo TERM >> "$root/signals.log"; stopping=1' TERM`,
        'echo "started $spec" >> "$root/started.log"',
        'stopping=',
        'i=0',
        'while [ $i -lt 200 ] && [ ! -f "$root/go" ]; do sleep 0.05; i=$((i+1)); done',
        '[ -n "$stopping" ] && exit 1',
        '',
      ].join('\n'),
    )
    const { service, agent } = setup()
    await service.detect()
    service.install('claude')
    await vi.waitFor(() => expect(started()).toHaveLength(1))
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
  })

  it('stops every operation for quitting, once the running process has ended', async () => {
    write(path.join(root, 'npm-script'), SLOW_NPM)
    const { service, agent } = setup()
    await service.detect()
    service.install('claude')
    service.install('codex')
    await vi.waitFor(() => expect(started()).toHaveLength(1))
    await service.stopAll()
    expect(agent('codex').operation).toEqual({ kind: 'install', status: 'cancelled' })
    await vi.waitFor(() => expect(agent('claude').operation?.status).toBe('cancelled'))
    expect(npmRuns().filter((run) => run.includes('codex'))).toEqual([])
    expect(service.pendingOperations()).toEqual([])
    expect(started()).toHaveLength(1)
  })

  it('runs nothing asked for once it stops every operation for quitting, until it resumes', async () => {
    write(path.join(root, 'npm-script'), SLOW_NPM)
    const { service, agent, ended } = setup()
    await service.detect()
    service.install('claude')
    await vi.waitFor(() => expect(started()).toHaveLength(1))
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
    await vi.waitFor(() => expect(reads()).toBe(before + 1))
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
    await vi.waitFor(() => expect(reads()).toBe(before + 1))
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

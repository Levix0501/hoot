import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ToolsState } from '../../shared/ipc'
import { toolStatus } from '../../shared/tool-status'
import { getTool, type ToolId } from '../../shared/tools'
import { samePath } from '../agents/agent-paths'
import type { resolveLoginShellEnv } from '../env/login-shell-env'
import { removeTestFolder } from '../test-support'
import { onPath, writeNodeCommand } from './test-support'
import { ToolService } from './tool-service'

let bin: string
/** The stand-in of the command, as a lookup finds it. */
let claude: string

beforeAll(async () => {
  bin = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-tools-')))
  claude = await writeNodeCommand(path.join(bin, 'claude'), '')
})

afterAll(async () => {
  await removeTestFolder(bin)
})

const availability = (state: ToolsState) =>
  Object.fromEntries(state.tools.map((tool) => [tool.id, tool.available]))

/**
 * Whether a lookup found a stand-in command, whose extension it spells on
 * Windows as PATHEXT does.
 */
const isCommand = (command: string) => (found: string | null | undefined) =>
  typeof found === 'string' && samePath(found, command)

// The tests that give `resolveEnv` run the service as outside Windows, where
// it reads the login shell environment; on Windows it takes the environment
// Hoot started with instead (see the test of Windows).
describe('ToolService', () => {
  it('checks each tool against the login shell PATH; Terminal is always available', async () => {
    const service = new ToolService({
      shell: '/bin/zsh',
      baseEnv: { PATH: '/usr/bin' },
      cwd: '/',
      resolveEnv: async () => ({ PATH: onPath(bin, '/usr/bin') }),
      platform: 'darwin',
    })
    const state = await service.detect()
    expect(availability(state)).toEqual({
      claude: true,
      codex: false,
      opencode: false,
      antigravity: false,
      shell: true,
    })
    expect(state.tools.find((tool) => tool.id === 'claude')?.path).toSatisfy(isCommand(claude))
    expect(state.error).toBeNull()
    expect((await service.getLoginEnvironment()).env.PATH).toBe(onPath(bin, '/usr/bin'))
  })

  it('reads the version each agent it finds reports, which tells one too old for Hoot', async () => {
    const folder = path.join(bin, 'versions')
    await writeNodeCommand(
      path.join(folder, 'codex'),
      "if (process.argv.includes('--version')) console.log('codex-cli 0.162.1')\n",
    )
    const service = new ToolService({
      shell: '/bin/zsh',
      baseEnv: {},
      cwd: '/',
      resolveEnv: async () => ({ PATH: onPath(folder, bin, '/usr/bin') }),
      platform: 'darwin',
    })
    const { state, versions } = await service.detectWithEnvironment()
    const versionOf = (id: ToolId) => state.tools.find((tool) => tool.id === id)?.version
    expect(versionOf('codex')).toBe('0.162.1')
    expect(versions.get('codex')).toMatchObject({ version: '0.162.1', exitCode: 0 })
    expect(toolStatus(state, getTool('codex'))).toBe('outdated')
    // The stand-in of Claude Code says none: it may run all the same.
    expect(versionOf('claude')).toBeNull()
    expect(toolStatus(state, getTool('claude'))).toBe('available')
    expect(versionOf('opencode')).toBeNull()
    expect(versionOf('shell')).toBeNull()
  })

  it("gives the login shell environment it reads without waiting for the agents' versions", async () => {
    const folder = path.join(bin, 'slow')
    const gate = path.join(folder, 'gate')
    // A stand-in of OpenCode that says its version only once the test lets it.
    await writeNodeCommand(
      path.join(folder, 'opencode'),
      `const fs = require('node:fs')
const wait = () => (fs.existsSync(${JSON.stringify(gate)}) ? console.log('opencode v2.4.2') : setTimeout(wait, 20))
wait()
`,
    )
    const service = new ToolService({
      shell: '/bin/zsh',
      baseEnv: {},
      cwd: '/',
      resolveEnv: async () => ({ PATH: onPath(folder, '/usr/bin') }),
      platform: 'darwin',
    })
    const detection = service.detectWithEnvironment()
    expect((await service.getLoginEnvironment()).env.PATH).toBe(onPath(folder, '/usr/bin'))
    fs.writeFileSync(gate, '')
    const { state } = await detection
    expect(state.tools.find((tool) => tool.id === 'opencode')?.version).toBe('2.4.2')
  })

  it('reads the login shell environment again on every detection', async () => {
    let calls = 0
    const service = new ToolService({
      shell: '/bin/zsh',
      baseEnv: {},
      cwd: '/',
      resolveEnv: async () => {
        calls += 1
        return { PATH: calls === 1 ? '/usr/bin' : bin }
      },
      platform: 'darwin',
    })
    expect(availability(await service.detect()).claude).toBe(false)
    expect(availability(await service.detect()).claude).toBe(true)
  })

  it('falls back to the base environment and reports the problem', async () => {
    const changes: ToolsState[] = []
    const service = new ToolService({
      shell: '/bin/zsh',
      baseEnv: { PATH: bin },
      cwd: '/',
      resolveEnv: async () => {
        throw new Error('Timed out')
      },
      platform: 'darwin',
    })
    service.on('changed', (state) => changes.push(state))
    const state = await service.detect()
    expect(state.error).toMatch(/login shell environment.*Timed out/)
    expect(availability(state).claude).toBe(true)
    expect(changes.map((change) => change.detecting)).toEqual([true, false])
  })

  it('takes the environment Hoot started with on Windows, without starting a shell', async () => {
    // What Git Bash's login shell would give.
    const resolveEnv = vi.fn<typeof resolveLoginShellEnv>(async () => ({
      PATH: '/c/Users/me/bin:/mingw64/bin:/usr/bin',
    }))
    const baseEnv = { Path: 'C:\\Users\\me\\AppData\\Roaming\\npm;C:\\Windows\\system32' }
    const service = new ToolService({
      shell: 'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
      baseEnv,
      cwd: 'C:\\Users\\me',
      resolveEnv,
      platform: 'win32',
    })
    expect((await service.detect()).error).toBeNull()
    expect(await service.getLoginEnvironment()).toEqual({ env: baseEnv, error: null })
    expect(resolveEnv).not.toHaveBeenCalled()
  })

  it('starts another detection after the running one for every call made meanwhile', async () => {
    let calls = 0
    const releases: Array<() => void> = []
    const service = new ToolService({
      shell: '/bin/zsh',
      baseEnv: {},
      cwd: '/',
      resolveEnv: async () => {
        calls += 1
        const call = calls
        await new Promise<void>((resolve) => releases.push(resolve))
        return { PATH: call === 1 ? '/usr/bin' : bin }
      },
      platform: 'darwin',
    })
    const first = service.detectWithEnvironment()
    const second = service.detectWithEnvironment()
    const third = service.detect()
    await vi.waitFor(() => expect(releases).toHaveLength(1))
    releases[0]?.()
    expect(availability((await first).state).claude).toBe(false)
    await vi.waitFor(() => expect(releases).toHaveLength(2))
    releases[1]?.()
    const next = await second
    expect(availability(next.state).claude).toBe(true)
    expect(next.login.env.PATH).toBe(bin)
    expect(await third).toEqual(next.state)
    expect(calls).toBe(2)
  })
})

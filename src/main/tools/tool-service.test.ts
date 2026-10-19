import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ToolsState } from '../../shared/ipc'
import { samePath } from '../agents/agent-paths'
import type { resolveLoginShellEnv } from '../env/login-shell-env'
import { onPath, writeNodeCommand } from './test-support'
import { ToolService } from './tool-service'

let bin: string
/** The stand-in of the command, as a lookup finds it. */
let claude: string

beforeAll(async () => {
  bin = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-tools-')))
  claude = await writeNodeCommand(path.join(bin, 'claude'), '')
})

afterAll(() => {
  fs.rmSync(bin, { recursive: true, force: true })
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
  it('checks each tool against the login shell PATH; Shell is always available', async () => {
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
      shell: true,
    })
    expect(state.tools.find((tool) => tool.id === 'claude')?.path).toSatisfy(isCommand(claude))
    expect(state.error).toBeNull()
    expect((await service.getLoginEnvironment()).env.PATH).toBe(onPath(bin, '/usr/bin'))
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

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ToolsState } from '../../shared/ipc'
import { ToolService } from './tool-service'

let bin: string
let agentsBin: string

beforeAll(() => {
  bin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-tools-')))
  fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\n', { mode: 0o755 })
  agentsBin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-agents-bin-')))
  for (const command of ['claude', 'codex']) {
    fs.writeFileSync(path.join(agentsBin, command), '#!/bin/sh\n', { mode: 0o755 })
  }
})

afterAll(() => {
  fs.rmSync(bin, { recursive: true, force: true })
  fs.rmSync(agentsBin, { recursive: true, force: true })
})

const availability = (state: ToolsState) =>
  Object.fromEntries(state.tools.map((tool) => [tool.id, tool.available]))

describe('ToolService', () => {
  it('checks each tool against the login shell PATH; Shell is always available', async () => {
    const service = new ToolService({
      shell: '/bin/zsh',
      baseEnv: { PATH: '/usr/bin' },
      cwd: '/',
      resolveEnv: async () => ({ PATH: `${bin}:/usr/bin` }),
    })
    const state = await service.detect()
    expect(availability(state)).toEqual({
      claude: true,
      codex: false,
      opencode: false,
      shell: true,
    })
    expect(state.tools.find((tool) => tool.id === 'claude')?.path).toBe(path.join(bin, 'claude'))
    expect(state.error).toBeNull()
    expect((await service.getLoginEnvironment()).env.PATH).toBe(`${bin}:/usr/bin`)
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
    })
    service.on('changed', (state) => changes.push(state))
    const state = await service.detect()
    expect(state.error).toMatch(/login shell environment.*Timed out/)
    expect(availability(state).claude).toBe(true)
    expect(changes.map((change) => change.detecting)).toEqual([true, false])
  })

  it('looks for a coding tool missing from PATH in the folder of agents', async () => {
    const service = new ToolService({
      shell: '/bin/zsh',
      baseEnv: {},
      cwd: '/',
      agentsBinDirectory: agentsBin,
      resolveEnv: async () => ({ PATH: `${bin}:/usr/bin` }),
    })
    const state = await service.detect()
    expect(availability(state)).toEqual({
      claude: true,
      codex: true,
      opencode: false,
      shell: true,
    })
    const pathOf = (id: string) => state.tools.find((tool) => tool.id === id)?.path
    // The one on PATH comes first.
    expect(pathOf('claude')).toBe(path.join(bin, 'claude'))
    expect(pathOf('codex')).toBe(path.join(agentsBin, 'codex'))
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

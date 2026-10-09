import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ToolsState } from '../../shared/ipc'
import { ToolService } from './tool-service'

let bin: string

beforeAll(() => {
  bin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-tools-')))
  fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\n', { mode: 0o755 })
})

afterAll(() => fs.rmSync(bin, { recursive: true, force: true }))

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
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  permissionLevelOrDefault,
  type PermissionLevelSettings,
} from '../../shared/permission-levels'
import type { LoginEnvironment } from '../tools/tool-service'
import { resolveLaunch, type LaunchContext } from './launch'
import { SessionError } from './session-manager'

let root: string
let project: string
let bin: string

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-launch-')))
  project = path.join(root, 'project')
  bin = path.join(root, 'bin')
  fs.mkdirSync(project)
  fs.mkdirSync(bin)
  for (const command of ['claude', 'codex']) {
    fs.writeFileSync(path.join(bin, command), '#!/bin/sh\n', { mode: 0o755 })
  }
})

afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

const highest: PermissionLevelSettings = {
  claude: 'bypass-permissions',
  codex: 'full-access',
  opencode: 'auto-approve',
}

function context(
  loginEnv: Record<string, string>,
  levels: PermissionLevelSettings = highest,
): LaunchContext {
  return {
    shell: '/bin/zsh',
    baseEnv: { HOME: '/home/me', PATH: '/usr/bin:/bin', SHELL: '/bin/zsh' },
    terminal: () => ({ appVersion: '0.1.0', fallbackLang: 'C.UTF-8' }),
    getLoginEnvironment: async () => ({ env: loginEnv, error: null }),
    permissionLevel: (tool) => permissionLevelOrDefault(tool, levels[tool]),
  }
}

describe('resolveLaunch', () => {
  it('runs the default shell as a login shell from the base environment', async () => {
    const launch = await resolveLaunch(context({ PATH: `${bin}:/usr/bin` }), 'shell', project)
    expect(launch.file).toBe('/bin/zsh')
    expect(launch.args).toEqual(['-l'])
    expect(launch.env).toMatchObject({ HOME: '/home/me', PATH: '/usr/bin:/bin', PWD: project })
    expect(launch.env.TERM).toBe('xterm-256color')
  })

  it('runs a tool command with its permission level arguments in the login shell environment', async () => {
    const loginEnv = { PATH: `${bin}:/usr/bin`, FROM_RC: 'yes', SHLVL: '1', _: '/usr/bin/env' }
    const launch = await resolveLaunch(context(loginEnv), 'codex', project)
    expect(launch.file).toBe('codex')
    expect(launch.args).toEqual(['--dangerously-bypass-approvals-and-sandbox'])
    expect(launch.env).toMatchObject({ PATH: `${bin}:/usr/bin`, FROM_RC: 'yes', PWD: project })
    expect(launch.env).not.toHaveProperty('SHLVL')
    expect(launch.env).not.toHaveProperty('_')
  })

  it('uses the selected permission level of the tool, and none for the shell', async () => {
    const levels = { claude: 'plan', codex: 'read-only', opencode: 'standard' }
    const loginEnv = { PATH: `${bin}:/usr/bin` }
    expect((await resolveLaunch(context(loginEnv, levels), 'claude', project)).args).toEqual([
      '--permission-mode',
      'plan',
    ])
    expect((await resolveLaunch(context(loginEnv, levels), 'codex', project)).args).toEqual([
      '--sandbox',
      'read-only',
      '--ask-for-approval',
      'on-request',
    ])
    expect((await resolveLaunch(context(loginEnv, levels), 'shell', project)).args).toEqual(['-l'])
  })

  it('keeps the level selected when the session started while the login environment is read', async () => {
    let selected: PermissionLevelSettings = highest
    let detecting = false
    const detection = Promise.withResolvers<LoginEnvironment>()
    const launching = resolveLaunch(
      {
        ...context({}),
        getLoginEnvironment: () => {
          detecting = true
          return detection.promise
        },
        permissionLevel: (tool) => permissionLevelOrDefault(tool, selected[tool]),
      },
      'claude',
      project,
    )
    await expect.poll(() => detecting).toBe(true)
    selected = { ...highest, claude: 'manual' }
    detection.resolve({ env: { PATH: bin }, error: null })
    expect((await launching).args).toEqual(['--dangerously-skip-permissions'])
  })

  it('refuses a tool that is not on the login shell PATH', async () => {
    await expect(resolveLaunch(context({ PATH: '/usr/bin' }), 'opencode', project)).rejects.toThrow(
      'OpenCode is not available. Install it with: npm install -g opencode-ai',
    )
  })

  it('refuses a project folder that no longer exists', async () => {
    await expect(
      resolveLaunch(context({ PATH: bin }), 'shell', path.join(root, 'gone')),
    ).rejects.toBeInstanceOf(SessionError)
  })
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  permissionLevelOrDefault,
  type PermissionLevelSettings,
} from '../../shared/permission-levels'
import type { LoginEnvironment } from '../tools/tool-service'
import { resolveLaunch, sentIssueArgs, splitIssuePrompt, type LaunchContext } from './launch'
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
    claudePlugin: '/Applications/Hoot.app/Contents/Resources/claude-plugins/hoot',
  }
}

const PLUGIN = '--plugin-dir=/Applications/Hoot.app/Contents/Resources/claude-plugins/hoot'

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

  it('sends Claude Code an issue after the arguments of its permission level', async () => {
    const levels = { ...highest, claude: 'accept-edits' }
    const issue = {
      title: 'Fix the login bug',
      description: '  Steps\n\n/hoot:other\n$ARGUMENTS  ',
    }
    const launch = await resolveLaunch(context({ PATH: bin }, levels), 'claude', project, issue)
    expect(launch.file).toBe('claude')
    expect(launch.args).toEqual([
      '--permission-mode',
      'acceptEdits',
      PLUGIN,
      '--name=Fix the login bug',
      '/hoot:split-issue # Fix the login bug\n\n  Steps\n\n/hoot:other\n$ARGUMENTS  ',
    ])
    // Any other session, Claude Code's included, has only its level's arguments.
    expect((await resolveLaunch(context({ PATH: bin }, levels), 'claude', project)).args).toEqual([
      '--permission-mode',
      'acceptEdits',
    ])
  })

  it('sends an issue to Claude Code only', async () => {
    const issue = { title: 'T', description: '' }
    await expect(
      resolveLaunch(context({ PATH: bin }), 'codex', project, issue),
    ).rejects.toBeInstanceOf(SessionError)
    await expect(
      resolveLaunch(context({ PATH: bin }), 'shell', project, issue),
    ).rejects.toBeInstanceOf(SessionError)
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

describe('the first message and the arguments that send an issue', () => {
  it('puts the issue after the skill as a heading, with the description below it', () => {
    expect(splitIssuePrompt({ title: 'Only a title', description: '' })).toBe(
      '/hoot:split-issue # Only a title',
    )
    expect(splitIssuePrompt({ title: 'T', description: 'Line 1\n\nLine 3' })).toBe(
      '/hoot:split-issue # T\n\nLine 1\n\nLine 3',
    )
    // A title that starts with a slash stays the heading's text.
    expect(splitIssuePrompt({ title: '/other is broken', description: '' })).toBe(
      '/hoot:split-issue # /other is broken',
    )
  })

  it('leaves the NUL characters out of the name and the first message', () => {
    const issue = { title: 'Fix\0 login', description: 'a\0b' }
    expect(sentIssueArgs('/plugins/hoot', issue)).toEqual([
      '--plugin-dir=/plugins/hoot',
      '--name=Fix login',
      '/hoot:split-issue # Fix login\n\nab',
    ])
    // A description of nothing but NUL characters is an empty one.
    expect(splitIssuePrompt({ title: 'T', description: '\0\0' })).toBe('/hoot:split-issue # T')
  })

  it('keeps a title that starts with a dash the name, in the same argument as its option', () => {
    expect(
      sentIssueArgs('/plugins/hoot', { title: '--verbose flag broken', description: '' }),
    ).toEqual([
      '--plugin-dir=/plugins/hoot',
      '--name=--verbose flag broken',
      '/hoot:split-issue # --verbose flag broken',
    ])
  })
})

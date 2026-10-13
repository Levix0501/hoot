import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  permissionLevelOrDefault,
  type PermissionLevelSettings,
} from '../../shared/permission-levels'
import type { LoginEnvironment } from '../tools/tool-service'
import {
  issueFileText,
  resolveLaunch,
  sentIssueArgs,
  splitIssuePrompt,
  type LaunchContext,
} from './launch'
import { SessionError } from './session-manager'

let root: string
let project: string
let bin: string
let temporary: string

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-launch-')))
  project = path.join(root, 'project')
  bin = path.join(root, 'bin')
  temporary = path.join(root, 'tmp')
  fs.mkdirSync(project)
  fs.mkdirSync(bin)
  fs.mkdirSync(temporary)
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
    temporaryFolder: temporary,
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

  it('sends Claude Code an issue after the arguments of its permission level', async () => {
    const levels = { ...highest, claude: 'accept-edits' }
    const issue = {
      title: 'Fix the login bug',
      description: '  Steps\n\n/hoot:other\n$ARGUMENTS  ',
    }
    const launch = await resolveLaunch(context({ PATH: bin }, levels), 'claude', project, issue)
    // The issue is written in a folder of the session's own, in the temporary folder.
    const [folderName] = fs.readdirSync(temporary)
    expect(folderName).toMatch(/^hoot-issue-/)
    const folder = path.join(temporary, folderName)
    expect(fs.readFileSync(path.join(folder, 'issue.md'), 'utf8')).toBe(
      '# Fix the login bug\n\n  Steps\n\n/hoot:other\n$ARGUMENTS  \n',
    )
    expect(launch.file).toBe('claude')
    expect(launch.args).toEqual([
      '--permission-mode',
      'acceptEdits',
      `--add-dir=${folder}`,
      '--name=Fix the login bug',
      splitIssuePrompt(path.join(folder, 'issue.md')),
    ])
    launch.cleanup?.()
    expect(fs.readdirSync(temporary)).toEqual([])
    // Any other session, Claude Code's included, has only its level's arguments.
    const other = await resolveLaunch(context({ PATH: bin }, levels), 'claude', project)
    expect(other.args).toEqual(['--permission-mode', 'acceptEdits'])
    expect(other.cleanup).toBeUndefined()
    expect(fs.readdirSync(temporary)).toEqual([])
  })

  it('sends an issue to Claude Code only, and writes it only when the launch can go ahead', async () => {
    const issue = { title: 'T', description: '' }
    await expect(
      resolveLaunch(context({ PATH: bin }), 'codex', project, issue),
    ).rejects.toBeInstanceOf(SessionError)
    await expect(
      resolveLaunch(context({ PATH: bin }), 'shell', project, issue),
    ).rejects.toBeInstanceOf(SessionError)
    await expect(
      resolveLaunch(context({ PATH: '/usr/bin' }), 'claude', project, issue),
    ).rejects.toThrow('Claude Code is not available.')
    await expect(
      resolveLaunch(context({ PATH: bin }), 'claude', path.join(root, 'gone'), issue),
    ).rejects.toBeInstanceOf(SessionError)
    expect(fs.readdirSync(temporary)).toEqual([])
  })

  it('says why the issue could not be written', async () => {
    const launching = resolveLaunch(
      { ...context({ PATH: bin }), temporaryFolder: path.join(root, 'missing') },
      'claude',
      project,
      { title: 'T', description: '' },
    )
    await expect(launching).rejects.toBeInstanceOf(SessionError)
    await expect(launching).rejects.toThrow("Could not write the issue's file:")
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

describe('the issue, the first message and the arguments that send them', () => {
  it('writes the issue with its title as a heading and its description, if any, below it', () => {
    expect(issueFileText({ title: 'Only a title', description: '' })).toBe('# Only a title\n')
    expect(issueFileText({ title: 'T', description: 'Line 1\n\nLine 3' })).toBe(
      '# T\n\nLine 1\n\nLine 3\n',
    )
  })

  it('leaves the NUL characters out of the issue and the name', () => {
    expect(issueFileText({ title: 'Fix\0 login', description: 'a\0b' })).toBe('# Fix login\n\nab\n')
    // A description of nothing but NUL characters is an empty one.
    expect(issueFileText({ title: 'T', description: '\0\0' })).toBe('# T\n')
    expect(sentIssueArgs('/tmp/hoot-issue-1', { title: 'Fix\0 login', description: '' })[1]).toBe(
      '--name=Fix login',
    )
  })

  it("starts the first message with the instructions, which point to the issue's file", () => {
    const prompt = splitIssuePrompt('/tmp/hoot-issue-1/issue.md')
    expect(prompt.split('\n')[0]).toBe(
      'The issue to judge is in `/tmp/hoot-issue-1/issue.md`. Read it first: its title is the heading; the rest, if any, is its description.',
    )
    expect(prompt).toContain('can one fresh agent session implement the whole issue')
    expect(prompt).not.toMatch(/Claude|Hoot/)
  })

  it('keeps a title that starts with a dash the name, in the same argument as its option', () => {
    expect(
      sentIssueArgs('/tmp/hoot-issue-1', { title: '--verbose flag broken', description: '' }),
    ).toEqual([
      '--add-dir=/tmp/hoot-issue-1',
      '--name=--verbose flag broken',
      splitIssuePrompt('/tmp/hoot-issue-1/issue.md'),
    ])
  })
})

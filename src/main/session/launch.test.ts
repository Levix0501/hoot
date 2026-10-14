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
  startIssuePrompt,
  type LaunchContext,
} from './launch'
import { SessionError } from './session-manager'

let root: string
let project: string
let bin: string
let agentsBin: string
let temporary: string

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-launch-')))
  project = path.join(root, 'project')
  bin = path.join(root, 'bin')
  agentsBin = path.join(root, 'agents', 'bin')
  temporary = path.join(root, 'tmp')
  fs.mkdirSync(project)
  fs.mkdirSync(bin)
  fs.mkdirSync(agentsBin, { recursive: true })
  fs.mkdirSync(temporary)
  for (const command of ['claude', 'codex']) {
    fs.writeFileSync(path.join(bin, command), '#!/bin/sh\n', { mode: 0o755 })
  }
  for (const command of ['codex', 'opencode']) {
    fs.writeFileSync(path.join(agentsBin, command), '#!/bin/sh\n', { mode: 0o755 })
  }
})

afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

const highest: PermissionLevelSettings = {
  claude: 'bypass-permissions',
  codex: 'full-access',
  opencode: 'auto-approve',
}

const hoot = {
  binDirectory: '/Applications/Hoot.app/Contents/Resources/bin',
  node: '/Applications/Hoot.app/Contents/MacOS/Hoot',
  script: '/Applications/Hoot.app/Contents/Resources/app.asar/dist-electron/cli/index.js',
  socket: '/Users/me/Library/Application Support/Hoot/hoot.sock',
  sessionId: 'session-1',
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
    hoot,
    // A folder of agents without any.
    agents: { binDirectory: path.join(root, 'no-agents'), lastOnPath: [] },
  }
}

/** Where the Hoot that a session's process runs `node` from keeps it. */
const nodeDirectory = '/Applications/Hoot.app/Contents/Resources/node'

const hootVariables = {
  HOOT_SOCKET: hoot.socket,
  HOOT_SESSION_ID: 'session-1',
  HOOT_NODE: hoot.node,
  HOOT_CLI: hoot.script,
}

describe('resolveLaunch', () => {
  it('runs the default shell as a login shell from the base environment', async () => {
    const launch = await resolveLaunch(context({ PATH: `${bin}:/usr/bin` }), 'shell', project)
    expect(launch.file).toBe('/bin/zsh')
    expect(launch.args).toEqual(['-l'])
    expect(launch.env).toMatchObject({
      HOME: '/home/me',
      PATH: `${hoot.binDirectory}:/usr/bin:/bin`,
      PWD: project,
      ...hootVariables,
    })
    expect(launch.env.TERM).toBe('xterm-256color')
  })

  it('runs a tool command with its permission level arguments in the login shell environment', async () => {
    const loginEnv = { PATH: `${bin}:/usr/bin`, FROM_RC: 'yes', SHLVL: '1', _: '/usr/bin/env' }
    const launch = await resolveLaunch(context(loginEnv), 'codex', project)
    expect(launch.file).toBe(path.join(bin, 'codex'))
    expect(launch.args).toEqual(['--dangerously-bypass-approvals-and-sandbox'])
    expect(launch.env).toMatchObject({
      PATH: `${hoot.binDirectory}:${bin}:/usr/bin`,
      FROM_RC: 'yes',
      PWD: project,
      ...hootVariables,
    })
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

  it('starts a tool at the level given, unless it is none of its levels, and else at the one selected', async () => {
    const levels = { claude: 'plan', codex: 'read-only', opencode: 'standard' }
    const loginEnv = { PATH: `${bin}:/usr/bin` }
    const args = async (toolId: 'claude' | 'codex' | 'shell', level: string | null) =>
      (await resolveLaunch(context(loginEnv, levels), toolId, project, null, level)).args
    expect(await args('claude', 'accept-edits')).toEqual(['--permission-mode', 'acceptEdits'])
    expect(await args('claude', 'manual')).toEqual(['--permission-mode', 'manual'])
    expect(await args('claude', null)).toEqual(['--permission-mode', 'plan'])
    // Codex has no level of that name; the shell has no levels at all.
    expect(await args('claude', 'full-access')).toEqual(['--permission-mode', 'plan'])
    expect(await args('codex', 'full-access')).toEqual([
      '--dangerously-bypass-approvals-and-sandbox',
    ])
    expect(await args('shell', 'manual')).toEqual(['-l'])
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
      branch: 'iss-1-fix-the-login-bug',
    }
    const launch = await resolveLaunch(context({ PATH: bin }, levels), 'claude', project, issue)
    // The issue is written in a folder of the session's own, in the temporary folder.
    const [folderName] = fs.readdirSync(temporary)
    expect(folderName).toMatch(/^hoot-issue-/)
    const folder = path.join(temporary, folderName)
    expect(fs.readFileSync(path.join(folder, 'issue.md'), 'utf8')).toBe(
      '# Fix the login bug\n\n  Steps\n\n/hoot:other\n$ARGUMENTS  \n',
    )
    expect(launch.file).toBe(path.join(bin, 'claude'))
    expect(launch.args).toEqual([
      '--permission-mode',
      'acceptEdits',
      `--add-dir=${folder}`,
      '--name=Fix the login bug',
      startIssuePrompt(path.join(folder, 'issue.md'), 'iss-1-fix-the-login-bug'),
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
    const issue = { title: 'T', description: '', branch: 'iss-1-t' }
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
      { title: 'T', description: '', branch: 'iss-1-t' },
    )
    await expect(launching).rejects.toBeInstanceOf(SessionError)
    await expect(launching).rejects.toThrow("Could not write the issue's file:")
  })

  it('refuses a tool that is not on the login shell PATH', async () => {
    await expect(resolveLaunch(context({ PATH: '/usr/bin' }), 'opencode', project)).rejects.toThrow(
      'OpenCode is not available. Install it with: npm install -g opencode-ai',
    )
  })

  it("runs a tool from Hoot's folder of agents when the login shell PATH has none", async () => {
    const withAgents = (loginEnv: Record<string, string>): LaunchContext => ({
      ...context(loginEnv),
      agents: { binDirectory: agentsBin, lastOnPath: [nodeDirectory, agentsBin] },
    })
    const loginEnv = { PATH: `${bin}:/usr/bin` }
    const opencode = await resolveLaunch(withAgents(loginEnv), 'opencode', project)
    expect(opencode.file).toBe(path.join(agentsBin, 'opencode'))
    expect(opencode.args).toEqual(['--auto'])
    // The folders that come with Hoot go last, after every folder the session had.
    expect(opencode.env.PATH).toBe(
      `${hoot.binDirectory}:${bin}:/usr/bin:${nodeDirectory}:${agentsBin}`,
    )
    // The one on the login shell PATH comes first.
    expect((await resolveLaunch(withAgents(loginEnv), 'codex', project)).file).toBe(
      path.join(bin, 'codex'),
    )
    const shell = await resolveLaunch(withAgents(loginEnv), 'shell', project)
    expect(shell.env.PATH).toBe(`${hoot.binDirectory}:/usr/bin:/bin:${nodeDirectory}:${agentsBin}`)
  })

  it('runs a tool found on the login shell PATH only, where Hoot has no folder of agents', async () => {
    const elsewhere: LaunchContext = { ...context({ PATH: `${bin}:/usr/bin` }), agents: null }
    const codex = await resolveLaunch(elsewhere, 'codex', project)
    expect(codex.file).toBe(path.join(bin, 'codex'))
    expect(codex.env.PATH).toBe(`${hoot.binDirectory}:${bin}:/usr/bin`)
    await expect(resolveLaunch(elsewhere, 'opencode', project)).rejects.toThrow(
      'OpenCode is not available.',
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
    expect(
      sentIssueArgs('/tmp/hoot-issue-1', { title: 'Fix\0 login', description: '', branch: 'b' })[1],
    ).toBe('--name=Fix login')
  })

  it("is Hoot's instructions to judge the issue, then split or implement it, word for word", () => {
    const prompt = startIssuePrompt(
      '/tmp/hoot-issue-1/issue.md',
      'iss-1-fix-the-login-bug-on-safari',
    )
    expect(prompt).toBe(
      [
        'The issue to work on is in `/tmp/hoot-issue-1/issue.md`. Read it first: its title is the heading; the rest, if any, is its description.',
        '',
        'This is a Git worktree of the project, on the branch `iss-1-fix-the-login-bug-on-safari`, made for this issue.',
        '',
        "First judge the issue against this project's code. Read whatever you need, but change nothing yet: no edits, no commits, no commands that change files.",
        '',
        '1. Workload: can one fresh agent session implement the whole issue, and another fresh session then verify it in full? Answer yes or no, and say why: the parts of the code it touches, and what is still unknown. Do not estimate time.',
        '2. If yes, say that it needs no split, and wait for me to confirm. Once I do, implement the issue here.',
        '3. If no, split it into issues that one session can each implement and another verify. Each delivers a narrow but complete result through every layer it touches, never one layer of the whole. For each:',
        '   - Title',
        '   - Description: what it delivers, and how to accept it',
        '   - Waits on: the issues it cannot be delivered and accepted without, or none',
        '4. End the split with the order, one chain per line, such as `1 → 2 → 4` and `1 → 3`, and stop there.',
        '',
        "Write titles and descriptions in the issue's language. Where the issue leaves open something that changes your answer, say what you assumed.",
      ].join('\n'),
    )
    // Lines end with LF alone, and nothing follows the last one.
    expect(prompt).not.toMatch(/\r|\s$/)
    // It names no agent, and says nothing of the hoot command.
    expect(prompt.replace('/tmp/hoot-issue-1/issue.md', '')).not.toMatch(/Claude|hoot/i)
  })

  it("names the issue's file and the worktree's branch as they are given", () => {
    const prompt = startIssuePrompt(
      '/var/folders/x/T/hoot-issue-AbC/issue.md',
      'iss-13-修复登录页的问题',
    )
    const [file, , branch] = prompt.split('\n')
    expect(file).toContain('`/var/folders/x/T/hoot-issue-AbC/issue.md`')
    expect(branch).toBe(
      'This is a Git worktree of the project, on the branch `iss-13-修复登录页的问题`, made for this issue.',
    )
  })

  it('keeps a title that starts with a dash the name, in the same argument as its option', () => {
    expect(
      sentIssueArgs('/tmp/hoot-issue-1', {
        title: '--verbose flag broken',
        description: '',
        branch: 'iss-2-verbose-flag-broken',
      }),
    ).toEqual([
      '--add-dir=/tmp/hoot-issue-1',
      '--name=--verbose flag broken',
      startIssuePrompt('/tmp/hoot-issue-1/issue.md', 'iss-2-verbose-flag-broken'),
    ])
  })
})

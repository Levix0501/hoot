import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { quote } from 'shell-quote'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  permissionLevelOrDefault,
  type PermissionLevelSettings,
} from '../../shared/permission-levels'
import { nodeCommandProgram, onPath, writeNodeCommand } from '../tools/test-support'
import type { LoginEnvironment } from '../tools/tool-service'
import { git } from '../worktrees/test-support'
import { BUILT_IN_WORKFLOW } from '../../shared/built-in-workflow'
import { firstMessage, workflowFileText } from '../../shared/workflow-text'
import type { WorkflowStep } from '../../shared/workflows'
import type { SessionFiles } from '../workflows/workflow-executor'
import {
  claudeCodeHookSettings,
  issueFileText,
  resolveLaunch,
  sentIssueArgs,
  type LaunchContext,
  type SentIssue,
} from './launch'
import { SessionError } from './session-manager'

let root: string
let project: string
let bin: string

beforeAll(async () => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-launch-')))
  project = path.join(root, 'project')
  bin = path.join(root, 'bin')
  fs.mkdirSync(project)
  for (const command of ['claude', 'codex']) await writeNodeCommand(path.join(bin, command), '')
})

afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

/**
 * What a session runs for the stand-in command of a folder, and the arguments
 * that go before the tool's own.
 */
const program = (folder: string, command: string) => nodeCommandProgram(path.join(folder, command))

/** The folder in a session's working directory that holds the folders of sessions' issues. */
function temporaryFolder(cwd: string): string {
  return path.join(cwd, '.hoot', 'tmp')
}

/** The folders of sessions' issues in a working directory, without the `.gitignore` beside them. */
function issueFolders(cwd: string): string[] {
  const folder = temporaryFolder(cwd)
  if (!fs.existsSync(folder)) return []
  return fs
    .readdirSync(folder)
    .filter((name) => name !== '.gitignore')
    .map((name) => path.join(folder, name))
}

const [triage] = BUILT_IN_WORKFLOW.steps as [WorkflowStep]

/** The first message of ISS-1 at a step, as the executor writes it, given the files. */
const messageAt = (step: WorkflowStep) => (files: SessionFiles) =>
  firstMessage({ workflow: BUILT_IN_WORKFLOW, identifier: 'ISS-1', step, ...files })

/** An issue sent to a session that starts at the first step, which needs no file of the workflow. */
function sentIssue(title: string, description: string, branch: string): SentIssue {
  return { title, description, branch, workflowFile: null, firstMessage: messageAt(triage) }
}

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
    shell: { file: '/bin/zsh', args: ['-l'] },
    baseEnv: { HOME: '/home/me', PATH: onPath('/usr/bin', '/bin'), SHELL: '/bin/zsh' },
    terminal: () => ({ appVersion: '0.1.0', fallbackLang: 'C.UTF-8' }),
    getLoginEnvironment: async () => ({ env: loginEnv, error: null }),
    permissionLevel: (tool) => permissionLevelOrDefault(tool, levels[tool]),
    hoot,
  }
}

const hootVariables = {
  HOOT_SOCKET: hoot.socket,
  HOOT_SESSION_ID: 'session-1',
  HOOT_NODE: hoot.node,
  HOOT_CLI: hoot.script,
}

/** The arguments that give Claude Code the hooks that report what it is doing to Hoot. */
const hookSettings = ['--settings', claudeCodeHookSettings(path.join(hoot.binDirectory, 'hoot'))]

describe('resolveLaunch', () => {
  it('runs the default shell as a login shell from the base environment', async () => {
    const launch = await resolveLaunch(context({ PATH: onPath(bin, '/usr/bin') }), 'shell', project)
    expect(launch.file).toBe('/bin/zsh')
    expect(launch.args).toEqual(['-l'])
    expect(launch.env).toMatchObject({
      HOME: '/home/me',
      PATH: onPath(hoot.binDirectory, '/usr/bin', '/bin'),
      PWD: project,
      ...hootVariables,
    })
    expect(launch.env.TERM).toBe('xterm-256color')
  })

  it('runs a tool command with its permission level arguments in the login shell environment', async () => {
    const loginEnv = {
      PATH: onPath(bin, '/usr/bin'),
      FROM_RC: 'yes',
      SHLVL: '1',
      _: '/usr/bin/env',
    }
    const launch = await resolveLaunch(context(loginEnv), 'codex', project)
    const codex = program(bin, 'codex')
    expect(launch.file).toBe(codex.file)
    expect(launch.args).toEqual([...codex.args, '--dangerously-bypass-approvals-and-sandbox'])
    expect(launch.env).toMatchObject({
      PATH: onPath(hoot.binDirectory, bin, '/usr/bin'),
      FROM_RC: 'yes',
      PWD: project,
      ...hootVariables,
    })
    expect(launch.env).not.toHaveProperty('SHLVL')
    expect(launch.env).not.toHaveProperty('_')
  })

  it('uses the selected permission level of the tool, and none for the shell', async () => {
    const levels = { claude: 'plan', codex: 'read-only', opencode: 'standard' }
    const loginEnv = { PATH: onPath(bin, '/usr/bin') }
    expect((await resolveLaunch(context(loginEnv, levels), 'claude', project)).args).toEqual([
      ...program(bin, 'claude').args,
      '--permission-mode',
      'plan',
      ...hookSettings,
    ])
    expect((await resolveLaunch(context(loginEnv, levels), 'codex', project)).args).toEqual([
      ...program(bin, 'codex').args,
      '--sandbox',
      'read-only',
      '--ask-for-approval',
      'on-request',
    ])
    expect((await resolveLaunch(context(loginEnv, levels), 'shell', project)).args).toEqual(['-l'])
  })

  it('starts a tool at the level given, unless it is none of its levels, and else at the one selected', async () => {
    const levels = { claude: 'plan', codex: 'read-only', opencode: 'standard' }
    const loginEnv = { PATH: onPath(bin, '/usr/bin') }
    const args = async (toolId: 'claude' | 'codex' | 'shell', level: string | null) =>
      (await resolveLaunch(context(loginEnv, levels), toolId, project, null, level)).args
    const claude = program(bin, 'claude').args
    expect(await args('claude', 'accept-edits')).toEqual([
      ...claude,
      '--permission-mode',
      'acceptEdits',
      ...hookSettings,
    ])
    expect(await args('claude', 'manual')).toEqual([
      ...claude,
      '--permission-mode',
      'manual',
      ...hookSettings,
    ])
    expect(await args('claude', null)).toEqual([
      ...claude,
      '--permission-mode',
      'plan',
      ...hookSettings,
    ])
    // Codex has no level of that name; the shell has no levels at all.
    expect(await args('claude', 'full-access')).toEqual([
      ...claude,
      '--permission-mode',
      'plan',
      ...hookSettings,
    ])
    expect(await args('codex', 'full-access')).toEqual([
      ...program(bin, 'codex').args,
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
    expect((await launching).args).toEqual([
      ...program(bin, 'claude').args,
      '--dangerously-skip-permissions',
      ...hookSettings,
    ])
  })

  it("gives Claude Code, and only Claude Code, hooks that report its turns and dialogs through Hoot's hoot", async () => {
    const loginEnv = { PATH: onPath(bin, '/usr/bin') }
    const claude = await resolveLaunch(context(loginEnv), 'claude', project)
    const settings = claude.args[claude.args.indexOf('--settings') + 1]!
    const hook = {
      type: 'command',
      // hoot's path, quoted for the shell that runs the hook.
      command: `${quote([path.join(hoot.binDirectory, 'hoot')])} hook`,
      async: true,
    }
    expect(JSON.parse(settings)).toEqual({
      hooks: {
        PermissionRequest: [{ hooks: [hook] }],
        Elicitation: [{ hooks: [hook] }],
        Stop: [{ hooks: [hook] }],
        StopFailure: [{ hooks: [hook] }],
      },
    })
    for (const toolId of ['codex', 'shell'] as const) {
      expect((await resolveLaunch(context(loginEnv), toolId, project)).args).not.toContain(
        '--settings',
      )
    }
    // A folder with a space in its path is still one word of the command.
    expect(JSON.parse(claudeCodeHookSettings('/Users/me/My Apps/Hoot/bin/hoot'))).toMatchObject({
      hooks: { Stop: [{ hooks: [{ command: "'/Users/me/My Apps/Hoot/bin/hoot' hook" }] }] },
    })
  })

  it('sends Claude Code an issue after the arguments of its permission level', async () => {
    const levels = { ...highest, claude: 'accept-edits' }
    const issue = sentIssue(
      'Fix the login bug',
      '  Steps\n\n/hoot:other\n$ARGUMENTS  ',
      'iss-1-fix-the-login-bug',
    )
    const launch = await resolveLaunch(context({ PATH: bin }, levels), 'claude', project, issue)
    // The issue is written in a folder of the session's own, in `.hoot/tmp` of the working
    // directory, beside the `.gitignore` that has Git ignore everything there.
    const [folder] = issueFolders(project)
    expect(path.basename(folder)).toMatch(/^issue-/)
    expect(fs.readFileSync(path.join(temporaryFolder(project), '.gitignore'), 'utf8')).toBe(
      '# Created by Hoot automatically.\n*\n',
    )
    expect(fs.readFileSync(path.join(folder, 'issue.md'), 'utf8')).toBe(
      '# Fix the login bug\n\n  Steps\n\n/hoot:other\n$ARGUMENTS  \n',
    )
    // Nothing else: the session has no file of the workflow.
    expect(fs.readdirSync(folder)).toEqual(['issue.md'])
    const claude = program(bin, 'claude')
    expect(launch.file).toBe(claude.file)
    expect(launch.args).toEqual([
      ...claude.args,
      '--permission-mode',
      'acceptEdits',
      ...hookSettings,
      '--name=Fix the login bug',
      '--',
      messageAt(triage)({
        issueFile: path.join(folder, 'issue.md'),
        workflowFile: path.join(folder, 'workflow.md'),
        branch: 'iss-1-fix-the-login-bug',
      }),
    ])
    // The cleanup removes the session's folder and leaves the `.gitignore`.
    launch.cleanup?.()
    expect(fs.readdirSync(temporaryFolder(project))).toEqual(['.gitignore'])
    // Any other session, Claude Code's included, has no arguments but its level's, after those
    // that run its command.
    const other = await resolveLaunch(context({ PATH: bin }, levels), 'claude', project)
    expect(other.args).toEqual([
      ...claude.args,
      '--permission-mode',
      'acceptEdits',
      ...hookSettings,
    ])
    expect(other.cleanup).toBeUndefined()
    expect(issueFolders(project)).toEqual([])
  })

  it("keeps the issue's files out of Git, and leaves a .gitignore that is there as it is", async () => {
    const repository = path.join(root, 'repository')
    fs.mkdirSync(repository)
    git(repository, 'init', '-q')
    const issue = sentIssue('T', 'D', 'iss-1-t')
    const launch = await resolveLaunch(context({ PATH: bin }), 'claude', repository, issue)
    expect(issueFolders(repository)).toHaveLength(1)
    expect(git(repository, 'status', '--porcelain', '--untracked-files=all')).toBe('')
    launch.cleanup?.()
    // Even with nothing beside it, the .gitignore keeps itself out of Git.
    expect(git(repository, 'status', '--porcelain', '--untracked-files=all')).toBe('')
    const gitignore = path.join(temporaryFolder(repository), '.gitignore')
    fs.writeFileSync(gitignore, '*\n')
    const next = await resolveLaunch(context({ PATH: bin }), 'claude', repository, issue)
    expect(fs.readFileSync(gitignore, 'utf8')).toBe('*\n')
    next.cleanup?.()
  })

  it("writes the file of the workflow beside the issue's when the session has one", async () => {
    const issue: SentIssue = {
      ...sentIssue('Continue', '', 'iss-4-continue'),
      workflowFile: workflowFileText(BUILT_IN_WORKFLOW, 'ISS-1'),
    }
    const launch = await resolveLaunch(context({ PATH: bin }), 'claude', project, issue)
    const [folder] = issueFolders(project)
    expect(fs.readdirSync(folder).toSorted()).toEqual(['issue.md', 'workflow.md'])
    expect(fs.readFileSync(path.join(folder, 'workflow.md'), 'utf8')).toBe(
      workflowFileText(BUILT_IN_WORKFLOW, 'ISS-1'),
    )
    launch.cleanup?.()
    expect(issueFolders(project)).toEqual([])
  })

  it('sends the first message the issue gives, written from its files, or one of its own', async () => {
    const issue: SentIssue = {
      ...sentIssue('Continue', '', 'iss-4-continue'),
      firstMessage: ({ issueFile, branch }) => `Go on with ${issueFile} on ${branch}.`,
    }
    const launch = await resolveLaunch(context({ PATH: bin }), 'claude', project, issue)
    const [folder] = issueFolders(project)
    expect(launch.args.at(-1)).toBe(
      `Go on with ${path.join(folder, 'issue.md')} on iss-4-continue.`,
    )
    launch.cleanup?.()
    const own = await resolveLaunch(context({ PATH: bin }), 'claude', project, {
      ...issue,
      firstMessage: () => 'Do this.\0\n',
    })
    expect(own.args.at(-1)).toBe('Do this.\n')
    expect(fs.readdirSync(issueFolders(project)[0]!)).toEqual(['issue.md'])
    own.cleanup?.()
    expect(issueFolders(project)).toEqual([])
  })

  it('sends an issue to Claude Code only, and writes it only when the launch can go ahead', async () => {
    const issue = sentIssue('T', '', 'iss-1-t')
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
    expect(issueFolders(project)).toEqual([])
  })

  it('says why the issue could not be written', async () => {
    // A file where the folder for the issue's files would be.
    const blocked = path.join(root, 'blocked')
    fs.mkdirSync(blocked)
    fs.writeFileSync(path.join(blocked, '.hoot'), '')
    const launching = resolveLaunch(
      context({ PATH: bin }),
      'claude',
      blocked,
      sentIssue('T', '', 'iss-1-t'),
    )
    await expect(launching).rejects.toBeInstanceOf(SessionError)
    await expect(launching).rejects.toThrow("Could not write the issue's file:")
  })

  it('refuses a tool that is not on the login shell PATH', async () => {
    await expect(resolveLaunch(context({ PATH: '/usr/bin' }), 'opencode', project)).rejects.toThrow(
      'OpenCode is not available. Install it with: npm install -g @opencode/cli',
    )
  })

  it('runs a tool found on the login shell PATH, and adds no folder after the ones it has', async () => {
    const loginEnv = { PATH: onPath(bin, '/usr/bin') }
    const codex = await resolveLaunch(context(loginEnv), 'codex', project)
    expect(codex.file).toBe(program(bin, 'codex').file)
    expect(codex.env.PATH).toBe(onPath(hoot.binDirectory, bin, '/usr/bin'))
    const shell = await resolveLaunch(context(loginEnv), 'shell', project)
    expect(shell.env.PATH).toBe(onPath(hoot.binDirectory, '/usr/bin', '/bin'))
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
    expect(sentIssueArgs('/w/.hoot/tmp/issue-1', sentIssue('Fix\0 login', '', 'b'))[0]).toBe(
      '--name=Fix login',
    )
  })

  it('keeps a title that starts with a dash the name, in the same argument as its option', () => {
    const folder = '/w/.hoot/tmp/issue-1'
    expect(
      sentIssueArgs(folder, sentIssue('--verbose flag broken', '', 'iss-2-verbose-flag-broken')),
    ).toEqual([
      '--name=--verbose flag broken',
      '--',
      messageAt(triage)({
        // Joined to the folder with the separator of the platform.
        issueFile: path.join(folder, 'issue.md'),
        workflowFile: path.join(folder, 'workflow.md'),
        branch: 'iss-2-verbose-flag-broken',
      }),
    ])
  })

  it('ends the options before the first message, so that one starting with a dash is still the message', () => {
    // Such as one `hoot session start --prompt-file` gives, which Claude Code
    // would otherwise take for an option: a list, front matter or a flag.
    for (const prompt of ['- First item\n- Second item', '---\ntitle: x\n---', '--version']) {
      const issue = { ...sentIssue('T', '', 'b'), firstMessage: () => prompt }
      expect(sentIssueArgs('/w/.hoot/tmp/issue-1', issue)).toEqual(['--name=T', '--', prompt])
    }
  })
})

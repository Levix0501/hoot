import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { quote } from 'shell-quote'
import { parse as parseToml } from 'smol-toml'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AgentLaunchSettings } from '../../shared/launch-settings'
import { nodeCommandProgram, onPath, writeNodeCommand } from '../tools/test-support'
import type { LoginEnvironment } from '../tools/tool-service'
import { git } from '../worktrees/test-support'
import { BUILT_IN_WORKFLOW } from '../../shared/built-in-workflow'
import { firstMessage, workflowFileText } from '../../shared/workflow-text'
import type { WorkflowStep } from '../../shared/workflows'
import type { SessionFiles } from '../workflows/workflow-executor'
import {
  CODEX_HOOK_SETTING,
  claudeCodeHookSettings,
  firstMessageArguments,
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

/** An agent's launch settings, with what the test changes. */
function settings(overrides: Partial<AgentLaunchSettings> = {}): AgentLaunchSettings {
  return { enabled: true, model: null, effort: null, extraArgs: [], ...overrides }
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
  agents: Partial<Record<'claude' | 'codex' | 'opencode', Partial<AgentLaunchSettings>>> = {},
  yoloMode = true,
): LaunchContext {
  return {
    shell: { file: '/bin/zsh', args: ['-l'] },
    baseEnv: { HOME: '/home/me', PATH: onPath('/usr/bin', '/bin'), SHELL: '/bin/zsh' },
    terminal: () => ({ appVersion: '0.1.0', fallbackLang: 'C.UTF-8' }),
    getLoginEnvironment: async () => ({ env: loginEnv, error: null }),
    launchSettings: (tool) => ({ yoloMode, agent: settings(agents[tool]) }),
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

  it('runs a tool command with the YOLO arguments in the login shell environment', async () => {
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

  it('runs Claude Code with the YOLO arguments and its hooks, and OpenCode with --auto', async () => {
    const loginEnv = { PATH: onPath(bin, '/usr/bin') }
    expect((await resolveLaunch(context(loginEnv), 'claude', project)).args).toEqual([
      ...program(bin, 'claude').args,
      '--dangerously-skip-permissions',
      ...hookSettings,
    ])
    await writeNodeCommand(path.join(bin, 'opencode'), '')
    expect((await resolveLaunch(context(loginEnv), 'opencode', project)).args).toEqual([
      ...program(bin, 'opencode').args,
      '--auto',
    ])
    expect((await resolveLaunch(context(loginEnv), 'shell', project)).args).toEqual(['-l'])
  })

  it('adds no permission arguments while YOLO mode is off', async () => {
    const loginEnv = { PATH: onPath(bin, '/usr/bin') }
    expect((await resolveLaunch(context(loginEnv, {}, false), 'claude', project)).args).toEqual([
      ...program(bin, 'claude').args,
      ...hookSettings,
    ])
    expect((await resolveLaunch(context(loginEnv, {}, false), 'codex', project)).args).toEqual([
      ...program(bin, 'codex').args,
    ])
    await writeNodeCommand(path.join(bin, 'opencode'), '')
    expect((await resolveLaunch(context(loginEnv, {}, false), 'opencode', project)).args).toEqual([
      ...program(bin, 'opencode').args,
    ])
  })

  it('adds the model, the effort and the extra arguments, in that order, before the hooks', async () => {
    const loginEnv = { PATH: onPath(bin, '/usr/bin') }
    const claude = await resolveLaunch(
      context(loginEnv, {
        claude: { model: 'opus', effort: 'max', extraArgs: ['--verbose'] },
      }),
      'claude',
      project,
    )
    expect(claude.args).toEqual([
      ...program(bin, 'claude').args,
      '--dangerously-skip-permissions',
      '--model',
      'opus',
      '--effort',
      'max',
      '--verbose',
      ...hookSettings,
    ])
    const codex = await resolveLaunch(
      context(loginEnv, {
        codex: { model: 'deepseek-v4-pro', effort: 'high', extraArgs: ['--foo'] },
      }),
      'codex',
      project,
    )
    expect(codex.args).toEqual([
      ...program(bin, 'codex').args,
      '--dangerously-bypass-approvals-and-sandbox',
      '--model',
      'deepseek-v4-pro',
      '-c',
      'model_reasoning_effort=high',
      '--foo',
    ])
  })

  it('leaves out an argument that the extra arguments already decide', async () => {
    const loginEnv = { PATH: onPath(bin, '/usr/bin') }
    const claude = await resolveLaunch(
      context(loginEnv, {
        claude: {
          model: 'opus',
          effort: 'max',
          extraArgs: ['--permission-mode', 'plan', '--model', 'sonnet', '--effort', 'low'],
        },
      }),
      'claude',
      project,
    )
    expect(claude.args).toEqual([
      ...program(bin, 'claude').args,
      '--permission-mode',
      'plan',
      '--model',
      'sonnet',
      '--effort',
      'low',
      ...hookSettings,
    ])
    const codex = await resolveLaunch(
      context(loginEnv, {
        codex: {
          model: 'gpt-5.5',
          effort: 'max',
          extraArgs: ['-c', 'model_reasoning_effort=low', '-m', 'gpt-6'],
        },
      }),
      'codex',
      project,
    )
    expect(codex.args).toEqual([
      ...program(bin, 'codex').args,
      '--dangerously-bypass-approvals-and-sandbox',
      '-c',
      'model_reasoning_effort=low',
      '-m',
      'gpt-6',
    ])
    // Another agent's extra arguments do not change this one's permission.
    expect(
      (
        await resolveLaunch(
          context(loginEnv, { claude: { extraArgs: ['--auto'] } }),
          'codex',
          project,
        )
      ).args,
    ).toEqual([...program(bin, 'codex').args, '--dangerously-bypass-approvals-and-sandbox'])
  })

  it('keeps the settings the session started with while the login environment is read', async () => {
    let selected = settings({ model: 'opus' })
    let detecting = false
    const detection = Promise.withResolvers<LoginEnvironment>()
    const launching = resolveLaunch(
      {
        ...context({}),
        getLoginEnvironment: () => {
          detecting = true
          return detection.promise
        },
        launchSettings: (tool) => ({
          yoloMode: tool === 'claude',
          agent: selected,
        }),
      },
      'claude',
      project,
    )
    await expect.poll(() => detecting).toBe(true)
    selected = settings({ model: 'sonnet' })
    detection.resolve({ env: { PATH: bin }, error: null })
    expect((await launching).args).toEqual([
      ...program(bin, 'claude').args,
      '--dangerously-skip-permissions',
      '--model',
      'opus',
      ...hookSettings,
    ])
  })

  it('continues a chat’s conversation, or starts the one its id names', async () => {
    const loginEnv = { PATH: onPath(bin, '/usr/bin') }
    // A new Claude Code conversation gets the id Claude Code picks.
    const claudeNew = await resolveLaunch(context(loginEnv), 'claude', project, null, {
      conversationId: null,
      resume: false,
    })
    expect(claudeNew.args).toEqual([
      ...program(bin, 'claude').args,
      '--dangerously-skip-permissions',
      ...hookSettings,
    ])
    const claudeAgain = await resolveLaunch(context(loginEnv), 'claude', project, null, {
      conversationId: 'claude-id',
      resume: true,
    })
    expect(claudeAgain.args).toEqual([
      ...program(bin, 'claude').args,
      '--dangerously-skip-permissions',
      ...hookSettings,
      '--resume',
      'claude-id',
    ])

    const codexAgain = await resolveLaunch(context(loginEnv), 'codex', project, null, {
      conversationId: 'thread-id',
      resume: true,
    })
    expect(codexAgain.args).toEqual([
      ...program(bin, 'codex').args,
      'resume',
      'thread-id',
      '--dangerously-bypass-approvals-and-sandbox',
    ])
    // A new Codex conversation has no id yet, and starts as any session does.
    const codexNew = await resolveLaunch(context(loginEnv), 'codex', project, null, {
      conversationId: null,
      resume: false,
    })
    expect(codexNew.args).toEqual([
      ...program(bin, 'codex').args,
      '--dangerously-bypass-approvals-and-sandbox',
    ])

    await writeNodeCommand(path.join(bin, 'opencode'), '')
    const opencode = await resolveLaunch(context(loginEnv), 'opencode', project, null, {
      conversationId: 'ses_one',
      resume: true,
    })
    expect(opencode.args).toEqual([...program(bin, 'opencode').args, '--auto', '-s', 'ses_one'])
  })

  it('sends the first message of a conversation it starts after every other argument', async () => {
    const loginEnv = { PATH: onPath(bin, '/usr/bin') }
    await writeNodeCommand(path.join(bin, 'opencode'), '')
    const message = 'Merge the worktree feature-x.\n\n- Do not push.'
    const yolo = context(loginEnv, {
      claude: { extraArgs: ['--add-dir', '/extra'] },
      codex: { extraArgs: ['-c', 'model=x'] },
    })
    const claude = await resolveLaunch(yolo, 'claude', project, null, {
      conversationId: null,
      resume: false,
      firstMessage: message,
    })
    expect(claude.args).toEqual([
      ...program(bin, 'claude').args,
      '--dangerously-skip-permissions',
      '--add-dir',
      '/extra',
      ...hookSettings,
      '--',
      message,
    ])
    const codex = await resolveLaunch(yolo, 'codex', project, null, {
      conversationId: null,
      resume: false,
      firstMessage: message,
    })
    expect(codex.args).toEqual([
      ...program(bin, 'codex').args,
      '--dangerously-bypass-approvals-and-sandbox',
      '-c',
      'model=x',
      '--',
      message,
    ])
    const opencode = await resolveLaunch(context(loginEnv, {}, false), 'opencode', project, null, {
      conversationId: 'ses_one',
      resume: false,
      firstMessage: message,
    })
    expect(opencode.args).toEqual([
      ...program(bin, 'opencode').args,
      '-s',
      'ses_one',
      `--prompt=${message}`,
    ])
    // Without one, nothing is sent.
    const plain = await resolveLaunch(yolo, 'claude', project, null, {
      conversationId: null,
      resume: false,
    })
    expect(plain.args).not.toContain('--')
  })

  it('gives a resumed chat the agent’s extra arguments too', async () => {
    const loginEnv = { PATH: onPath(bin, '/usr/bin') }
    const launch = await resolveLaunch(
      context(loginEnv, { claude: { extraArgs: ['--verbose'] } }),
      'claude',
      project,
      null,
      { conversationId: 'claude-id', resume: true },
    )
    expect(launch.args).toContain('--verbose')
    expect(launch.args).toContain('--resume')
    expect(launch.args).toContain('claude-id')
  })

  it("gives Claude Code, and only Claude Code, hooks that report its turns and dialogs through Hoot's hoot", async () => {
    const loginEnv = { PATH: onPath(bin, '/usr/bin') }
    const claude = await resolveLaunch(context(loginEnv), 'claude', project)
    const hookSettingsValue = claude.args[claude.args.indexOf('--settings') + 1]!
    const hook = {
      type: 'command',
      // hoot's path, quoted for the shell that runs the hook.
      command: `${quote([path.join(hoot.binDirectory, 'hoot')])} hook`,
      async: true,
    }
    expect(JSON.parse(hookSettingsValue)).toEqual({
      hooks: {
        SessionStart: [{ hooks: [hook] }],
        SessionEnd: [{ hooks: [hook] }],
        PermissionRequest: [{ hooks: [hook] }],
        Elicitation: [{ hooks: [hook] }],
        UserPromptSubmit: [{ hooks: [hook] }],
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

  it('gives a Codex that runs hooks in the background, and only such a Codex, the hook that reports its conversations', async () => {
    const folder = path.join(root, 'codex-versions')
    const loginEnv = { PATH: onPath(folder, '/usr/bin') }
    const codex = program(folder, 'codex')
    /** Makes the stand-in Codex say `text` when asked its version. */
    const says = (text: string) =>
      writeNodeCommand(
        path.join(folder, 'codex'),
        `if (process.argv.includes('--version')) console.log(${JSON.stringify(text)})\n`,
      )
    const hookArguments = ['-c', CODEX_HOOK_SETTING]
    const agents = { codex: { effort: 'high', extraArgs: ['--search'] } }
    const message = 'Merge the worktree feature-x.'

    // Read again for each session, as Codex may change while Hoot runs.
    for (const version of ['codex-cli 0.163.0', 'codex-cli 0.148.0', 'codex-cli 0.149.0-alpha.1']) {
      await says(version)
      expect((await resolveLaunch(context(loginEnv, agents), 'codex', project)).args).toEqual([
        ...codex.args,
        '--dangerously-bypass-approvals-and-sandbox',
        '-c',
        'model_reasoning_effort=high',
        '--search',
        ...hookArguments,
      ])
    }
    const resumed = await resolveLaunch(context(loginEnv), 'codex', project, null, {
      conversationId: 'thread-id',
      resume: true,
    })
    expect(resumed.args).toEqual([
      ...codex.args,
      'resume',
      'thread-id',
      '--dangerously-bypass-approvals-and-sandbox',
      ...hookArguments,
    ])
    const merging = await resolveLaunch(context(loginEnv, {}, false), 'codex', project, null, {
      conversationId: null,
      resume: false,
      firstMessage: message,
    })
    expect(merging.args).toEqual([...codex.args, ...hookArguments, '--', message])

    // An older Codex, or one whose version cannot be read, starts as it did.
    for (const version of ['codex-cli 0.147.0', 'codex-cli 0.148.0-alpha.2', 'codex-cli']) {
      await says(version)
      expect((await resolveLaunch(context(loginEnv, agents), 'codex', project)).args).toEqual([
        ...codex.args,
        '--dangerously-bypass-approvals-and-sandbox',
        '-c',
        'model_reasoning_effort=high',
        '--search',
      ])
    }
  })

  it('names the hook Codex asks the user to trust, which runs hoot in the background', () => {
    const separator = CODEX_HOOK_SETTING.indexOf('=')
    expect(CODEX_HOOK_SETTING.slice(0, separator)).toBe('hooks.UserPromptSubmit')
    expect(parseToml(`value = ${CODEX_HOOK_SETTING.slice(separator + 1)}`)).toEqual({
      value: [
        {
          hooks: [
            {
              type: 'command',
              command: 'hoot hook',
              async: true,
              statusMessage: 'Let Hoot know which conversation this is',
            },
          ],
        },
      ],
    })
  })

  it('sends Claude Code an issue after its launch arguments, with the extra ones before the issue', async () => {
    const agents = { claude: { model: 'opus', effort: 'max', extraArgs: ['--verbose'] } }
    const issue = sentIssue(
      'Fix the login bug',
      '  Steps\n\n/hoot:other\n$ARGUMENTS  ',
      'iss-1-fix-the-login-bug',
    )
    const launch = await resolveLaunch(context({ PATH: bin }, agents), 'claude', project, issue)
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
      '--dangerously-skip-permissions',
      '--model',
      'opus',
      '--effort',
      'max',
      '--verbose',
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
    // Any other session, Claude Code's included, has the same arguments but no issue.
    const other = await resolveLaunch(context({ PATH: bin }, agents), 'claude', project)
    expect(other.args).toEqual([
      ...claude.args,
      '--dangerously-skip-permissions',
      '--model',
      'opus',
      '--effort',
      'max',
      '--verbose',
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

describe('firstMessageArguments', () => {
  it('ends the options before the message, or gives it as the value of --prompt, without NUL characters', () => {
    expect(firstMessageArguments('claude', '-a\0b')).toEqual(['--', '-ab'])
    expect(firstMessageArguments('codex', '-a\0b')).toEqual(['--', '-ab'])
    expect(firstMessageArguments('opencode', '-a\0b')).toEqual(['--prompt=-ab'])
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

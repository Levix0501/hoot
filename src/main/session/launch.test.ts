import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { quote } from 'shell-quote'
import { parse as parseToml } from 'smol-toml'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AgentLaunchSettings } from '../../shared/launch-settings'
import {
  ownProvider,
  type CatalogModel,
  type ModelCatalogs,
  type Provider,
} from '../../shared/providers'
import type { CodexCatalogSupport } from '../providers/codex-catalog'
import { nodeCommandProgram, onPath, writeNodeCommand } from '../tools/test-support'
import type { LoginEnvironment } from '../tools/tool-service'
import { git } from '../worktrees/test-support'
import { BUILT_IN_WORKFLOW } from '../../shared/built-in-workflow'
import { firstMessage, workflowFileText } from '../../shared/workflow-text'
import type { WorkflowStep } from '../../shared/workflows'
import type { SessionFiles } from '../workflows/workflow-executor'
import {
  CODEX_HOOK_SETTING,
  claudeCodeSettings,
  claudeSettingsFilePath,
  codexCatalogFilePath,
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

/** The folder of the plugin Hoot gives OpenCode, as a packaged Hoot has it. */
const openCodePlugin = path.join(
  path.sep,
  'Applications',
  'Hoot.app',
  'Contents',
  'Resources',
  'opencode-plugin',
)

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
    provider: null,
    modelMap: {},
    leavesRoles: false,
    claudeUserVariables: async () => [],
    catalogs: () => ({}),
    codexCatalogSupport: async () => null,
    codexNamesCatalog: async () => false,
    settingsFolder: settingsFolder(),
    hoot,
    openCodePlugin,
    openCodeServer: null,
  }
}

/** Where the test's Claude Code sessions get their settings files. */
function settingsFolder(): string {
  return path.join(root, 'session-settings')
}

/** The settings file of the test's Claude Code session, as it was written. */
function writtenSettings(): Record<string, unknown> {
  const file = claudeSettingsFilePath(settingsFolder(), hoot.sessionId)
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
}

const hootVariables = {
  HOOT_SOCKET: hoot.socket,
  HOOT_SESSION_ID: 'session-1',
  HOOT_NODE: hoot.node,
  HOOT_CLI: hoot.script,
}

/**
 * The arguments that give Claude Code its settings file, with the hooks that
 * report what it is doing to Hoot.
 */
const hookSettings = () => ['--settings', claudeSettingsFilePath(settingsFolder(), hoot.sessionId)]

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
      ...hookSettings(),
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
      ...hookSettings(),
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
      ...hookSettings(),
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
      ...hookSettings(),
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
      ...hookSettings(),
    ])
  })

  it('continues a chat’s conversation, or starts a new one whose id the agent picks', async () => {
    const loginEnv = { PATH: onPath(bin, '/usr/bin') }
    // A new Claude Code conversation gets the id Claude Code picks.
    const claudeNew = await resolveLaunch(context(loginEnv), 'claude', project, null, {
      conversationId: null,
      resume: false,
    })
    expect(claudeNew.args).toEqual([
      ...program(bin, 'claude').args,
      '--dangerously-skip-permissions',
      ...hookSettings(),
    ])
    const claudeAgain = await resolveLaunch(context(loginEnv), 'claude', project, null, {
      conversationId: 'claude-id',
      resume: true,
    })
    expect(claudeAgain.args).toEqual([
      ...program(bin, 'claude').args,
      '--dangerously-skip-permissions',
      ...hookSettings(),
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
    // OpenCode picks the id of a new one too, which OpenCode 1.x needs: it
    // takes `-s` for a conversation to continue alone.
    const opencodeNew = await resolveLaunch(context(loginEnv), 'opencode', project, null, {
      conversationId: null,
      resume: false,
    })
    expect(opencodeNew.args).toEqual([...program(bin, 'opencode').args, '--auto'])
    // Nor is one that never got a message continued, as one an earlier
    // version of Hoot gave OpenCode the id of.
    const opencodeUnused = await resolveLaunch(context(loginEnv), 'opencode', project, null, {
      conversationId: 'ses_unused',
      resume: false,
    })
    expect(opencodeUnused.args).toEqual([...program(bin, 'opencode').args, '--auto'])
  })

  it("connects OpenCode to Hoot's server where it is given one, its password in its environment", async () => {
    const loginEnv = { PATH: onPath(bin, '/usr/bin'), OPENCODE_PASSWORD: 'the-users-own' }
    await writeNodeCommand(path.join(bin, 'opencode'), '')
    const server = { url: 'http://127.0.0.1:4321', password: 'hoots' }
    const opencode = await resolveLaunch(
      { ...context(loginEnv), openCodeServer: server },
      'opencode',
      project,
      null,
      { conversationId: 'ses_one', resume: true },
    )
    expect(opencode.args).toEqual([
      ...program(bin, 'opencode').args,
      '--server',
      'http://127.0.0.1:4321',
      '--auto',
      '-s',
      'ses_one',
    ])
    expect(opencode.env.OPENCODE_PASSWORD).toBe('hoots')
    // Extra arguments that pick a server of their own keep it.
    for (const extraArgs of [['--standalone'], ['--server', 'http://elsewhere'], ['--server=x']]) {
      const own = await resolveLaunch(
        { ...context(loginEnv, { opencode: { extraArgs } }), openCodeServer: server },
        'opencode',
        project,
      )
      expect(own.args).not.toContain('http://127.0.0.1:4321')
      expect(own.env.OPENCODE_PASSWORD).toBe('the-users-own')
    }
    // Only OpenCode connects to it.
    await writeNodeCommand(path.join(bin, 'claude'), '')
    const claude = await resolveLaunch(
      { ...context(loginEnv), openCodeServer: server },
      'claude',
      project,
    )
    expect(claude.args).not.toContain('--server')
    expect(claude.env.OPENCODE_PASSWORD).toBe('the-users-own')
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
      ...hookSettings(),
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
      conversationId: null,
      resume: false,
      firstMessage: message,
    })
    expect(opencode.args).toEqual([...program(bin, 'opencode').args, `--prompt=${message}`])
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

  it("gives OpenCode, and only OpenCode, Hoot's plugin in its environment, with its tab strip off, and no argument for it", async () => {
    const configFolder = path.join(root, 'opencode-settings')
    fs.mkdirSync(configFolder, { recursive: true })
    fs.writeFileSync(path.join(configFolder, 'cli.json'), '{ "plugins": ["/plugins/u", "-hoot"] }')
    const loginEnv = { PATH: onPath(bin, '/usr/bin'), OPENCODE_CONFIG_DIR: configFolder }
    await writeNodeCommand(path.join(bin, 'opencode'), '')
    const opencode = await resolveLaunch(context(loginEnv), 'opencode', project)
    expect(opencode.args).toEqual([...program(bin, 'opencode').args, '--auto'])
    expect(JSON.parse(opencode.env.OPENCODE_CLI_CONFIG_CONTENT!)).toEqual({
      tabs: { mode: 'off', enabled: false },
      plugins: [openCodePlugin, '/plugins/u', '-hoot'],
    })
    expect(opencode.env).toMatchObject({ HOOT_OPENCODE_PLUGIN: '1', ...hootVariables })
    // Over the user's own settings in that variable.
    const own = await resolveLaunch(
      context({ ...loginEnv, OPENCODE_CLI_CONFIG_CONTENT: '{ "theme": { "name": "nord" } }' }),
      'opencode',
      project,
    )
    expect(JSON.parse(own.env.OPENCODE_CLI_CONFIG_CONTENT!)).toEqual({
      theme: { name: 'nord' },
      tabs: { mode: 'off', enabled: false },
      plugins: [openCodePlugin, '/plugins/u', '-hoot'],
    })
    for (const tool of ['claude', 'codex', 'shell'] as const) {
      const launch = await resolveLaunch(context(loginEnv), tool, project)
      expect(launch.env).not.toHaveProperty('OPENCODE_CLI_CONFIG_CONTENT')
      expect(launch.env).not.toHaveProperty('HOOT_OPENCODE_PLUGIN')
    }
  })

  it("gives Claude Code, and only Claude Code, hooks that report its turns and dialogs through Hoot's hoot", async () => {
    const loginEnv = { PATH: onPath(bin, '/usr/bin') }
    const claude = await resolveLaunch(context(loginEnv), 'claude', project)
    // In a file of the session's own, which only the user can read.
    const file = claude.args[claude.args.indexOf('--settings') + 1]!
    expect(file).toBe(claudeSettingsFilePath(settingsFolder(), hoot.sessionId))
    const hook = {
      type: 'command',
      // hoot's path, quoted for the shell that runs the hook.
      command: `${quote([path.join(hoot.binDirectory, 'hoot')])} hook`,
      async: true,
    }
    expect(writtenSettings()).toEqual({
      hooks: {
        SessionStart: [{ hooks: [hook] }],
        SessionEnd: [{ hooks: [hook] }],
        PermissionRequest: [{ hooks: [hook] }],
        Elicitation: [{ hooks: [hook] }],
        UserPromptSubmit: [{ hooks: [hook] }],
        Stop: [{ hooks: [hook] }],
        StopFailure: [{ hooks: [hook] }],
        PostModelSwitch: [{ hooks: [hook] }],
      },
    })
    for (const toolId of ['codex', 'shell'] as const) {
      expect((await resolveLaunch(context(loginEnv), toolId, project)).args).not.toContain(
        '--settings',
      )
    }
    // A folder with a space in its path is still one word of the command.
    expect(claudeCodeSettings('/Users/me/My Apps/Hoot/bin/hoot')).toMatchObject({
      hooks: { Stop: [{ hooks: [{ command: "'/Users/me/My Apps/Hoot/bin/hoot' hook" }] }] },
    })
    claude.cleanup?.()
    expect(fs.existsSync(file)).toBe(false)
  })

  it.skipIf(process.platform === 'win32')(
    "writes a Claude Code session's settings readable by the user alone",
    async () => {
      const launch = await resolveLaunch(
        context({ PATH: onPath(bin, '/usr/bin') }),
        'claude',
        project,
      )
      const file = claudeSettingsFilePath(settingsFolder(), hoot.sessionId)
      expect(fs.statSync(file).mode & 0o777).toBe(0o600)
      launch.cleanup?.()
    },
  )

  it("runs Codex on its session's provider by its arguments, the key in its environment", async () => {
    const loginEnv = { PATH: onPath(bin, '/usr/bin') }
    const kimi: Provider = {
      id: 'p-kimi',
      name: 'Kimi',
      presetId: 'kimi',
      planId: null,
      apiKey: 'sk-kimi',
      keyHeader: 'bearer',
      urls: { responses: 'https://api.moonshot.cn/v1' },
      models: ['kimi-k3'],
      cloud: null,
      own: null,
    }
    const codex = await resolveLaunch(
      { ...context(loginEnv), provider: kimi },
      'codex',
      project,
      null,
      { conversationId: 'thread-1', resume: true },
    )
    expect(codex.args).toEqual([
      ...program(bin, 'codex').args,
      'resume',
      'thread-1',
      '-c',
      'model_provider="hoot"',
      '-c',
      'model_providers.hoot={name="Kimi",base_url="https://api.moonshot.cn/v1",env_key="HOOT_CODEX_API_KEY",wire_api="responses"}',
      '--dangerously-bypass-approvals-and-sandbox',
      '--model',
      'kimi-k3',
      '-c',
      'model_reasoning_effort=high',
    ])
    expect(codex.env.HOOT_CODEX_API_KEY).toBe('sk-kimi')
    // On its subscription, OpenAI's provider, whatever the user's configuration names.
    const own = await resolveLaunch(
      { ...context(loginEnv), provider: ownProvider('codex') },
      'codex',
      project,
    )
    expect(own.args).toEqual([
      ...program(bin, 'codex').args,
      '-c',
      'model_provider="openai"',
      '--dangerously-bypass-approvals-and-sandbox',
    ])
    expect(own.env).not.toHaveProperty('HOOT_CODEX_API_KEY')
  })

  it("runs Claude Code on its session's provider, over the user's own, in its settings file", async () => {
    const loginEnv = { PATH: onPath(bin, '/usr/bin') }
    const kimi: Provider = {
      id: 'p-kimi',
      name: 'Kimi',
      presetId: 'kimi',
      planId: null,
      apiKey: 'sk-kimi',
      keyHeader: 'bearer',
      urls: { anthropic: 'https://api.moonshot.cn/anthropic' },
      models: ['kimi-k3.1-pro', 'kimi-k3'],
      cloud: null,
      own: null,
    }
    // The user's settings name another provider, with a variable this one does not set.
    const userVariables = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_CUSTOM_HEADERS']
    const folders: string[] = []
    const onKimi = await resolveLaunch(
      {
        ...context(loginEnv, { claude: { model: 'kimi-k3' } }),
        provider: kimi,
        claudeUserVariables: async (folder) => {
          folders.push(folder)
          return userVariables
        },
      },
      'claude',
      project,
    )
    // Those of the settings for the session's own folder.
    expect(folders).toEqual([project])
    expect(onKimi.args).toContain('kimi-k3')
    // The model it runs, over any the user's settings save, and the effort level it starts at.
    expect(writtenSettings().model).toBe('kimi-k3')
    expect(writtenSettings().effortLevel).toBe('high')
    expect(writtenSettings().env).toEqual({
      ANTHROPIC_BASE_URL: 'https://api.moonshot.cn/anthropic',
      ANTHROPIC_AUTH_TOKEN: 'sk-kimi',
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_MODEL: '',
      ANTHROPIC_SMALL_FAST_MODEL: '',
      ANTHROPIC_CUSTOM_HEADERS: '',
      ANTHROPIC_DEFAULT_FABLE_MODEL: 'kimi-k3',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'kimi-k3',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'kimi-k3',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'kimi-k3',
      CLAUDE_CODE_SUBAGENT_MODEL: 'kimi-k3',
      // Unset where models.dev does not tell them.
      CLAUDE_CODE_MAX_CONTEXT_TOKENS: '',
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: '',
      CLAUDE_CODE_ATTRIBUTION_HEADER: '0',
    })
    onKimi.cleanup?.()
    // Its default model is the provider's first; a key in Anthropic's own header goes as its API key.
    await resolveLaunch(
      { ...context(loginEnv), provider: { ...kimi, keyHeader: 'x-api-key' } },
      'claude',
      project,
    )
    expect(writtenSettings().env).toMatchObject({
      ANTHROPIC_API_KEY: 'sk-kimi',
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'kimi-k3.1-pro',
    })
    expect(writtenSettings().model).toBe('kimi-k3.1-pro')
    // On its subscription, every provider variable is unset, and none is set.
    await resolveLaunch(
      {
        ...context(loginEnv),
        provider: ownProvider('claude'),
        claudeUserVariables: async () => userVariables,
      },
      'claude',
      project,
    )
    const own = writtenSettings().env as Record<string, string>
    expect(Object.values(own).every((value) => value === '')).toBe(true)
    expect(own).toHaveProperty('ANTHROPIC_CUSTOM_HEADERS', '')
    expect(writtenSettings().model).toBe('')
    expect(writtenSettings()).not.toHaveProperty('effortLevel')
    // An agent on its own configuration, as a chat from before providers, gets none of it.
    await resolveLaunch(context(loginEnv), 'claude', project)
    expect(writtenSettings()).not.toHaveProperty('env')
    expect(writtenSettings()).not.toHaveProperty('model')
  })

  it("tells Claude Code its provider's model, its limits, effort levels and roles, as models.dev lists them", async () => {
    const loginEnv = { PATH: onPath(bin, '/usr/bin') }
    const bailian: Provider = {
      id: 'p-bailian',
      name: 'Bailian Plan',
      presetId: 'bailian-plan',
      planId: null,
      apiKey: 'sk-bailian',
      keyHeader: 'bearer',
      // At its plan's addresses, which tell its plan, and so the models.dev provider of its models.
      urls: {
        anthropic: 'https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic',
        responses: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
      },
      models: ['deepseek-v4.1-flash-1017', 'qwen3.8-max'],
      cloud: null,
      own: null,
    }
    // The models.dev provider of the plan the provider is on.
    const models: ModelCatalogs = {
      'alibaba-token-plan-cn': [
        {
          id: 'deepseek-v4.1-flash-1017',
          context: 1_000_000,
          output: 384_000,
          efforts: ['low', 'high', 'max'],
        },
        {
          id: 'qwen3.8-max',
          context: 983_616,
          output: 65_536,
          efforts: ['low', 'medium', 'xhigh'],
        },
      ],
    }
    const onBailian = (agent: Partial<AgentLaunchSettings>, modelMap = {}) =>
      resolveLaunch(
        {
          ...context(loginEnv, { claude: agent }),
          provider: bailian,
          modelMap,
          catalogs: () => models,
        },
        'claude',
        project,
      )

    const picked = await onBailian({ model: 'deepseek-v4.1-flash-1017' })
    expect(picked.args).toEqual(expect.arrayContaining(['--model', 'deepseek-v4.1-flash-1017']))
    expect(writtenSettings()).toMatchObject({
      model: 'deepseek-v4.1-flash-1017',
      effortLevel: 'high',
      env: {
        CLAUDE_CODE_MAX_CONTEXT_TOKENS: '1000000',
        CLAUDE_CODE_MAX_OUTPUT_TOKENS: '384000',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-v4.1-flash-1017[1m]',
      },
    })
    // Default runs the provider's first, named; one without `high` starts at the highest below it.
    await onBailian({}, { haiku: 'qwen3.8-max', subagent: 'qwen3.8-max' })
    expect(writtenSettings()).toMatchObject({
      model: 'deepseek-v4.1-flash-1017',
      env: {
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-v4.1-flash-1017[1m]',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'qwen3.8-max',
        CLAUDE_CODE_SUBAGENT_MODEL: 'qwen3.8-max',
      },
    })
    await onBailian({ model: 'qwen3.8-max' })
    expect(writtenSettings()).toMatchObject({
      model: 'qwen3.8-max',
      effortLevel: 'medium',
      env: { CLAUDE_CODE_MAX_CONTEXT_TOKENS: '983616', CLAUDE_CODE_MAX_OUTPUT_TOKENS: '65536' },
    })
    // An effort level of the agent's goes in its command, and none in its settings.
    const effort = await onBailian({ model: 'deepseek-v4.1-flash-1017', effort: 'max' })
    expect(effort.args).toEqual(expect.arrayContaining(['--effort', 'max']))
    expect(writtenSettings()).not.toHaveProperty('effortLevel')
  })

  it('leaves Claude Code its own roles and levels on Claude’s models at a Custom address', async () => {
    const loginEnv = { PATH: onPath(bin, '/usr/bin') }
    // A relay of Claude's models, with none of its own.
    const relay: Provider = {
      id: 'p-relay',
      name: 'Relay',
      presetId: null,
      planId: null,
      apiKey: 'sk-relay',
      keyHeader: 'bearer',
      urls: { anthropic: 'https://relay.example.com' },
      models: [],
      cloud: null,
      own: null,
    }
    const onRelay = (agent: Partial<AgentLaunchSettings>, modelMap = {}) =>
      resolveLaunch(
        {
          ...context(loginEnv, { claude: agent }),
          provider: relay,
          modelMap,
          leavesRoles: true,
          // Claude's models, which a Custom provider's Claude Code agents offer.
          catalogs: () => ({
            anthropic: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5'].map(
              (id): CatalogModel => ({
                id,
                context: 1_000_000,
                output: 128_000,
                efforts: ['low', 'high'],
              }),
            ),
          }),
        },
        'claude',
        project,
      )
    const picked = await onRelay({ model: 'claude-opus-5-5' }, { haiku: 'claude-haiku-4-5' })
    expect(picked.args).toEqual(expect.arrayContaining(['--model', 'claude-opus-5-5']))
    expect(writtenSettings()).toMatchObject({
      model: 'claude-opus-5-5',
      env: {
        ANTHROPIC_BASE_URL: 'https://relay.example.com',
        ANTHROPIC_DEFAULT_OPUS_MODEL: '',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-4-5[1m]',
        CLAUDE_CODE_SUBAGENT_MODEL: '',
      },
    })
    // Claude Code knows the levels of Claude's models, and of its own for a role.
    expect(writtenSettings()).not.toHaveProperty('effortLevel')
    // A session that picked an alias with /model runs Claude Code's own model of it.
    const resumed = await onRelay({ model: 'sonnet' })
    expect(resumed.args).toEqual(expect.arrayContaining(['--model', 'sonnet']))
    expect(writtenSettings()).toMatchObject({
      model: '',
      env: { ANTHROPIC_DEFAULT_SONNET_MODEL: '' },
    })
    expect(writtenSettings()).not.toHaveProperty('effortLevel')
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

    // Read again for each session, as Codex may change while Hoot runs. One
    // that takes it runs without its shared background server, which the
    // hook's setting keeps it from anyway.
    const versions = [
      ['codex-cli 0.163.0', ['--no-daemon']],
      ['codex-cli 0.156.0', ['--no-daemon']],
      ['codex-cli 0.155.0', []],
      ['codex-cli 0.148.0', []],
      ['codex-cli 0.149.0-alpha.1', []],
    ] as const
    for (const [version, daemon] of versions) {
      await says(version)
      expect((await resolveLaunch(context(loginEnv, agents), 'codex', project)).args).toEqual([
        ...codex.args,
        ...daemon,
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
    await says('codex-cli 0.172.0')
    const resumedOnNewer = await resolveLaunch(context(loginEnv), 'codex', project, null, {
      conversationId: 'thread-id',
      resume: true,
    })
    expect(resumedOnNewer.args).toEqual([
      ...codex.args,
      'resume',
      'thread-id',
      '--no-daemon',
      '--dangerously-bypass-approvals-and-sandbox',
      ...hookArguments,
    ])
    // Not twice, where the agent's own arguments have it.
    const ownDaemon = { codex: { extraArgs: ['--no-daemon'] } }
    expect((await resolveLaunch(context(loginEnv, ownDaemon), 'codex', project)).args).toEqual([
      ...codex.args,
      '--dangerously-bypass-approvals-and-sandbox',
      '--no-daemon',
      ...hookArguments,
    ])

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

  it("gives a Codex session on a provider of the user's a catalog of the provider's models", async () => {
    const folder = path.join(root, 'codex-catalog')
    const loginEnv = { PATH: onPath(folder, '/usr/bin') }
    const codex = program(folder, 'codex')
    const says = (text: string) =>
      writeNodeCommand(
        path.join(folder, 'codex'),
        `if (process.argv.includes('--version')) console.log(${JSON.stringify(text)})\n`,
      )
    const deepseek: Provider = {
      id: 'p-deepseek',
      name: 'DeepSeek',
      presetId: 'deepseek',
      planId: null,
      apiKey: 'sk-deepseek',
      keyHeader: 'bearer',
      urls: {
        anthropic: 'https://api.deepseek.com/anthropic',
        responses: 'https://api.deepseek.com',
      },
      models: ['deepseek-v4-pro', 'deepseek-v4-flash'],
      cloud: null,
      own: null,
    }
    const catalogs: ModelCatalogs = {
      deepseek: [
        { id: 'deepseek-v4-pro', context: 1_000_000, output: 384_000, efforts: ['high', 'max'] },
      ],
    }
    const own: CodexCatalogSupport = {
      own: [
        { slug: 'gpt-6-luna', visibility: 'list', priority: 7 },
        { slug: 'codex-auto-review', visibility: 'hide', priority: 0 },
        { slug: 'gpt-6.2-sol', display_name: 'GPT-6.2-Sol', visibility: 'list', priority: 1 },
      ],
    }
    const asked: string[] = []
    const on = (
      provider: Provider,
      {
        support = own,
        namesCatalog = false,
        model = null,
      }: {
        support?: CodexCatalogSupport | null
        namesCatalog?: boolean
        model?: string | null
      } = {},
    ) =>
      resolveLaunch(
        {
          ...context(loginEnv, { codex: { model } }),
          provider,
          catalogs: () => catalogs,
          codexCatalogSupport: async (command) => {
            asked.push(command)
            return support
          },
          codexNamesCatalog: async () => namesCatalog,
        },
        'codex',
        project,
      )
    const file = codexCatalogFilePath(settingsFolder(), hoot.sessionId)

    await says('codex-cli 0.163.0')
    const launch = await on(deepseek)
    expect(launch.args).toEqual([
      ...codex.args,
      '--no-daemon',
      '-c',
      'model_provider="hoot"',
      '-c',
      'model_providers.hoot={name="DeepSeek",base_url="https://api.deepseek.com",env_key="HOOT_CODEX_API_KEY",wire_api="responses"}',
      '-c',
      `model_catalog_json=${JSON.stringify(file)}`,
      '--dangerously-bypass-approvals-and-sandbox',
      '--model',
      'deepseek-v4-pro',
      '-c',
      'model_reasoning_effort=high',
      '-c',
      CODEX_HOOK_SETTING,
    ])
    expect(asked).toEqual([path.join(folder, 'codex')])
    const written = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      models: Array<Record<string, unknown>>
    }
    expect(written.models.map((entry) => entry.slug)).toEqual([
      'deepseek-v4-pro',
      'deepseek-v4-flash',
    ])
    expect(written.models[0]).toMatchObject({
      context_window: 1_000_000,
      default_reasoning_level: 'high',
    })
    launch.cleanup?.()
    expect(fs.existsSync(file)).toBe(false)

    // None on its subscription, whose catalog is Codex's own, unless the
    // user's configuration names one of its own, which Codex's own then
    // replaces, with the model Codex starts with on it, not the configuration's.
    const subscription = await on(ownProvider('codex'))
    expect(subscription.args.some((arg) => arg.startsWith('model_catalog_json='))).toBe(false)
    expect(asked).toHaveLength(1)
    const replaced = await on(ownProvider('codex'), { namesCatalog: true })
    expect(replaced.args).toEqual([
      ...codex.args,
      '--no-daemon',
      '-c',
      'model_provider="openai"',
      '-c',
      `model_catalog_json=${JSON.stringify(file)}`,
      '--dangerously-bypass-approvals-and-sandbox',
      '--model',
      'gpt-6.2-sol',
      '-c',
      CODEX_HOOK_SETTING,
    ])
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ models: own.own })
    replaced.cleanup?.()
    expect(fs.existsSync(file)).toBe(false)
    const picked = await on(ownProvider('codex'), { namesCatalog: true, model: 'gpt-6-luna' })
    expect(picked.args.slice(picked.args.indexOf('--model'))).toEqual([
      '--model',
      'gpt-6-luna',
      '-c',
      CODEX_HOOK_SETTING,
    ])
    picked.cleanup?.()
    expect(asked).toHaveLength(3)

    // None where Hoot read nothing of this Codex it takes, nor on a Codex before 0.163.
    const unread = await on(deepseek, { support: null })
    expect(unread.args.some((arg) => arg.startsWith('model_catalog_json='))).toBe(false)
    expect(unread.cleanup).toBeUndefined()
    await says('codex-cli 0.162.0')
    const older = await on(deepseek)
    expect(older.args.some((arg) => arg.startsWith('model_catalog_json='))).toBe(false)
    const olderSubscription = await on(ownProvider('codex'), { namesCatalog: true })
    expect(olderSubscription.args.some((arg) => arg.startsWith('model_catalog_json='))).toBe(false)
    expect(asked).toHaveLength(4)
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
      ...hookSettings(),
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
      ...hookSettings(),
    ])
    // Its cleanup removes its settings file alone.
    other.cleanup?.()
    expect(fs.existsSync(claudeSettingsFilePath(settingsFolder(), hoot.sessionId))).toBe(false)
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

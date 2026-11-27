import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { DatabaseSync } from 'node:sqlite'
import { app, BrowserWindow, Menu, nativeTheme, net, shell as desktop } from 'electron'
import { autoUpdater } from 'electron-updater'
import { ISSUE_WORKFLOW } from '../shared/built-in-workflow'
import { usableChatAgents } from '../shared/chats'
import { waitedOnIds } from '../shared/dependencies'
import { IpcChannel, type SessionCommand, type ToolsState } from '../shared/ipc'
import { defaultAgentLaunchSettings } from '../shared/launch-settings'
import { MODEL_EVENT, MODEL_SWITCH_EVENT } from '../shared/hoot-cli'
import {
  bareModel,
  catalogModelOf,
  issueAgent,
  openCodeSessionEffort,
  providerFormat,
  providerOfOpenCodeId,
} from '../shared/providers'
import { startBlockers } from '../shared/start-blockers'
import { toolStatus } from '../shared/tool-status'
import { getCodingTool, getTool, type CodingToolId } from '../shared/tools'
import {
  WINDOWS_LAYOUT_SWITCH,
  windowControlsArgument,
  windowControlsFor,
} from '../shared/window-controls'
import { systemFolders } from './agents/agent-command'
import { AgentService } from './agents/agent-service'
import { readClaudeLaunchOptions } from './agents/claude-options'
import { readCodexConfig, readCodexLaunchOptions } from './agents/codex-options'
import { readAntigravityLaunchOptions } from './agents/antigravity'
import { fetchAgentRelease } from './agents/latest-version'
import { fetchReleases } from './agents/releases'
import { readAgentVersion } from './agents/version'
import { readAppInfo } from './app-info'
import { buildAppMenu, buildDatabaseErrorMenu } from './app-menu'
import { ChatManager } from './chats/chat-manager'
import { localChatConversations } from './chats/conversations'
import { FileWatcher } from './files/file-watcher'
import { FolderAccess } from './files/folder-access'
import { databaseFile, openDatabase, transaction } from './database/database'
import { captureBaseEnv, type Env } from './env/env'
import { fallbackUtf8Locale, type TerminalEnvOptions } from './env/session-env'
import { gitEnvironment } from './git/git'
import { HootServer } from './hoot-cli/hoot-server'
import { hootCliSetup } from './hoot-cli/setup'
import { registerDatabaseErrorIpc, registerIpc } from './ipc'
import { IssueStore } from './issues/issue-store'
import { LabelStore } from './labels/label-store'
import { addProjectWithFirstCommit, inspectAddProject } from './projects/add-project'
import { ProjectFolders } from './projects/project-folders'
import { ProjectStore } from './projects/project-store'
import { claudeUserVariables } from './providers/claude-config'
import { readCodexCatalogSupport, type CodexCatalogSupport } from './providers/codex-catalog'
import {
  createOpenCodeSession,
  hootOpenCodeConfig,
  openCodeModelRef,
  readOpenCodeLaunchOptions,
  removeHootProviders,
  type OpenCodeServer,
} from './providers/opencode-config'
import { OpenCodeServers } from './providers/opencode-server'
import { ModelsDev } from './providers/models-dev'
import { ProviderService } from './providers/provider-service'
import { ProviderStore } from './providers/provider-store'
import { PtyHostClient } from './pty/pty-host-client'
import { QuitGuard } from './quit-guard'
import { agentCommandOf, resolveLaunch, type AgentLaunch, type ChatLaunch } from './session/launch'
import { antigravityHooksFolder } from './session/antigravity-hooks'
import { openCodePluginFolder } from './session/opencode-plugin'
import { SessionError, SessionManager } from './session/session-manager'
import { SessionStartRequests } from './session/session-starts'
import { AgentFollowStore } from './settings/agent-follow-store'
import { AppearanceStore } from './settings/appearance-store'
import { FilePanelStore } from './settings/file-panel-store'
import { IssueWindowStore } from './settings/issue-window-store'
import { LaunchSettingsStore } from './settings/launch-settings-store'
import { SidebarStateStore } from './settings/sidebar-state-store'
import { defaultShell } from './tools/default-shell'
import { findCommand } from './tools/find-command'
import { ToolService } from './tools/tool-service'
import { UpdateService } from './updates/update-service'
import { WorkflowExecutor } from './workflows/workflow-executor'
import { windowBackground } from './window-colors'
import { WorktreeLayout } from './worktrees/layout'
import { WorktreeService } from './worktrees/worktree-service'
import { WorktreeStore } from './worktrees/worktree-store'

// Captured before anything else can change it: sessions inherit this environment.
const baseEnv = captureBaseEnv()

const SHUTDOWN_TIMEOUT_MS = 4_000

const devServerUrl = process.env.VITE_DEV_SERVER_URL
app.setName('Hoot')
const userDataOverride = app.commandLine.getSwitchValue('user-data-dir')
if (userDataOverride) app.setPath('userData', path.resolve(userDataOverride))
// Runs from the repository keep their own data, apart from an installed Hoot,
// so that both can run at the same time.
else if (!app.isPackaged) app.setPath('userData', path.join(app.getPath('appData'), 'Hoot-dev'))
// What every session needs to run hoot, Hoot's command line program.
const hootCli = hootCliSetup({
  userData: app.getPath('userData'),
  packaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  appPath: app.getAppPath(),
  executable: process.execPath,
  mainDirectory: import.meta.dirname,
})
// The plugin Hoot gives OpenCode, which OpenCode loads from its folder.
const openCodePlugin = openCodePluginFolder({
  packaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  appPath: app.getAppPath(),
})
// The folder of the hooks Hoot gives Antigravity CLI, which it adds to the workspace.
const antigravityHooks = antigravityHooksFolder({
  packaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  appPath: app.getAppPath(),
})
const testHooks = app.commandLine.hasSwitch('test-hooks')
// For unattended runs: keep the window off screen until the user asks for it,
// so that Hoot never covers or takes focus from other apps.
const openInBackground = app.commandLine.hasSwitch('background')
// The window's own buttons: macOS's traffic lights, or those the page draws on
// Windows. With --windows-layout, macOS also leaves the room of the latter
// empty.
const windowControls = windowControlsFor(
  process.platform,
  app.commandLine.hasSwitch(WINDOWS_LAYOUT_SWITCH),
)

const shell = defaultShell(baseEnv)
const launchSettings = new LaunchSettingsStore(app.getPath('userData'))
const agentFollows = new AgentFollowStore(app.getPath('userData'))
const sidebar = new SidebarStateStore(app.getPath('userData'))
const filePanel = new FilePanelStore(app.getPath('userData'))
const issueWindow = new IssueWindowStore(app.getPath('userData'))
/** The open files and expanded folders of the file panel, which it follows. */
const fileWatcher = new FileWatcher()
const appearance = new AppearanceStore(app.getPath('userData'))
// The appearance picked in the settings, macOS's until one is picked. Applied
// before the window opens, so that its background and its first paint have
// it already, as have the menus and dialogs macOS draws for Hoot.
nativeTheme.themeSource = appearance.appearance
appearance.on('changed', (picked) => {
  nativeTheme.themeSource = picked
})
const tools = new ToolService({
  shell: shell.file,
  baseEnv,
  cwd: os.homedir(),
  home: os.homedir(),
})
const ptyHost = new PtyHostClient(path.join(import.meta.dirname, '../pty-host/index.js'))

let terminalOptions: TerminalEnvOptions | null = null
/**
 * Where the settings of each Claude Code session and the catalog of each
 * Codex session go, a file each, which go with their sessions; those a Hoot
 * that did not quit left behind go as Hoot starts.
 */
const sessionSettingsFolder = path.join(app.getPath('userData'), 'session-settings')
/**
 * The models of the providers Hoot knows, as models.dev lists them, read
 * through Electron's network stack, which takes the system's proxy settings.
 */
const modelsDev = new ModelsDev({
  file: path.join(app.getPath('userData'), 'models-dev.json'),
  fetch: (url, init) => net.fetch(url, init),
})
/**
 * The servers of OpenCode's Hoot runs for its OpenCode sessions on providers,
 * which take the user's providers from Hoot's file, beside the user's own
 * configuration, which Hoot leaves alone.
 */
const openCodeServers = new OpenCodeServers({
  configFile: path.join(app.getPath('userData'), 'opencode', 'opencode.json'),
  config: () =>
    hootOpenCodeConfig(providerService?.getState().providers ?? [], modelsDev.catalogs()),
  stateFile: path.join(app.getPath('userData'), 'opencode-servers.json'),
  cwd: os.homedir(),
})
/** Writes Hoot's configuration of OpenCode again, for the servers that run (see `OpenCodeServers`). */
function writeOpenCodeConfig(): void {
  openCodeServers
    .configChanged()
    .catch((error: unknown) =>
      console.error("Could not write Hoot's OpenCode configuration:", error),
    )
}
const sessions: SessionManager = new SessionManager({
  host: ptyHost,
  resolveLaunch: async (toolId, cwd, issue, givenChat, agent, sessionId) => {
    const agentVersion = launchVersions()
    const { chat, server } =
      toolId === 'opencode'
        ? await openCodeLaunch(cwd, givenChat, agent, sessionId, agentVersion)
        : { chat: givenChat, server: null }
    return resolveLaunch(
      {
        shell,
        baseEnv,
        home: os.homedir(),
        follow: (tool) => agentFollows.get(tool),
        terminal: () =>
          (terminalOptions ??= {
            appVersion: app.getVersion(),
            fallbackLang: fallbackUtf8Locale(),
          }),
        getLoginEnvironment: () => tools.getLoginEnvironment(),
        agentVersion,
        launchSettings: () => ({
          yoloMode: launchSettings.all().yoloMode,
          agent: agent?.settings ?? defaultAgentLaunchSettings(),
        }),
        provider: agent?.provider ?? null,
        modelMap: agent?.modelMap ?? {},
        leavesRoles: agent?.leavesRoles ?? false,
        claudeUserVariables: async (folder) =>
          claudeUserVariables(os.homedir(), (await tools.getLoginEnvironment()).env, folder),
        catalogs: () => modelsDev.catalogs(),
        codexCatalogSupport,
        codexNamesCatalog: async (env) => (await readCodexConfig(env, os.homedir())).hasCatalog,
        settingsFolder: sessionSettingsFolder,
        hoot: { ...hootCli, sessionId },
        openCodePlugin,
        antigravityHooks,
        openCodeServer: server,
      },
      toolId,
      cwd,
      issue,
      chat,
    )
  },
})

/** How long Hoot waits for an agent to say its version before its session starts. */
const LAUNCH_VERSION_TIMEOUT_MS = 10_000

/** What reads the version an agent's command reports, as a session starts. */
type AgentVersionReader = (tool: CodingToolId, command: string, env: Env) => Promise<string | null>

/**
 * What reads the versions of the agents' commands for one session as it
 * starts (see `readAgentVersion`), once for each command: read again for
 * each session, as an agent may change while Hoot runs, as by its own
 * updater, also where its command is a file that stays the same, as a
 * version manager's.
 */
function launchVersions(): AgentVersionReader {
  const read = new Map<string, Promise<string | null>>()
  return (tool, command, env) => {
    let version = read.get(command)
    if (version === undefined) {
      version = readAgentVersion(
        tool,
        command,
        env,
        os.homedir(),
        process.platform,
        LAUNCH_VERSION_TIMEOUT_MS,
      ).then((reading) => reading.version)
      read.set(command, version)
    }
    return version
  }
}

/**
 * What Hoot read of each Codex its sessions ran for their catalogs, by the
 * command and the file it leads to, which an update replaces.
 */
const codexCatalogSupports = new Map<string, Promise<CodexCatalogSupport | null>>()

/**
 * What Hoot read of the Codex at `command` for the catalogs of its sessions
 * (see `readCodexCatalogSupport`), once for each Codex: one it could not
 * read is read again for the next session.
 */
async function codexCatalogSupport(command: string, env: Env): Promise<CodexCatalogSupport | null> {
  const file = await fs.promises.stat(command).catch(() => null)
  const key = `${command}\n${file?.mtimeMs ?? ''}\n${file?.size ?? ''}`
  let support = codexCatalogSupports.get(key)
  if (support === undefined) {
    support = readCodexCatalogSupport(command, env).then((read) => {
      if (read === null) codexCatalogSupports.delete(key)
      return read
    })
    codexCatalogSupports.set(key, support)
  }
  return support
}

/**
 * Takes out of OpenCode's own configuration the providers an earlier Hoot
 * wrote into it (see `removeHootProviders`), once a run of Hoot's, before its
 * first server of OpenCode starts, which takes that configuration too.
 */
let openCodeConfigCleaned: Promise<void> | null = null
function cleanOpenCodeConfig(env: Env): Promise<void> {
  openCodeConfigCleaned ??= removeHootProviders(env, os.homedir()).then(
    () => {},
    (error: unknown) => console.error("Could not tidy OpenCode's configuration:", error),
  )
  return openCodeConfigCleaned
}

/**
 * What an OpenCode session opens, and where: on a provider, Hoot's server of
 * OpenCode (see `OpenCodeServers`), with the conversation its chat goes on
 * with, or a new one, which Hoot makes first on that server on the provider
 * and model, with the effort level as the variant (see
 * `openCodeSessionEffort`), and records as its chat's; OpenCode then opens it
 * with `-s`, as one it continues. A chat made before providers opens its
 * conversation with OpenCode's background service, as before. Where Hoot
 * cannot start its server or make the conversation, an agent on OpenCode's
 * free models opens a new conversation of OpenCode's with that service, as
 * before Hoot had providers; one on a provider of the user's does not start,
 * nor any where OpenCode is not installed or is older than Hoot works with
 * (see `agentCommandOf`), which starts no server.
 */
async function openCodeLaunch(
  cwd: string,
  chat: ChatLaunch | null,
  agent: AgentLaunch | null,
  sessionId: string,
  agentVersion: AgentVersionReader,
): Promise<{ chat: ChatLaunch | null; server: OpenCodeServer | null }> {
  const provider = agent?.provider ?? null
  if (provider === null || agent === null) return { chat, server: null }
  const login = await tools.getLoginEnvironment()
  const command = await agentCommandOf(
    getCodingTool('opencode'),
    login.env,
    os.homedir(),
    (found) => agentVersion('opencode', found, login.env),
  )
  let server: OpenCodeServer
  try {
    await cleanOpenCodeConfig(login.env)
    // Its own updater is off while OpenCode follows anything but its latest version.
    server = await openCodeServers.ensure(
      command,
      agentFollows.get('opencode').kind === 'latest'
        ? login.env
        : { ...login.env, OPENCODE_DISABLE_AUTOUPDATE: '1' },
    )
  } catch (error) {
    if (provider.own !== null) {
      console.error("Could not start Hoot's server of OpenCode; it uses its own:", error)
      return { chat, server: null }
    }
    throw new SessionError(
      `Could not start OpenCode: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (chat?.resume === true) return { chat, server }
  const catalogs = modelsDev.catalogs()
  const model = openCodeModelRef(provider, agent.settings.model, catalogs)
  const format = providerFormat(provider, 'opencode')
  const variant =
    provider.own !== null || format === null
      ? agent.settings.effort
      : openCodeSessionEffort(
          agent.settings.effort,
          catalogModelOf(catalogs, 'opencode', provider, model.slice(model.indexOf('/') + 1)),
          format,
        )
  let conversationId: string
  try {
    conversationId = await createOpenCodeSession(command, login.env, server, cwd, model, variant)
  } catch (error) {
    if (provider.own !== null) {
      console.error("Could not make OpenCode's conversation; it makes its own:", error)
      return { chat, server }
    }
    throw new SessionError(
      `Could not start OpenCode's conversation: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const chatId = sessions.chatIdOf(sessionId) ?? sessions.savedSessionIdOf(sessionId)
  if (chatId !== null) chatManager?.giveConversation(chatId, conversationId)
  return { chat: { ...chat, conversationId, resume: true }, server }
}

const agents = new AgentService({
  detectTools: () => tools.detectWithEnvironment(),
  getLoginEnvironment: () => tools.getLoginEnvironment(),
  home: os.homedir(),
  // Through Electron's network stack, which takes the system's proxy settings.
  latestRelease: (tool) => fetchAgentRelease(tool, (url, init) => net.fetch(url, init)),
  releases: (tool, npmPackage, command) =>
    fetchReleases(tool, npmPackage, command, (url, init) => net.fetch(url, init)),
  follows: agentFollows,
  systemFolders: systemFolders(),
  runningSessions: (id) => sessions.runningIdsOf(id),
  // Hoot's servers of OpenCode run its program too.
  closeSessions: async (id) => {
    await sessions.closeAllOf(id)
    if (id === 'opencode') await openCodeServers.stopAll()
  },
  launchOptions: async (tool, detection) => {
    const { env } = detection.login
    if (tool === 'opencode') {
      // One older than Hoot works with is not asked: it starts no session.
      const command = detection.state.tools.find((entry) => entry.id === 'opencode')?.path
      return command && toolStatus(detection.state, getTool('opencode')) === 'available'
        ? readOpenCodeLaunchOptions(command, env, os.homedir())
        : null
    }
    if (tool === 'claude') {
      return readClaudeLaunchOptions({ home: os.homedir(), env })
    }
    const command = detection.state.tools.find((entry) => entry.id === tool)?.path
    if (!command) return { models: [], defaultEfforts: [], defaultModel: null, defaultEffort: null }
    if (tool === 'antigravity') {
      return readAntigravityLaunchOptions({ command, env, home: os.homedir() })
    }
    return readCodexLaunchOptions({ command, env, home: os.homedir() })
  },
})

let mainWindow: BrowserWindow | null = null
const getWindow = () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null)

/** Answers hoot in the sessions, once the database is open. */
let hootServer: HootServer | null = null

/** The chats, once the database is open. */
let chatManager: ChatManager | null = null

/** The providers and agents, once the database is open. */
let providerService: ProviderService | null = null

/**
 * Brings the window forward so the user can answer a question in it. In the
 * background the window is left as it is; the question waits inside it.
 */
function presentWindow(window: BrowserWindow): void {
  if (openInBackground) return
  window.show()
  window.focus()
}

/** Shows the main window, opening a new one if it was closed, when the user asks for Hoot. */
function showMainWindow(): void {
  const window = getWindow()
  if (!window) {
    mainWindow = createMainWindow({ reveal: true })
    return
  }
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

const quitGuard = new QuitGuard({
  getWindow,
  presentWindow,
  runningSessionCount: () => sessions.runningCount(),
  endSessions: () => sessions.endAll(),
  agentOperations: () => agents.pendingOperations(),
  stopAgentOperations: () => agents.stopAll(),
  resumeAgentOperations: () => agents.resume(),
  // Keeping a running session must not leave Hoot without a window.
  onCancel: () => {
    if (!getWindow()) mainWindow = createMainWindow({ reveal: !openInBackground })
  },
})

// Only a Hoot installed from a release updates itself: electron-builder puts
// the file that says where the releases are only in the apps its installers
// hold, not in the one `pnpm app:package` builds.
const updates = new UpdateService({
  updater:
    app.isPackaged && fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))
      ? autoUpdater
      : null,
  restart: (install) => quitGuard.restartToUpdate(install),
})
// Should restarting into the update fail, Hoot keeps running, and installs
// and updates of agents, stopped for the restart, can run again.
updates.on('failed', () => quitGuard.updateFailed())

// Only said on Windows, where PATH is what it was when Hoot started: there is
// no login shell to read it from again, so a git installed since is found
// once Hoot starts again.
const GIT_NOT_FOUND =
  'Git was not found on PATH. Install it from https://git-scm.com, then restart Hoot.'

/**
 * Where git is: on PATH, as the login shell or Hoot itself has it, or else
 * /usr/bin/git, which macOS always has. Windows has no such place: `null`
 * when it is not on PATH there.
 */
async function gitExecutable(): Promise<string | null> {
  const login = await tools.getLoginEnvironment()
  return (
    (await findCommand('git', login.env)) ??
    (await findCommand('git', baseEnv)) ??
    (process.platform === 'win32' ? null : '/usr/bin/git')
  )
}

/** The worktrees of the projects in the list; started with the database, which keeps their names. */
let worktrees: WorktreeService | null = null

/** The own folders of the projects in the list, followed once the database is open. */
let projectFolders: ProjectFolders | null = null

/** How to run git for the projects: where it is, and the login shell environment it gets. */
async function projectGit(): Promise<{ git: string; env: ReturnType<typeof gitEnvironment> }> {
  const git = await gitExecutable()
  if (git === null) throw new Error(GIT_NOT_FOUND)
  return { git, env: gitEnvironment((await tools.getLoginEnvironment()).env) }
}

/** Opens the main window; `reveal` shows it once its first paint is ready. */
function createMainWindow(options: { reveal: boolean }): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 720,
    minHeight: 480,
    title: 'Hoot',
    // No title bar: the page takes the whole window. The traffic lights
    // (x 15–75, y 16–30) sit in the middle of the page's 46px top row, which
    // leaves them room. On Windows, the page draws the minimize, maximize and
    // close buttons at the right end of the row, and a window without a title
    // bar has no menu bar either.
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 15, y: 16 },
    show: false,
    backgroundColor: windowBackground(nativeTheme.shouldUseDarkColors),
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      additionalArguments: [
        ...(testHooks ? ['--hoot-test-hooks'] : []),
        windowControlsArgument(windowControls),
      ],
    },
  })
  // A window that is never shown still renders, so unattended runs can use it.
  if (options.reveal) window.once('ready-to-show', () => window.show())
  window.on('close', (event) => quitGuard.intercept(event))
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })
  // The worktrees are not watched: a worktree added or removed outside Hoot
  // shows within a second, while other changes, such as a worktree's folder
  // deleted, show when the window gets the focus. The projects' own folders
  // are looked at all the time, and again then.
  window.on('focus', () => {
    worktrees?.refreshAll()
    projectFolders?.refreshAll()
  })
  // A session shown while the window is the active one counts as seen.
  window.on('focus', () => window.webContents.send(IpcChannel.windowFocusChanged, true))
  window.on('blur', () => window.webContents.send(IpcChannel.windowFocusChanged, false))
  // In full screen macOS hides the traffic lights, and the page moves its
  // navigation into their place.
  window.on('enter-full-screen', () => window.webContents.send(IpcChannel.fullScreenChanged, true))
  window.on('leave-full-screen', () => window.webContents.send(IpcChannel.fullScreenChanged, false))
  // The page draws the window's buttons on Windows, and shows the maximize or
  // the restore one as the window is.
  window.on('maximize', () => window.webContents.send(IpcChannel.windowMaximizedChanged, true))
  window.on('unmaximize', () => window.webContents.send(IpcChannel.windowMaximizedChanged, false))
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())

  if (devServerUrl) void window.loadURL(devServerUrl)
  else void window.loadFile(path.join(import.meta.dirname, '../../dist/index.html'))
  return window
}

// The window's colors follow the appearance in effect, also when macOS
// changes its appearance while Hoot follows it: its background.
nativeTheme.on('updated', () => {
  const window = getWindow()
  if (!window) return
  window.setBackgroundColor(windowBackground(nativeTheme.shouldUseDarkColors))
})

/**
 * Opens the database, which holds the projects and their issues; or says why
 * it cannot, leaving its file as it was.
 */
function tryOpenDatabase(
  file: string,
): { kind: 'opened'; database: DatabaseSync } | { kind: 'failed'; message: string } {
  try {
    return { kind: 'opened', database: openDatabase(file) }
  } catch (error) {
    return { kind: 'failed', message: error instanceof Error ? error.message : String(error) }
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // What a Hoot that did not quit left behind: the files of its sessions, and
  // its servers of OpenCode. Only the one Hoot that runs may take them.
  fs.rmSync(sessionSettingsFolder, { recursive: true, force: true })
  void openCodeServers.stopLeftOver()
  // Starting Hoot again shows the window, unless that start is unattended too.
  app.on('second-instance', (_event, argv) => {
    if (!argv.includes('--background')) showMainWindow()
  })

  app.on('before-quit', (event) => quitGuard.intercept(event))
  app.on('window-all-closed', () => app.quit())

  // Before exiting, end the sessions and stop the pty host so that no session
  // process outlives Hoot.
  let shutDown = false
  app.on('will-quit', (event) => {
    if (shutDown) return
    event.preventDefault()
    worktrees?.dispose()
    projectFolders?.dispose()
    fileWatcher.dispose()
    const shutdown = (async () => {
      // Also when Hoot quits without asking, as on SIGTERM.
      await agents.stopAll()
      // hoot then says that Hoot is not running.
      await hootServer?.stop()
      await sessions.endAll()
      // Once its sessions ended, as their windows connect to it.
      await openCodeServers.stopAll()
      // What the agents recorded before they ended, such as a new conversation.
      await chatManager?.flush()
      await ptyHost.stop()
    })()
    void Promise.race([shutdown, delay(SHUTDOWN_TIMEOUT_MS)]).finally(() => {
      shutDown = true
      // Quit from a new task: quitting again while Electron is still handling
      // this event would be ignored.
      setTimeout(() => app.quit(), 0)
    })
  })

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      quitGuard.allow()
      app.quit()
    })
  }

  // The panel macOS shows for About Hoot while the database cannot be opened
  // and there is no About page to show.
  app.setAboutPanelOptions({ applicationName: 'Hoot', applicationVersion: app.getVersion() })

  const databasePath = databaseFile(app.getPath('userData'))
  const opened = tryOpenDatabase(databasePath)
  if (opened.kind === 'opened') startWithDatabase(opened.database)
  else startWithoutDatabase(databasePath, opened.message)
}

/** Starts Hoot with its projects, sessions and issues. */
function startWithDatabase(database: DatabaseSync): void {
  const projects = new ProjectStore(database)
  const issues = new IssueStore(database)
  const labels = new LabelStore(database)
  const providers = new ProviderService({ store: new ProviderStore(database) })
  providerService = providers
  // Electron's network stack works once the app is ready.
  void app.whenReady().then(() => modelsDev.start())
  const chats = new ChatManager({
    db: database,
    conversations: localChatConversations({
      home: os.homedir(),
      getLoginEnvironment: () => tools.getLoginEnvironment(),
    }),
    // The folder of a deleted chat goes where the user can still find it.
    trash: (folder) => desktop.trashItem(folder),
  })
  chatManager = chats
  // Agents are made by hand: what an earlier Hoot kept for its coding tools,
  // before agents, goes.
  launchSettings.dropLegacy()
  // OpenCode's own configuration loses the providers an earlier Hoot wrote
  // into it, once OpenCode is found installed.
  const tidyOpenCode = (state: ToolsState) => {
    if (state.detecting || !state.tools.some((tool) => tool.id === 'opencode' && tool.available)) {
      return
    }
    void tools.getLoginEnvironment().then(({ env }) => cleanOpenCodeConfig(env))
  }
  tools.on('changed', tidyOpenCode)
  tidyOpenCode(tools.getState())
  // Hoot's servers of OpenCode take the user's providers as they are, each
  // window picking among them with `/models`, with what models.dev tells of
  // their models.
  providers.on('changed', writeOpenCodeConfig)
  modelsDev.on('changed', writeOpenCodeConfig)
  // A deleted default agent leaves none: the first usable agent stands in.
  providers.on('removed', (id) => {
    if (launchSettings.all().defaultAgent === id) launchSettings.setDefaultAgent(null)
  })
  // Worktrees live in the home directory, not in the user data directory, so
  // that an installed Hoot and one run from its repository share them; their
  // names come from the database.
  const worktreeService = new WorktreeService({
    layout: new WorktreeLayout(path.join(os.homedir(), '.hoot', 'worktrees'), os.homedir()),
    records: new WorktreeStore(database),
    gitContext: projectGit,
    keeping: {
      // Those in the project's own folder belong to no worktree.
      savedSessionPaths: (root) =>
        chats
          .listSavedSessions()
          .flatMap((saved) =>
            saved.projectRoot === root && saved.worktreePath !== null ? [saved.worktreePath] : [],
          ),
      collapsedPaths: () => sidebar.collapsedWorktrees,
      hasOpenSessions: (root, worktreePath) => sessions.hasOpenIn(root, worktreePath),
    },
  })
  worktrees = worktreeService
  const folders = new ProjectFolders({ gitContext: projectGit })
  projectFolders = folders
  // A worktree that is gone is cleaned up once the last of its open sessions closes.
  sessions.on('closed', (session) => {
    if (session.chatId === null && session.worktreePath !== null) {
      worktreeService.sessionClosed(session.projectRoot, session.worktreePath)
    }
  })
  // Puts the workflow's group of labels in place, before anything reads the labels; none while
  // no workflow runs.
  const workflows =
    ISSUE_WORKFLOW === null ? null : new WorkflowExecutor(database, ISSUE_WORKFLOW, labels)
  // hoot's sessions, which the window starts as an issue's start button does.
  const sessionStarts = new SessionStartRequests((request) => {
    const window = getWindow()
    if (!window) return false
    window.webContents.send(IpcChannel.sessionStartRequested, request)
    return true
  })
  // Only projects in the list are kept collapsed, so that a project added later is expanded.
  sidebar.retainProjects(projects.list().map((project) => project.id))
  registerIpc({
    getWindow,
    appInfo: readAppInfo({
      version: app.getVersion(),
      platform: process.platform,
      systemVersion: process.getSystemVersion(),
      arch: process.arch,
      versions: process.versions,
    }),
    projects,
    issues,
    labels,
    tools,
    agents,
    launchSettings,
    providers,
    models: modelsDev,
    sidebar,
    filePanel,
    issueWindow,
    folderAccess: new FolderAccess({
      isProject: (root) => projects.find(root) !== undefined,
      isWorktreeOf: (root, worktreePath) => worktreeService.isWorktreeOf(root, worktreePath),
    }),
    fileWatcher,
    appearance,
    sessions,
    chats,
    quitGuard,
    updates,
    worktrees: worktreeService,
    projectFolders: folders,
    workflows,
    sessionStarts,
    inspectProjectFolder: async (directory) => {
      try {
        return await inspectAddProject(directory, await projectGit())
      } catch (error) {
        return {
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        }
      }
    },
    initializeProject: async (folder, mode) => {
      try {
        return await addProjectWithFirstCommit(folder, mode, await projectGit())
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        }
      }
    },
  })

  // The chats follow the events of their agents' sessions: the conversation
  // Claude Code, Codex or OpenCode sends a message in, and what an ended
  // process left in the agent's records.
  sessions.on('hook-event', (id, report) => {
    const chatId = sessions.chatIdOf(id) ?? sessions.savedSessionIdOf(id)
    if (chatId !== null) chats.noteHookEvent(chatId, report)
    // A model picked with `/model` in a Claude Code session: its chat goes on
    // with it when it is opened again. Claude Code also saves it in the
    // user's settings, which Hoot leaves as they are: its other sessions
    // each name their own model.
    if (report.event === MODEL_SWITCH_EVENT) {
      const chat = chatId === null ? undefined : chats.get(chatId)
      if (chat !== undefined && chat.providerId !== null && typeof report.model === 'string') {
        chats.setProvider(chat.id, chat.providerId, report.model)
      }
      return
    }
    // The model a message in a Codex session went to, when another than the
    // one its chat runs, as `/model` may have switched to: the chat goes on
    // with it when it is opened again. As with Claude Code, Codex also saves
    // a model picked with `/model` in the user's own configuration, which
    // Hoot leaves as it is.
    if (report.event === 'UserPromptSubmit' && !report.subagent) {
      const chat = chatId === null ? undefined : chats.get(chatId)
      if (
        chat !== undefined &&
        chat.toolId === 'codex' &&
        chat.providerId !== null &&
        typeof report.model === 'string'
      ) {
        const agent = chat.agentId === null ? undefined : providers.agent(chat.agentId)
        const runs = chat.model ?? agent?.model ?? null
        if (runs === null || bareModel(runs) !== report.model) {
          chats.setProvider(chat.id, chat.providerId, report.model)
        }
      }
    }
    // A model picked in an OpenCode session, as with `/models`: the session
    // and its chat go on with its provider, when it is one of Hoot's.
    if (report.event === MODEL_EVENT && typeof report.provider === 'string') {
      const providerId = providerOfOpenCodeId(report.provider)
      if (providerId === null || providers.provider(providerId) === undefined) return
      sessions.setProvider(id, providerId)
      if (chatId !== null) chats.setProvider(chatId, providerId, report.model ?? null)
    }
  })
  // The commands that leave a conversation for another, such as `/new`, for
  // the name a chat shows once its agent reports the next one.
  sessions.on('input', (id, data) => {
    const chatId = sessions.chatIdOf(id) ?? sessions.savedSessionIdOf(id)
    if (chatId !== null) chats.typed(chatId, id, data)
  })
  sessions.on('updated', (session) => chats.sessionEnded(session))
  // What happened while Hoot was not running: conversations it has not seen
  // yet, and chats whose conversation never got a message.
  void chats.reconcileAll()

  hootServer = new HootServer({
    address: hootCli.socket,
    hasSession: (sessionId) => sessions.projectRootOf(sessionId) !== null,
    sessionProject: (sessionId) => {
      const root = sessions.projectRootOf(sessionId)
      if (root === null) {
        return {
          ok: false,
          message:
            'This session is not open in Hoot: it has been closed, or Hoot has started again since.',
        }
      }
      const project = projects.find(root)
      return project
        ? { ok: true, project }
        : { ok: false, message: "The session's project is no longer in Hoot's list." }
    },
    listProjects: () => projects.list(),
    issues,
    labels,
    together: (body) => transaction(database, body),
    // The window shows it at once, and nothing else changes there.
    issueCreated: (issue) => getWindow()?.webContents.send(IpcChannel.issueCreated, issue),
    // As the issue's start button tells them.
    startBlockers: (issue) =>
      startBlockers(
        tools.getState(),
        issue,
        waitedOnIds(
          new Map(issues.list().map((shown) => [shown.id, shown])),
          issues.dependencies().links,
          issue.id,
        ),
        workflows?.progress(issue.id) ?? { kind: 'not-started' },
        issueAgent(
          usableChatAgents(tools.getState(), providers.getState()),
          launchSettings.all().defaultAgent,
        ) !== null,
      ),
    startSession: (issueId, prompt) => sessionStarts.request(issueId, prompt),
    hookEvent: (sessionId, report) => sessions.reportHookEvent(sessionId, report),
  })
  hootServer.start().catch((error: unknown) => {
    console.error(`Could not listen for hoot on ${hootCli.socket}:`, error)
  })

  const sendSessionCommand = (command: SessionCommand) =>
    getWindow()?.webContents.send(IpcChannel.sessionCommand, command)

  /**
   * Sets the menu bar, again whenever the sidebar or the file panel is shown
   * or hidden: their items' labels say which.
   */
  const updateApplicationMenu = () =>
    Menu.setApplicationMenu(
      buildAppMenu({
        includeDeveloperItems: Boolean(devServerUrl),
        showAbout: () => getWindow()?.webContents.send(IpcChannel.showAboutRequested),
        showSettings: () => getWindow()?.webContents.send(IpcChannel.showSettingsRequested),
        addProject: () => getWindow()?.webContents.send(IpcChannel.addProjectRequested),
        newChat: () => sendSessionCommand('new-chat'),
        closeSession: () => sendSessionCommand('close-current'),
        selectNextSession: () => sendSessionCommand('select-next'),
        selectPreviousSession: () => sendSessionCommand('select-previous'),
        goBack: () => sendSessionCommand('back'),
        goForward: () => sendSessionCommand('forward'),
        sidebarOpen: sidebar.open,
        toggleSidebar: () => getWindow()?.webContents.send(IpcChannel.toggleSidebarRequested),
        filePanelOpen: filePanel.layout.open,
        toggleFilePanel: () => getWindow()?.webContents.send(IpcChannel.toggleFilePanelRequested),
      }),
    )

  void app.whenReady().then(() => {
    updateApplicationMenu()
    sidebar.on('changed', updateApplicationMenu)
    filePanel.on('changed', updateApplicationMenu)
    mainWindow = createMainWindow({ reveal: !openInBackground })
    // Clicking the Dock icon shows the window, also after a background start.
    app.on('activate', showMainWindow)
    void tools.detect()
    worktreeService.setProjects(projects.list().map((project) => project.root))
    folders.setProjects(projects.list().map((project) => project.root))
    updates.start()
  })
}

/**
 * Starts Hoot without its database, which could not be opened: the window
 * only says why and where the file is, and offers to show it in Finder (File
 * Explorer on Windows) or to quit. Nothing else starts, and the file is left as it is. It shows in the
 * appearance picked in the settings, which cannot be changed until Hoot
 * starts with its database.
 */
function startWithoutDatabase(databasePath: string, error: string): void {
  console.error(`Could not open the database ${databasePath}: ${error}`)
  registerDatabaseErrorIpc({ getWindow, databasePath, message: error })
  void app.whenReady().then(() => {
    Menu.setApplicationMenu(buildDatabaseErrorMenu())
    mainWindow = createMainWindow({ reveal: !openInBackground })
    app.on('activate', showMainWindow)
  })
}

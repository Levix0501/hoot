import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { DatabaseSync } from 'node:sqlite'
import { app, BrowserWindow, Menu, nativeTheme, net } from 'electron'
import { autoUpdater } from 'electron-updater'
import { ISSUE_WORKFLOW } from '../shared/built-in-workflow'
import { waitedOnIds } from '../shared/dependencies'
import { IpcChannel, type SessionCommand } from '../shared/ipc'
import { startBlockers } from '../shared/start-blockers'
import {
  WINDOWS_LAYOUT_SWITCH,
  windowControlsArgument,
  windowControlsFor,
} from '../shared/window-controls'
import { AgentService } from './agents/agent-service'
import { fetchLatestRelease } from './agents/latest-version'
import { readAppInfo } from './app-info'
import { buildAppMenu, buildDatabaseErrorMenu } from './app-menu'
import { databaseFile, openDatabase, transaction } from './database/database'
import { captureBaseEnv } from './env/env'
import { fallbackUtf8Locale, type TerminalEnvOptions } from './env/session-env'
import { gitEnvironment } from './git/git'
import { HootServer } from './hoot-cli/hoot-server'
import { hootCliSetup } from './hoot-cli/setup'
import { registerDatabaseErrorIpc, registerIpc } from './ipc'
import { IssueStore } from './issues/issue-store'
import { LabelStore } from './labels/label-store'
import { resolveProjectRoot } from './projects/project-root'
import { ProjectStore } from './projects/project-store'
import { PtyHostClient } from './pty/pty-host-client'
import { QuitGuard } from './quit-guard'
import { resolveLaunch } from './session/launch'
import { SessionManager } from './session/session-manager'
import { SessionStartRequests } from './session/session-starts'
import { AppearanceStore } from './settings/appearance-store'
import { PermissionLevelStore } from './settings/permission-level-store'
import { SidebarStateStore } from './settings/sidebar-state-store'
import { defaultShell } from './tools/default-shell'
import { findCommand } from './tools/find-command'
import { ToolService } from './tools/tool-service'
import { UpdateService } from './updates/update-service'
import { WorkflowExecutor } from './workflows/workflow-executor'
import { titleBarOverlay, windowBackground } from './window-colors'
import { WorktreeLayout } from './worktrees/layout'
import { WorktreeService } from './worktrees/worktree-service'

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
const testHooks = app.commandLine.hasSwitch('test-hooks')
// For unattended runs: keep the window off screen until the user asks for it,
// so that Hoot never covers or takes focus from other apps.
const openInBackground = app.commandLine.hasSwitch('background')
// The window's own buttons: macOS's traffic lights, or those Windows draws.
// With --windows-layout, macOS also leaves the room of the latter empty.
const windowControls = windowControlsFor(
  process.platform,
  app.commandLine.hasSwitch(WINDOWS_LAYOUT_SWITCH),
)

const shell = defaultShell(baseEnv)
const permissionLevels = new PermissionLevelStore(app.getPath('userData'))
const sidebar = new SidebarStateStore(app.getPath('userData'))
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
})
const ptyHost = new PtyHostClient(path.join(import.meta.dirname, '../pty-host/index.js'))

let terminalOptions: TerminalEnvOptions | null = null
const sessions = new SessionManager({
  host: ptyHost,
  resolveLaunch: (toolId, cwd, issue, sessionId, permissionLevel) =>
    resolveLaunch(
      {
        shell,
        baseEnv,
        terminal: () =>
          (terminalOptions ??= {
            appVersion: app.getVersion(),
            fallbackLang: fallbackUtf8Locale(),
          }),
        getLoginEnvironment: () => tools.getLoginEnvironment(),
        permissionLevel: (tool) => permissionLevels.level(tool),
        hoot: { ...hootCli, sessionId },
      },
      toolId,
      cwd,
      issue,
      permissionLevel,
    ),
})

const agents = new AgentService({
  detectTools: () => tools.detectWithEnvironment(),
  getLoginEnvironment: () => tools.getLoginEnvironment(),
  home: os.homedir(),
  // Through Electron's network stack, which takes the system's proxy settings.
  latestRelease: (npmPackage, command) =>
    fetchLatestRelease(npmPackage, command, (url, init) => net.fetch(url, init)),
  runningSessions: (id) => sessions.runningIdsOf(id),
})

let mainWindow: BrowserWindow | null = null
const getWindow = () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null)

/** Answers hoot in the sessions, once the database is open. */
let hootServer: HootServer | null = null

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

// Worktrees live in the home directory, not in the user data directory, so
// that an installed Hoot and one run from its repository share them.
const worktrees = new WorktreeService({
  layout: new WorktreeLayout(path.join(os.homedir(), '.hoot', 'worktrees'), os.homedir()),
  gitContext: async () => {
    const git = await gitExecutable()
    if (git === null) throw new Error(GIT_NOT_FOUND)
    return { git, env: gitEnvironment((await tools.getLoginEnvironment()).env) }
  },
})

/** Opens the main window; `reveal` shows it once its first paint is ready. */
function createMainWindow(options: { reveal: boolean }): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 720,
    minHeight: 480,
    title: 'Hoot',
    // No title bar: the page takes the whole window. The traffic lights
    // (x 15–75, y 15–29) sit in the middle of the page's 44px top row, which
    // leaves them room. On Windows, Windows draws its minimize, maximize and
    // close buttons over the right end of the row instead, and a window
    // without a title bar has no menu bar either.
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 15, y: 15 },
    ...(windowControls === 'overlay'
      ? { titleBarOverlay: titleBarOverlay(nativeTheme.shouldUseDarkColors) }
      : {}),
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
  // Nothing is watched: what changed outside Hoot, such as a worktree's
  // folder deleted, shows when the window gets the focus.
  window.on('focus', () => worktrees.refreshAll())
  // A session shown while the window is the active one counts as seen.
  window.on('focus', () => window.webContents.send(IpcChannel.windowFocusChanged, true))
  window.on('blur', () => window.webContents.send(IpcChannel.windowFocusChanged, false))
  // In full screen macOS hides the traffic lights, and the page moves its
  // navigation into their place.
  window.on('enter-full-screen', () => window.webContents.send(IpcChannel.fullScreenChanged, true))
  window.on('leave-full-screen', () => window.webContents.send(IpcChannel.fullScreenChanged, false))
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())

  if (devServerUrl) void window.loadURL(devServerUrl)
  else void window.loadFile(path.join(import.meta.dirname, '../../dist/index.html'))
  return window
}

// The window's colors follow the appearance in effect, also when macOS
// changes its appearance while Hoot follows it: its background, and on
// Windows the buttons Windows draws.
nativeTheme.on('updated', () => {
  const window = getWindow()
  if (!window) return
  window.setBackgroundColor(windowBackground(nativeTheme.shouldUseDarkColors))
  if (windowControls === 'overlay') {
    window.setTitleBarOverlay(titleBarOverlay(nativeTheme.shouldUseDarkColors))
  }
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
    worktrees.dispose()
    const shutdown = (async () => {
      // Also when Hoot quits without asking, as on SIGTERM.
      await agents.stopAll()
      // hoot then says that Hoot is not running.
      await hootServer?.stop()
      await sessions.endAll()
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
  // Puts the workflow's group of labels in place, before anything reads the labels.
  const workflows = new WorkflowExecutor(database, ISSUE_WORKFLOW, labels)
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
    permissionLevels,
    sidebar,
    appearance,
    sessions,
    quitGuard,
    updates,
    worktrees,
    workflows,
    sessionStarts,
    resolveProjectRoot: async (directory) => {
      const git = await gitExecutable()
      if (git === null) return { kind: 'error', message: GIT_NOT_FOUND }
      return resolveProjectRoot(directory, { git, env: (await tools.getLoginEnvironment()).env })
    },
  })

  hootServer = new HootServer({
    address: hootCli.socket,
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
        workflows.progress(issue.id),
      ),
    startSession: (issueId, prompt) => sessionStarts.request(issueId, prompt),
    hookEvent: (sessionId, event) => sessions.reportHookEvent(sessionId, event),
  })
  hootServer.start().catch((error: unknown) => {
    console.error(`Could not listen for hoot on ${hootCli.socket}:`, error)
  })

  const sendSessionCommand = (command: SessionCommand) =>
    getWindow()?.webContents.send(IpcChannel.sessionCommand, command)

  /** Sets the menu bar, again whenever the sidebar is shown or hidden: its item's label says which. */
  const updateApplicationMenu = () =>
    Menu.setApplicationMenu(
      buildAppMenu({
        includeDeveloperItems: Boolean(devServerUrl),
        showAbout: () => getWindow()?.webContents.send(IpcChannel.showAboutRequested),
        showSettings: () => getWindow()?.webContents.send(IpcChannel.showSettingsRequested),
        addProject: () => getWindow()?.webContents.send(IpcChannel.addProjectRequested),
        closeSession: () => sendSessionCommand('close-current'),
        selectNextSession: () => sendSessionCommand('select-next'),
        selectPreviousSession: () => sendSessionCommand('select-previous'),
        goBack: () => sendSessionCommand('back'),
        goForward: () => sendSessionCommand('forward'),
        sidebarOpen: sidebar.open,
        toggleSidebar: () => getWindow()?.webContents.send(IpcChannel.toggleSidebarRequested),
        selected: permissionLevels.all(),
        selectPermissionLevel: (tool, level) => permissionLevels.select(tool, level),
      }),
    )

  void app.whenReady().then(() => {
    updateApplicationMenu()
    sidebar.on('changed', updateApplicationMenu)
    mainWindow = createMainWindow({ reveal: !openInBackground })
    // Clicking the Dock icon shows the window, also after a background start.
    app.on('activate', showMainWindow)
    void tools.detect()
    worktrees.setProjects(projects.list().map((project) => project.root))
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

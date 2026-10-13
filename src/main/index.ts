import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { DatabaseSync } from 'node:sqlite'
import { app, BrowserWindow, Menu, nativeTheme } from 'electron'
import { IpcChannel, type SessionCommand } from '../shared/ipc'
import {
  WINDOWS_LAYOUT_SWITCH,
  windowControlsArgument,
  windowControlsFor,
} from '../shared/window-controls'
import { buildAppMenu, buildDatabaseErrorMenu } from './app-menu'
import { databaseFile, openDatabase } from './database/database'
import { captureBaseEnv } from './env/env'
import {
  fallbackUtf8Locale,
  type HootCliEnvOptions,
  type TerminalEnvOptions,
} from './env/session-env'
import { gitEnvironment } from './git/git'
import { hootSocketPath } from './hoot-cli/address'
import { HootServer } from './hoot-cli/hoot-server'
import { registerDatabaseErrorIpc, registerIpc } from './ipc'
import { IssueStore } from './issues/issue-store'
import { resolveProjectRoot } from './projects/project-root'
import { ProjectStore } from './projects/project-store'
import { PtyHostClient } from './pty/pty-host-client'
import { QuitGuard } from './quit-guard'
import { resolveLaunch } from './session/launch'
import { SessionManager } from './session/session-manager'
import { AppearanceStore } from './settings/appearance-store'
import { PermissionLevelStore } from './settings/permission-level-store'
import { SidebarStateStore } from './settings/sidebar-state-store'
import { findCommand } from './tools/find-command'
import { ToolService } from './tools/tool-service'
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
// What every session needs to run hoot, Hoot's command line program: the
// folder of its launchers, which goes first on PATH; Hoot's own executable,
// which runs its script as Node.js; the script; and where this Hoot listens
// for it, which depends on the user data directory, so that each session's
// hoot reaches the Hoot that started it.
const hootCli: Omit<HootCliEnvOptions, 'sessionId'> = {
  binDirectory: app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(app.getAppPath(), 'resources', 'bin'),
  node: process.execPath,
  script: path.join(import.meta.dirname, '../cli/index.js'),
  socket: hootSocketPath(app.getPath('userData')),
}
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

function defaultShell(): string {
  const candidates = [baseEnv.SHELL, os.userInfo().shell, '/bin/zsh']
  for (const candidate of candidates) {
    if (candidate && path.isAbsolute(candidate) && fs.existsSync(candidate)) return candidate
  }
  return '/bin/sh'
}

const shell = defaultShell()
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
const tools = new ToolService({ shell, baseEnv, cwd: os.homedir() })
const ptyHost = new PtyHostClient(path.join(import.meta.dirname, '../pty-host/index.js'))

let terminalOptions: TerminalEnvOptions | null = null
const sessions = new SessionManager({
  host: ptyHost,
  resolveLaunch: (toolId, cwd, issue, sessionId) =>
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
        temporaryFolder: app.getPath('temp'),
        hoot: { ...hootCli, sessionId },
      },
      toolId,
      cwd,
      issue,
    ),
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
  // Keeping a running session must not leave Hoot without a window.
  onCancel: () => {
    if (!getWindow()) mainWindow = createMainWindow({ reveal: !openInBackground })
  },
})

async function gitExecutable(): Promise<string> {
  const login = await tools.getLoginEnvironment()
  return (
    (await findCommand('git', login.env.PATH)) ??
    (await findCommand('git', baseEnv.PATH)) ??
    '/usr/bin/git'
  )
}

// Worktrees live in the home directory, not in the user data directory, so
// that an installed Hoot and one run from its repository share them.
const worktrees = new WorktreeService({
  layout: new WorktreeLayout(path.join(os.homedir(), '.hoot', 'worktrees'), os.homedir()),
  gitContext: async () => ({
    git: await gitExecutable(),
    env: gitEnvironment((await tools.getLoginEnvironment()).env),
  }),
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
  // Only projects in the list are kept collapsed, so that a project added later is expanded.
  sidebar.retainProjects(projects.list().map((project) => project.id))
  registerIpc({
    getWindow,
    projects,
    issues,
    tools,
    permissionLevels,
    sidebar,
    appearance,
    sessions,
    quitGuard,
    worktrees,
    resolveProjectRoot: async (directory) =>
      resolveProjectRoot(directory, {
        git: await gitExecutable(),
        env: (await tools.getLoginEnvironment()).env,
      }),
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
    issues,
    // The window shows it at once, and nothing else changes there.
    issueCreated: (issue) => getWindow()?.webContents.send(IpcChannel.issueCreated, issue),
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
  })
}

/**
 * Starts Hoot without its database, which could not be opened: the window
 * only says why and where the file is, and offers to show it in Finder or to
 * quit. Nothing else starts, and the file is left as it is. It shows in the
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

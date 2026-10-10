import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { app, BrowserWindow, Menu, nativeTheme } from 'electron'
import { IpcChannel, type SessionCommand } from '../shared/ipc'
import { buildAppMenu } from './app-menu'
import { captureBaseEnv } from './env/env'
import { fallbackUtf8Locale, type TerminalEnvOptions } from './env/session-env'
import { gitEnvironment } from './git/git'
import { registerIpc } from './ipc'
import { resolveProjectRoot } from './projects/project-root'
import { ProjectStore } from './projects/project-store'
import { PtyHostClient } from './pty/pty-host-client'
import { QuitGuard } from './quit-guard'
import { resolveLaunch } from './session/launch'
import { SessionManager } from './session/session-manager'
import { PermissionLevelStore } from './settings/permission-level-store'
import { SidebarStateStore } from './settings/sidebar-state-store'
import { findCommand } from './tools/find-command'
import { ToolService } from './tools/tool-service'
import { WorktreeLayout } from './worktrees/layout'
import { WorktreeService } from './worktrees/worktree-service'

// Captured before anything else can change it: sessions inherit this environment.
const baseEnv = captureBaseEnv()

const LIGHT_BACKGROUND = '#ffffff'
const DARK_BACKGROUND = '#0a0a0a'
const SHUTDOWN_TIMEOUT_MS = 4_000

const devServerUrl = process.env.VITE_DEV_SERVER_URL
app.setName('Hoot')
const userDataOverride = app.commandLine.getSwitchValue('user-data-dir')
if (userDataOverride) app.setPath('userData', path.resolve(userDataOverride))
// Runs from the repository keep their own data, apart from an installed Hoot,
// so that both can run at the same time.
else if (!app.isPackaged) app.setPath('userData', path.join(app.getPath('appData'), 'Hoot-dev'))
const testHooks = app.commandLine.hasSwitch('test-hooks')
// For unattended runs: keep the window off screen until the user asks for it,
// so that Hoot never covers or takes focus from other apps.
const openInBackground = app.commandLine.hasSwitch('background')

function defaultShell(): string {
  const candidates = [baseEnv.SHELL, os.userInfo().shell, '/bin/zsh']
  for (const candidate of candidates) {
    if (candidate && path.isAbsolute(candidate) && fs.existsSync(candidate)) return candidate
  }
  return '/bin/sh'
}

const shell = defaultShell()
const projects = new ProjectStore(app.getPath('userData'))
const permissionLevels = new PermissionLevelStore(app.getPath('userData'))
const sidebar = new SidebarStateStore(app.getPath('userData'))
const tools = new ToolService({ shell, baseEnv, cwd: os.homedir() })
const ptyHost = new PtyHostClient(path.join(import.meta.dirname, '../pty-host/index.js'))

let terminalOptions: TerminalEnvOptions | null = null
const sessions = new SessionManager({
  host: ptyHost,
  resolveLaunch: (toolId, cwd) =>
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
      },
      toolId,
      cwd,
    ),
})

let mainWindow: BrowserWindow | null = null
const getWindow = () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null)

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
    // leaves them room.
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 15, y: 15 },
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? DARK_BACKGROUND : LIGHT_BACKGROUND,
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      additionalArguments: testHooks ? ['--hoot-test-hooks'] : [],
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

nativeTheme.on('updated', () => {
  getWindow()?.setBackgroundColor(
    nativeTheme.shouldUseDarkColors ? DARK_BACKGROUND : LIGHT_BACKGROUND,
  )
})

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // Starting Hoot again shows the window, unless that start is unattended too.
  app.on('second-instance', (_event, argv) => {
    if (!argv.includes('--background')) showMainWindow()
  })

  registerIpc({
    getWindow,
    projects,
    tools,
    permissionLevels,
    sidebar,
    sessions,
    quitGuard,
    worktrees,
    resolveProjectRoot: async (directory) =>
      resolveProjectRoot(directory, {
        git: await gitExecutable(),
        env: (await tools.getLoginEnvironment()).env,
      }),
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

  const sendSessionCommand = (command: SessionCommand) =>
    getWindow()?.webContents.send(IpcChannel.sessionCommand, command)

  /** Sets the menu bar, again whenever the sidebar is shown or hidden: its item's label says which. */
  const updateApplicationMenu = () =>
    Menu.setApplicationMenu(
      buildAppMenu({
        includeDeveloperItems: Boolean(devServerUrl),
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

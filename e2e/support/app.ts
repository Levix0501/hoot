import type { ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import type { ToolId } from '../../src/shared/tools'
import { Screenshot, type GridPixels } from './pixels'
import type { World } from './world'

export const repoRoot = path.resolve(import.meta.dirname, '../..')
const mainEntry = path.join(repoRoot, 'dist-electron/main/index.js')

/**
 * Characters allowed in the English text Hoot itself shows: printable ASCII,
 * common English typography and the symbols of the Mac's modifier keys.
 */
const NON_ENGLISH = /[^\x20-\x7E…–—·’“”⌘⇧⌥⌃]/u

export interface TerminalCell {
  chars: string
  width: number
}

export interface CellBox {
  x: number
  y: number
  width: number
  height: number
}

/** An item of the application menu as the menu bar shows it. */
export interface MenuEntry {
  label: string
  role: string | null
  type: string
  checked: boolean
  enabled: boolean
  visible: boolean
  /** Its keyboard shortcut, including the default one of a role item. */
  accelerator: string | null
  submenu: MenuEntry[] | null
}

/** Where the start of a session is waited for. */
type SessionStart = 'running' | 'started'

export interface LaunchOptions {
  /** Physical pixels per CSS pixel the window renders with, instead of its display's. */
  deviceScaleFactor?: 1 | 2
  /** More Chromium switches, such as `--disable-gpu`. */
  switches?: string[]
  /**
   * Project roots in the list when Hoot starts, as if added before. Unlike
   * adding them in the window, this shows no message over the terminal.
   */
  projects?: string[]
}

/** Drives one running Hoot instance. */
export class AppDriver {
  private constructor(
    readonly electronApp: ElectronApplication,
    readonly page: Page,
    readonly world: World,
    /** The main process; kept because Playwright forgets it once the app exits. */
    readonly mainProcess: ChildProcess,
  ) {}

  static async launch(world: World, options: LaunchOptions = {}): Promise<AppDriver> {
    if (!fs.existsSync(mainEntry)) throw new Error('Build the app first: pnpm build')
    if (options.projects) {
      fs.writeFileSync(
        path.join(world.userData, 'projects.json'),
        JSON.stringify({ projects: options.projects.map((root) => ({ root })) }),
      )
    }
    const electronApp = await electron.launch({
      // Launched like `electron .` so the app reads its name and version from package.json.
      args: [
        repoRoot,
        `--user-data-dir=${world.userData}`,
        '--test-hooks',
        // Keep the window off screen: never cover or take focus from the user's apps.
        '--background',
        // Keep rendering although the window is never shown.
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        // Screenshots show colors as sRGB values, without converting them for the display.
        '--force-color-profile=srgb',
        ...(options.deviceScaleFactor === undefined
          ? []
          : [`--force-device-scale-factor=${options.deviceScaleFactor}`]),
        ...(options.switches ?? []),
      ],
      env: world.env,
      cwd: world.root,
      // Let the page see the appearance Electron reports instead of Playwright's light default.
      colorScheme: null,
    })
    const mainProcess = electronApp.process()
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByTestId('add-project')).toBeVisible()
    if (options.projects) {
      await expect(page.getByTestId('project-item')).toHaveCount(options.projects.length)
    }
    return new AppDriver(electronApp, page, world, mainProcess)
  }

  get mainPid(): number {
    const pid = this.mainProcess.pid
    if (pid === undefined) throw new Error('No main process pid')
    return pid
  }

  get exited(): boolean {
    return this.mainProcess.exitCode !== null || this.mainProcess.signalCode !== null
  }

  /** Test teardown: quits without asking for confirmation. */
  async close(): Promise<void> {
    if (this.exited) return
    await this.electronApp
      .evaluate(({ app }) => {
        process.emit('SIGTERM')
        setTimeout(() => app.exit(0), 5_000)
      })
      .catch(() => undefined)
    await this.waitForExit()
  }

  async waitForExit(timeoutMs = 15_000): Promise<number | null> {
    if (!this.exited) {
      await once(this.mainProcess, 'exit', { signal: AbortSignal.timeout(timeoutMs) })
    }
    return this.mainProcess.exitCode
  }

  /** What Cmd+Q does: the Quit menu item asks the application to quit. */
  async quit(): Promise<void> {
    await this.electronApp.evaluate(({ app }) => {
      setTimeout(() => app.quit(), 0)
    })
  }

  /** What the window's close button does. */
  async closeWindow(): Promise<void> {
    await this.electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      setTimeout(() => window?.close(), 0)
    })
  }

  async setWindowSize(width: number, height: number): Promise<void> {
    await this.electronApp.evaluate(
      ({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]!.setSize(w!, h!),
      [width, height],
    )
  }

  /** Sets the window's size and waits until the page has it and the layout has settled. */
  async resizeWindow(width: number, height: number): Promise<void> {
    await this.setWindowSize(width, height)
    await expect
      .poll(() => this.page.evaluate(() => [window.innerWidth, window.innerHeight]))
      .toEqual([width, height])
    await this.settle()
  }

  /** Makes the window emit one of its events, as when macOS changes it, without changing the window. */
  async emitWindowEvent(event: 'enter-full-screen' | 'leave-full-screen'): Promise<void> {
    await this.electronApp.evaluate(({ BrowserWindow }, name) => {
      BrowserWindow.getAllWindows()[0]!.emit(name)
    }, event)
  }

  /** Waits until no CSS transition runs, such as the sidebar's slide. */
  async settle(): Promise<void> {
    await expect
      .poll(() =>
        this.page.evaluate(
          () =>
            document
              .getAnimations()
              .filter((animation) => animation instanceof CSSTransition)
              .filter((animation) => animation.playState === 'running').length,
        ),
      )
      .toBe(0)
  }

  /** The sidebar's root element, which says whether it is expanded or collapsed. */
  sidebar() {
    return this.page.locator('[data-slot="sidebar"]')
  }

  /** `expanded` or `collapsed`. */
  async sidebarState(): Promise<string | null> {
    return this.sidebar().getAttribute('data-state')
  }

  /** Waits until the sidebar has slid into the given state. */
  async expectSidebar(state: 'expanded' | 'collapsed'): Promise<void> {
    await expect(this.sidebar()).toHaveAttribute('data-state', state)
    await this.settle()
  }

  /** The main area: the current session or the empty page. */
  mainArea() {
    return this.page.locator('[data-slot="sidebar-inset"]')
  }

  /** The current session's header. */
  sessionHeader() {
    return this.page.locator('[data-testid="session"] header')
  }

  /** The navigation's buttons: the sidebar's trigger, Back and Forward. */
  toggleSidebarButton() {
    return this.page.getByTestId('toggle-sidebar')
  }

  backButton() {
    return this.page.getByTestId('go-back')
  }

  forwardButton() {
    return this.page.getByTestId('go-forward')
  }

  /** The contents of `settings.json` in the user data directory. */
  settings(): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(path.join(this.world.userData, 'settings.json'), 'utf8'))
  }

  /** Makes the next folder selection return `directory` instead of showing the system dialog. */
  async chooseDirectoryNext(directory: string): Promise<void> {
    await this.electronApp.evaluate(({ dialog }, selected) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [selected],
      })) as typeof dialog.showOpenDialog
    }, directory)
  }

  async addProject(directory: string): Promise<void> {
    await this.chooseDirectoryNext(directory)
    await this.page.getByTestId('add-project').click()
  }

  toasts(text: string) {
    return this.page.locator('[data-sonner-toast]', { hasText: text })
  }

  projectItems() {
    return this.page.getByTestId('project-item')
  }

  projectItem(root: string) {
    return this.page.locator(`[data-testid="project-item"][data-project-root="${root}"]`)
  }

  async projectRoots(): Promise<string[]> {
    return this.projectItems().evaluateAll((items) =>
      items.map((item) => item.getAttribute('data-project-root') ?? ''),
    )
  }

  newSessionButton(root: string) {
    return this.projectItem(root).getByTestId('new-session-button')
  }

  toolItem(tool: ToolId) {
    return this.page.getByTestId(`tool-${tool}`)
  }

  /** The tool's name in the new session menu. */
  toolLabel(tool: ToolId) {
    return this.page.getByTestId(`tool-label-${tool}`)
  }

  /** The permission level shown next to the tool in the new session menu. */
  toolPermissionLevel(tool: ToolId) {
    return this.page.getByTestId(`tool-permission-level-${tool}`)
  }

  async openToolMenu(root: string): Promise<void> {
    // A menu that is still closing (for example after starting a session) goes away first.
    await expect(this.page.locator('[role="menu"][data-closed]')).toHaveCount(0)
    await expect(async () => {
      if (!(await this.toolItem('shell').isVisible())) {
        await this.newSessionButton(root).click({ timeout: 5_000 })
      }
      await expect(this.toolItem('shell')).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 30_000 })
  }

  async closeMenus(): Promise<void> {
    await this.page.keyboard.press('Escape')
    await expect(this.page.locator('[role="menu"]')).toHaveCount(0)
  }

  /** Opens the New Session submenu of the project row's context menu. */
  async openContextToolMenu(root: string): Promise<void> {
    await expect(this.page.locator('[role="menu"][data-closed]')).toHaveCount(0)
    await expect(async () => {
      if (!(await this.toolItem('shell').isVisible())) {
        if (!(await this.page.getByTestId('context-new-session').isVisible())) {
          await this.projectItem(root).click({ button: 'right', timeout: 5_000 })
        }
        await this.page.getByTestId('context-new-session').click({ timeout: 5_000 })
      }
      await expect(this.toolItem('shell')).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 30_000 })
  }

  /**
   * Starts a session from the project's new session menu (the "+" button, or
   * with `from: 'context-menu'` the row's context menu) and returns its id.
   * By default waits until its process runs (or has already exited).
   */
  async startSession(
    root: string,
    tool: ToolId,
    options: { waitFor?: SessionStart; from?: 'button' | 'context-menu' } = {},
  ): Promise<string> {
    const before = new Set(await this.sessionIds())
    const started = async () => (await this.sessionIds()).find((id) => !before.has(id))
    // Retried in case the menu closes before the click lands.
    await expect(async () => {
      if (!(await started())) {
        if (options.from === 'context-menu') await this.openContextToolMenu(root)
        else await this.openToolMenu(root)
        await expect(this.toolItem(tool)).not.toHaveAttribute('data-disabled')
        await this.toolItem(tool).click({ timeout: 5_000 })
      }
      expect(await started()).toBeDefined()
    }).toPass({ timeout: 30_000 })
    const id = (await started())!
    if ((options.waitFor ?? 'running') === 'running') {
      // A process that exits normally right away closes its session.
      await expect
        .poll(async () => {
          const item = this.sessionItem(id)
          return (await item.count()) === 0 ? 'closed' : await item.getAttribute('data-status')
        })
        .toMatch(/^(running|exited|closed)$/)
    }
    return id
  }

  /** The id of the current session, or `null` when there is none. */
  async currentSessionId(): Promise<string | null> {
    const session = this.session()
    if ((await session.count()) === 0) return null
    return session.getAttribute('data-session-id')
  }

  /** The current session: its header, terminal and ended-session bar. */
  session() {
    return this.page.getByTestId('session')
  }

  async sessionId(): Promise<string> {
    return (await this.session().getAttribute('data-session-id')) ?? ''
  }

  /** The session rows of the sidebar, or of one project. */
  sessionItems(root?: string) {
    return root === undefined
      ? this.page.getByTestId('session-item')
      : this.page
          .locator(`[data-testid="session-list"][data-project-root="${root}"]`)
          .getByTestId('session-item')
  }

  sessionItem(id: string) {
    return this.page.locator(`[data-testid="session-item"][data-session-id="${id}"]`)
  }

  /** The ids of the sessions in sidebar order, or of one project's sessions. */
  async sessionIds(root?: string): Promise<string[]> {
    return this.sessionItems(root).evaluateAll((items) =>
      items.map((item) => item.getAttribute('data-session-id') ?? ''),
    )
  }

  /** The name a session row shows. */
  sessionItemName(id: string) {
    return this.sessionItem(id).getByTestId('session-item-name')
  }

  /** Shows a session by clicking its row. */
  async selectSession(id: string): Promise<void> {
    await this.sessionItem(id).getByTestId('session-item-button').click()
    await expect(this.session()).toHaveAttribute('data-session-id', id)
  }

  /** Opens a session row's context menu. */
  async openSessionMenu(id: string): Promise<void> {
    await this.sessionItem(id).getByTestId('session-item-button').click({ button: 'right' })
    await expect(this.page.getByTestId('session-context-close')).toBeVisible()
  }

  closeSessionDialog() {
    return this.page.getByTestId('close-session-dialog')
  }

  /** Closes a running session with the close button of its row and confirms. */
  async closeSession(id: string): Promise<void> {
    await this.sessionItem(id).hover()
    await this.sessionItem(id).getByTestId('session-item-close').click()
    await expect(this.closeSessionDialog()).toBeVisible()
    await this.page.getByTestId('close-session-confirm').click()
    await expect(this.sessionItem(id)).toHaveCount(0)
  }

  /** Lines of a session's terminal buffer (by default the current session's), including scrollback, with wrapped rows joined. */
  async terminalLines(sessionId?: string): Promise<string[]> {
    return this.page.evaluate((id) => {
      const hooks = window.hootTestHooks
      const terminal = id === undefined ? hooks?.terminal : hooks?.terminalOf(id)
      if (!terminal) return []
      const buffer = terminal.buffer.active
      const lines: string[] = []
      for (let index = 0; index < buffer.length; index++) {
        const line = buffer.getLine(index)
        if (!line) continue
        const text = line.translateToString(true)
        if (line.isWrapped && lines.length > 0) lines[lines.length - 1] += text
        else lines.push(text)
      }
      return lines
    }, sessionId)
  }

  async terminalText(sessionId?: string): Promise<string> {
    return (await this.terminalLines(sessionId)).join('\n')
  }

  async waitForTerminalText(
    pattern: RegExp | string,
    timeout = 15_000,
    sessionId?: string,
  ): Promise<void> {
    await expect
      .poll(
        async () => {
          const text = await this.terminalText(sessionId)
          return typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text)
        },
        { timeout },
      )
      .toBe(true)
  }

  /** Waits until the line at the cursor is an empty shell prompt. */
  async waitForPrompt(timeout = 20_000, sessionId?: string): Promise<void> {
    await expect
      .poll(() => this.cursorLine(sessionId), { timeout })
      .toBe(this.world.prompt.trimEnd())
  }

  async cursorLine(sessionId?: string): Promise<string> {
    return this.page.evaluate((id) => {
      const hooks = window.hootTestHooks
      const terminal = id === undefined ? hooks?.terminal : hooks?.terminalOf(id)
      if (!terminal) return ''
      const buffer = terminal.buffer.active
      const line = buffer.getLine(buffer.baseY + buffer.cursorY)?.translateToString(true) ?? ''
      return line.trimEnd()
    }, sessionId)
  }

  async focusTerminal(): Promise<void> {
    await this.page.evaluate(() => window.hootTestHooks?.terminal?.focus())
  }

  /**
   * Types text with the keyboard. By default it first puts the focus in the
   * current terminal; with `focus: false` the text goes wherever the focus is.
   */
  async type(text: string, options: { focus?: boolean } = {}): Promise<void> {
    if (options.focus ?? true) await this.focusTerminal()
    await this.page.keyboard.type(text)
  }

  /**
   * Types a command at the prompt of the current session, waits until the
   * shell has echoed all of it, runs it, and by default waits for the next
   * prompt. With `focus: false` the keys go wherever the focus is, so the
   * command is only echoed if the current terminal has it.
   */
  async run(
    command: string,
    options: { waitForPrompt?: boolean; focus?: boolean } = {},
  ): Promise<void> {
    const commandLine = `${this.world.prompt}${command}`.trimEnd()
    await this.type(command, { focus: options.focus })
    // The cursor row holds the end of the echoed command line (long lines span several rows).
    await expect
      .poll(async () => {
        const row = await this.cursorLine()
        return row.length > 0 && commandLine.endsWith(row)
      })
      .toBe(true)
    await this.page.keyboard.press('Enter')
    if (options.waitForPrompt ?? true) await this.waitForPrompt()
  }

  /** Output lines printed after the last occurrence of the given command line. */
  async outputOf(command: string, sessionId?: string): Promise<string[]> {
    const lines = await this.terminalLines(sessionId)
    const commandLine = `${this.world.prompt}${command}`
    let start = -1
    lines.forEach((line, index) => {
      if (line === commandLine || line === commandLine.trimEnd()) start = index
    })
    if (start === -1) return []
    const output: string[] = []
    for (const line of lines.slice(start + 1)) {
      if (line.startsWith(this.world.prompt.trimEnd())) break
      output.push(line)
    }
    return output
  }

  /** Runs `echo $$` in the current session's shell and returns the shell's pid. */
  async shellPid(): Promise<number> {
    const command = 'echo "shell-pid:$$"'
    await this.run(command)
    const line = (await this.outputOf(command)).find((entry) => entry.startsWith('shell-pid:'))
    return Number(line?.slice('shell-pid:'.length))
  }

  async cell(row: number, column: number): Promise<TerminalCell | null> {
    return this.page.evaluate(
      ([y, x]) => {
        const cell = window.hootTestHooks?.terminal?.buffer.active.getLine(y!)?.getCell(x!)
        return cell ? { chars: cell.getChars(), width: cell.getWidth() } : null
      },
      [row, column],
    )
  }

  /** Index of the last buffer line whose text equals `text`. */
  async findLine(text: string): Promise<number> {
    return this.page.evaluate((wanted) => {
      const buffer = window.hootTestHooks!.terminal!.buffer.active
      for (let index = buffer.length - 1; index >= 0; index--) {
        if (buffer.getLine(index)?.translateToString(true) === wanted) return index
      }
      return -1
    }, text)
  }

  async terminalSize(): Promise<{ cols: number; rows: number }> {
    return this.page.evaluate(() => {
      const terminal = window.hootTestHooks!.terminal!
      return { cols: terminal.cols, rows: terminal.rows }
    })
  }

  /** Size of one character cell, of the area the terminal is fitted into and of its scrollbar. */
  async terminalGeometry(): Promise<{
    cellWidth: number
    cellHeight: number
    areaWidth: number
    areaHeight: number
    scrollbarWidth: number
  }> {
    return this.page.evaluate(() => {
      const screen = document.querySelector<HTMLElement>('[data-testid="terminal"] .xterm-screen')!
      const terminal = window.hootTestHooks!.terminal!
      const area = document
        .querySelector<HTMLElement>('[data-testid="terminal"]')!
        .getBoundingClientRect()
      const box = screen.getBoundingClientRect()
      return {
        cellWidth: box.width / terminal.cols,
        cellHeight: box.height / terminal.rows,
        areaWidth: area.width,
        areaHeight: area.height,
        scrollbarWidth: terminal.options.scrollbar?.width ?? 0,
      }
    })
  }

  /** Page coordinates of a visible cell (row relative to the top of the viewport). */
  async cellBox(viewportRow: number, column: number): Promise<CellBox> {
    const geometry = await this.terminalGeometry()
    const screen = (await this.page
      .locator('[data-testid="terminal"] .xterm-screen')
      .boundingBox())!
    return {
      x: screen.x + column * geometry.cellWidth,
      y: screen.y + viewportRow * geometry.cellHeight,
      width: geometry.cellWidth,
      height: geometry.cellHeight,
    }
  }

  /** Text of the rows of the current terminal's grid, as it shows them now. */
  async visibleRows(): Promise<string[]> {
    return this.page.evaluate(() => {
      const terminal = window.hootTestHooks!.terminal!
      const buffer = terminal.buffer.active
      return Array.from(
        { length: terminal.rows },
        (_, row) => buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? '',
      )
    })
  }

  /** Where the current terminal's grid is in the window, in physical pixels. */
  async gridPixels(): Promise<GridPixels> {
    return this.page.evaluate(() => {
      const terminal = window.hootTestHooks!.terminal!
      const screen = terminal.element!.querySelector('.xterm-screen')!.getBoundingClientRect()
      const scale = window.devicePixelRatio
      const { cell } = terminal.dimensions!.device
      return {
        x: Math.round(screen.x * scale),
        y: Math.round(screen.y * scale),
        cellWidth: cell.width,
        cellHeight: cell.height,
        scale,
      }
    })
  }

  /** A screenshot of the window, in physical pixels, once what was written has been drawn. */
  async screenshot(): Promise<Screenshot> {
    // Terminals draw on the next animation frame.
    await this.page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    )
    return new Screenshot(await this.page.screenshot({ animations: 'allow' }))
  }

  /**
   * Prints lines exactly as given, control sequences included (with `cat`, in
   * the current session, whose shell is in project G), and returns the index
   * in the terminal's buffer of the first one.
   */
  async printLines(lines: readonly string[]): Promise<number> {
    const file = 'printed.txt'
    fs.writeFileSync(path.join(this.world.repos.G, file), lines.map((line) => `${line}\n`).join(''))
    const command = `cat ${file}`
    await this.run(command)
    return this.outputStart(command)
  }

  /**
   * Index in the current terminal's buffer of the first line printed after
   * the last occurrence of the given command line.
   */
  async outputStart(command: string): Promise<number> {
    return this.page.evaluate((commandLine) => {
      const buffer = window.hootTestHooks!.terminal!.buffer.active
      for (let index = buffer.length - 1; index >= 0; index--) {
        if (buffer.getLine(index)?.translateToString(true) === commandLine) return index + 1
      }
      return -1
    }, `${this.world.prompt}${command}`.trimEnd())
  }

  /** WebGL canvases drawing the grid of the current terminal. */
  async webglCanvases(): Promise<number> {
    const current = await this.sessionId()
    return (await this.webglCanvasesOf([current]))[current] ?? 0
  }

  /** WebGL canvases drawing the grid of each session's terminal, shown or not. */
  async webglCanvasesOf(sessionIds: readonly string[]): Promise<Record<string, number>> {
    return this.page.evaluate((ids) => {
      const counts: Record<string, number> = {}
      for (const id of ids) {
        const element = window.hootTestHooks!.terminalOf(id)?.element
        // The grid's other canvases have 2D contexts, and a canvas has a context of one kind only.
        counts[id] = Array.from(element?.querySelectorAll('.xterm-screen canvas') ?? []).filter(
          (canvas) => (canvas as HTMLCanvasElement).getContext('webgl2') !== null,
        ).length
      }
      return counts
    }, sessionIds)
  }

  /** Row elements made by the DOM renderer in the current terminal. */
  domRendererRows() {
    return this.page.locator('[data-testid="terminal"] .xterm-rows')
  }

  async viewportY(): Promise<number> {
    return this.page.evaluate(() => window.hootTestHooks!.terminal!.buffer.active.viewportY)
  }

  /** Pids of every process of the app, from Electron's own process metrics. */
  async appProcesses(): Promise<Array<{ pid: number; type: string; name?: string }>> {
    return this.electronApp.evaluate(({ app }) =>
      app
        .getAppMetrics()
        .map((metric) => ({ pid: metric.pid, type: metric.type, name: metric.name })),
    )
  }

  async ptyHostPid(): Promise<number | undefined> {
    const processes = await this.appProcesses()
    return processes.find((entry) => entry.type === 'Utility' && entry.name === 'Hoot pty host')
      ?.pid
  }

  /** Changes the appearance Electron reports, as a system appearance change would. */
  async setSystemAppearance(appearance: 'light' | 'dark'): Promise<void> {
    await this.electronApp.evaluate(({ nativeTheme }, value) => {
      nativeTheme.themeSource = value
    }, appearance)
  }

  async readClipboard(): Promise<string> {
    return this.electronApp.evaluate(({ clipboard }) => clipboard.readText())
  }

  async writeClipboard(text: string): Promise<void> {
    await this.electronApp.evaluate(({ clipboard }, value) => clipboard.writeText(value), text)
  }

  /** The items of the application menu bar, with their submenus. */
  async applicationMenu(): Promise<MenuEntry[]> {
    return this.electronApp.evaluate(({ Menu }) => {
      const describe = (menu: Electron.Menu | null | undefined): MenuEntry[] =>
        (menu?.items ?? []).map((item) => {
          const roleAccelerator = (
            item as Electron.MenuItem & { getDefaultRoleAccelerator?: () => string | undefined }
          ).getDefaultRoleAccelerator?.()
          return {
            label: item.label,
            role: item.role ?? null,
            type: item.type,
            checked: item.checked,
            enabled: item.enabled,
            visible: item.visible,
            accelerator: item.accelerator ?? roleAccelerator ?? null,
            submenu: item.submenu ? describe(item.submenu) : null,
          }
        })
      return describe(Menu.getApplicationMenu())
    })
  }

  /** Chooses a menu bar item by its labels, as a click on it does. */
  async chooseMenuItem(...labels: string[]): Promise<void> {
    await this.electronApp.evaluate(({ Menu }, itemLabels) => {
      let menu: Electron.Menu | null = Menu.getApplicationMenu()
      let item: Electron.MenuItem | undefined
      for (const label of itemLabels) {
        item = menu?.items.find((candidate) => candidate.label === label)
        menu = item?.submenu ?? null
      }
      if (!item?.enabled || !item.visible) {
        throw new Error(`${itemLabels.join(' > ')} cannot be chosen`)
      }
      item.click()
    }, labels)
  }

  /** The submenus of the Agents menu, or `null` when the menu bar has no Agents menu. */
  async agentsMenu(): Promise<MenuEntry[] | null> {
    const agents = (await this.applicationMenu()).find((item) => item.label === 'Agents')
    return agents?.submenu ?? null
  }

  /** Labels of the checked items in the tool's submenu of the Agents menu. */
  async checkedPermissionLevels(toolLabel: string): Promise<string[]> {
    const toolMenu = (await this.agentsMenu())?.find((item) => item.label === toolLabel)
    return (toolMenu?.submenu ?? []).filter((item) => item.checked).map((item) => item.label)
  }

  /** Chooses Agents > `toolLabel` > `levelLabel` in the menu bar, as a click on it does. */
  async selectPermissionLevel(toolLabel: string, levelLabel: string): Promise<void> {
    await this.electronApp.evaluate(
      ({ Menu }, [tool, level]) => {
        const find = (menu: Electron.Menu | null | undefined, label: string | undefined) =>
          menu?.items.find((item) => item.label === label)
        const agents = find(Menu.getApplicationMenu(), 'Agents')
        const item = find(find(agents?.submenu, tool)?.submenu, level)
        if (!item?.enabled || !item.visible) {
          throw new Error(`Agents > ${tool} > ${level} cannot be chosen`)
        }
        item.click()
      },
      [toolLabel, levelLabel],
    )
  }

  /** Labels of every item in the application menu. */
  async menuLabels(): Promise<string[]> {
    return this.electronApp.evaluate(({ Menu }) => {
      const labels: string[] = []
      const visit = (menu: Electron.Menu | null | undefined) => {
        for (const item of menu?.items ?? []) {
          if (item.label) labels.push(item.label)
          visit(item.submenu)
        }
      }
      visit(Menu.getApplicationMenu())
      return labels
    })
  }

  /**
   * Checks that all text Hoot itself shows is English: everything in the
   * window except terminal content and file paths, plus the application menu.
   */
  async expectEnglishUi(): Promise<void> {
    const texts = await this.page.evaluate(() => {
      const collected: string[] = [document.title]
      // Terminal content, session names (which come from terminal titles or the
      // user) and file paths are not text Hoot itself shows.
      const excluded = (element: Element) =>
        element.closest('.xterm, [data-path], [data-session-name]') !== null ||
        !element.checkVisibility()
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const element = node.parentElement
        if (!element || excluded(element)) continue
        const text = node.textContent?.trim()
        if (text) collected.push(text)
      }
      for (const element of Array.from(document.querySelectorAll('[title], [aria-label]'))) {
        if (excluded(element)) continue
        for (const name of ['title', 'aria-label']) {
          const value = element.getAttribute(name)
          if (value) collected.push(value)
        }
      }
      return collected
    })
    const labels = await this.menuLabels()
    const offending = [...texts, ...labels].filter((text) => NON_ENGLISH.test(text))
    expect(offending, 'non-English text shown by Hoot').toEqual([])
    expect(texts.length).toBeGreaterThan(1)
  }
}

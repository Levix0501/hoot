import { Menu, type MenuItemConstructorOptions } from 'electron'

export interface AppMenuActions {
  /** Shows the settings' About page in the window. */
  showAbout(): void
  /** Shows the settings in the window. */
  showSettings(): void
  addProject(): void
  /** Opens a new chat with the default agent, or the agent menu when none is usable. */
  newChat(): void
  /** Closes the session shown in the window. */
  closeSession(): void
  selectNextSession(): void
  selectPreviousSession(): void
  /** Shows the page shown before the current one: a session, an Issues page or the settings. */
  goBack(): void
  /** Shows the page shown after the current one, after going back. */
  goForward(): void
  /** Whether the sidebar is expanded: the View menu offers to hide it, or else to show it. */
  sidebarOpen: boolean
  toggleSidebar(): void
  includeDeveloperItems: boolean
}

/**
 * The menu bar. Its session, sidebar and settings commands are also handled
 * in the window, which receives their key presses first (see the renderer's
 * session shortcuts and the sidebar's ⌘B); ⌘1–⌘9 have no menu items and work
 * only there.
 */
export function appMenuTemplate(actions: AppMenuActions): MenuItemConstructorOptions[] {
  const viewItems: MenuItemConstructorOptions[] = actions.includeDeveloperItems
    ? [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }]
    : []
  return [
    {
      // The app menu macOS apps have, with Settings… after About. About shows
      // the settings' About page, not macOS's About panel.
      role: 'appMenu',
      submenu: [
        { label: 'About Hoot', click: () => actions.showAbout() },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => actions.showSettings() },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: 'Add Project…', accelerator: 'CmdOrCtrl+O', click: () => actions.addProject() },
        { type: 'separator' },
        { label: 'New Chat', accelerator: 'CmdOrCtrl+N', click: () => actions.newChat() },
        { type: 'separator' },
        // Replaces Close Window: the window's close button and Quit still quit Hoot.
        { label: 'Close Session', accelerator: 'CmdOrCtrl+W', click: () => actions.closeSession() },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        ...viewItems,
        {
          label: actions.sidebarOpen ? 'Hide Sidebar' : 'Show Sidebar',
          accelerator: 'CmdOrCtrl+B',
          click: () => actions.toggleSidebar(),
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      role: 'windowMenu',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { label: 'Back', accelerator: 'CmdOrCtrl+[', click: () => actions.goBack() },
        { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: () => actions.goForward() },
        { type: 'separator' },
        {
          label: 'Select Next Session',
          accelerator: 'CmdOrCtrl+Shift+]',
          click: () => actions.selectNextSession(),
        },
        {
          label: 'Select Previous Session',
          accelerator: 'CmdOrCtrl+Shift+[',
          click: () => actions.selectPreviousSession(),
        },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ]
}

export function buildAppMenu(actions: AppMenuActions): Menu {
  return Menu.buildFromTemplate(appMenuTemplate(actions))
}

/**
 * The menu bar while the database cannot be opened, when the window only
 * says why: no projects, sessions, sidebar or settings to act on, so only the
 * app's own items, editing (for copying the error) and the window's items.
 */
export function databaseErrorMenuTemplate(): MenuItemConstructorOptions[] {
  return [{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]
}

export function buildDatabaseErrorMenu(): Menu {
  return Menu.buildFromTemplate(databaseErrorMenuTemplate())
}

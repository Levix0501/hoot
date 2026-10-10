import { Menu, type MenuItemConstructorOptions } from 'electron'
import { agentsMenuTemplate, type AgentsMenuOptions } from './agents-menu'

export interface AppMenuActions extends AgentsMenuOptions {
  addProject(): void
  /** Closes the session shown in the window. */
  closeSession(): void
  selectNextSession(): void
  selectPreviousSession(): void
  /** Shows the session shown before the current one. */
  goBack(): void
  /** Shows the session shown after the current one, after going back. */
  goForward(): void
  /** Whether the sidebar is expanded: the View menu offers to hide it, or else to show it. */
  sidebarOpen: boolean
  toggleSidebar(): void
  includeDeveloperItems: boolean
}

/**
 * The menu bar. Its session and sidebar commands are also handled in the
 * window, which receives their key presses first (see the renderer's session
 * shortcuts and the sidebar's ⌘B); ⌘1–⌘9 have no menu items and work only
 * there.
 */
export function appMenuTemplate(actions: AppMenuActions): MenuItemConstructorOptions[] {
  const viewItems: MenuItemConstructorOptions[] = actions.includeDeveloperItems
    ? [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }]
    : []
  return [
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        { label: 'Add Project…', accelerator: 'CmdOrCtrl+O', click: () => actions.addProject() },
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
    agentsMenuTemplate(actions),
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
 * says why: no projects, sessions or sidebar to act on, so only the app's
 * own items, editing (for copying the error) and the window's items.
 */
export function databaseErrorMenuTemplate(): MenuItemConstructorOptions[] {
  return [{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]
}

export function buildDatabaseErrorMenu(): Menu {
  return Menu.buildFromTemplate(databaseErrorMenuTemplate())
}

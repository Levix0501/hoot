import { Menu, type MenuItemConstructorOptions } from 'electron'
import { agentsMenuTemplate, type AgentsMenuOptions } from './agents-menu'

export interface AppMenuActions extends AgentsMenuOptions {
  addProject(): void
  /** Closes the session shown in the window. */
  closeSession(): void
  selectNextSession(): void
  selectPreviousSession(): void
  includeDeveloperItems: boolean
}

/**
 * The menu bar. Its session commands are also handled in the window, which
 * receives their key presses first (see the renderer's session shortcuts);
 * ⌘1–⌘9 have no menu items and work only there.
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
    { label: 'View', submenu: [...viewItems, { role: 'togglefullscreen' }] },
    agentsMenuTemplate(actions),
    {
      role: 'windowMenu',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
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

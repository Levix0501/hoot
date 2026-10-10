import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ Menu: { buildFromTemplate: vi.fn<() => void>() } }))

const { appMenuTemplate, databaseErrorMenuTemplate } = await import('./app-menu')

function setup(options: { sidebarOpen?: boolean } = {}) {
  const calls: string[] = []
  const template = appMenuTemplate({
    includeDeveloperItems: false,
    addProject: () => calls.push('addProject'),
    closeSession: () => calls.push('closeSession'),
    selectNextSession: () => calls.push('selectNextSession'),
    selectPreviousSession: () => calls.push('selectPreviousSession'),
    goBack: () => calls.push('goBack'),
    goForward: () => calls.push('goForward'),
    sidebarOpen: options.sidebarOpen ?? true,
    toggleSidebar: () => calls.push('toggleSidebar'),
    selected: { claude: 'bypass-permissions', codex: 'full-access', opencode: 'auto-approve' },
    selectPermissionLevel: () => {},
  })
  return { template, calls }
}

function submenu(item: MenuItemConstructorOptions | undefined): MenuItemConstructorOptions[] {
  const items = item?.submenu
  if (!Array.isArray(items))
    throw new Error(`${item?.label ?? item?.role ?? 'item'} has no submenu`)
  return items
}

function click(item: MenuItemConstructorOptions | undefined): void {
  const action = item?.click as (() => void) | undefined
  if (!action) throw new Error(`${item?.label ?? 'item'} has no action`)
  action()
}

describe('appMenuTemplate', () => {
  it('puts Close Session, with Cmd+W, in place of Close Window in the File menu', () => {
    const { template, calls } = setup()
    const file = submenu(template.find((item) => item.label === 'File'))
    expect(file.map((item) => [item.label ?? item.type, item.accelerator ?? null])).toEqual([
      ['Add Project…', 'CmdOrCtrl+O'],
      ['separator', null],
      ['Close Session', 'CmdOrCtrl+W'],
    ])
    expect(file.some((item) => item.role === 'close')).toBe(false)
    click(file.find((item) => item.label === 'Close Session'))
    expect(calls).toEqual(['closeSession'])
  })

  it('selects the next and previous sessions from the Window menu', () => {
    const { template, calls } = setup()
    const window = submenu(template.find((item) => item.role === 'windowMenu'))
    const next = window.find((item) => item.label === 'Select Next Session')
    const previous = window.find((item) => item.label === 'Select Previous Session')
    expect(next?.accelerator).toBe('CmdOrCtrl+Shift+]')
    expect(previous?.accelerator).toBe('CmdOrCtrl+Shift+[')
    expect(window.map((item) => item.role).filter(Boolean)).toEqual(['minimize', 'zoom', 'front'])
    click(next)
    click(previous)
    expect(calls).toEqual(['selectNextSession', 'selectPreviousSession'])
  })

  it('goes back and forward from the Window menu, with Cmd+[ and Cmd+]', () => {
    const { template, calls } = setup()
    const window = submenu(template.find((item) => item.role === 'windowMenu'))
    const back = window.find((item) => item.label === 'Back')
    const forward = window.find((item) => item.label === 'Forward')
    expect(back?.accelerator).toBe('CmdOrCtrl+[')
    expect(forward?.accelerator).toBe('CmdOrCtrl+]')
    click(back)
    click(forward)
    expect(calls).toEqual(['goBack', 'goForward'])
  })

  it('hides or shows the sidebar from the View menu, with Cmd+B', () => {
    for (const [sidebarOpen, label] of [
      [true, 'Hide Sidebar'],
      [false, 'Show Sidebar'],
    ] as const) {
      const { template, calls } = setup({ sidebarOpen })
      const view = submenu(template.find((item) => item.label === 'View'))
      const item = view.find((entry) => entry.accelerator === 'CmdOrCtrl+B')
      expect(item?.label).toBe(label)
      expect(view.filter((entry) => /sidebar/i.test(entry.label ?? ''))).toEqual([item])
      expect(view.at(-1)?.role).toBe('togglefullscreen')
      click(item)
      expect(calls).toEqual(['toggleSidebar'])
    }
  })

  it('has no menu items for Cmd+1 to Cmd+9', () => {
    const { template } = setup()
    const accelerators: string[] = []
    const visit = (items: MenuItemConstructorOptions[]) => {
      for (const item of items) {
        if (item.accelerator) accelerators.push(String(item.accelerator))
        if (Array.isArray(item.submenu)) visit(item.submenu)
      }
    }
    visit(template)
    expect(accelerators.filter((accelerator) => /\+[1-9]$/.test(accelerator))).toEqual([])
  })
})

describe('databaseErrorMenuTemplate', () => {
  it('offers only the app menu, editing and the window, with nothing about projects or sessions', () => {
    const template = databaseErrorMenuTemplate()
    expect(template.map((item) => item.role)).toEqual(['appMenu', 'editMenu', 'windowMenu'])
    expect(template.every((item) => item.submenu === undefined && item.click === undefined)).toBe(
      true,
    )
  })
})

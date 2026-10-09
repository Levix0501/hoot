import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ Menu: { buildFromTemplate: vi.fn<() => void>() } }))

const { appMenuTemplate } = await import('./app-menu')

function setup() {
  const calls: string[] = []
  const template = appMenuTemplate({
    includeDeveloperItems: false,
    addProject: () => calls.push('addProject'),
    closeSession: () => calls.push('closeSession'),
    selectNextSession: () => calls.push('selectNextSession'),
    selectPreviousSession: () => calls.push('selectPreviousSession'),
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

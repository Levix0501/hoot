import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PermissionLevelStore } from './permission-level-store'
import { SidebarStateStore } from './sidebar-state-store'

let directory: string
let file: string

beforeEach(() => {
  directory = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-sidebar-')), 'nested')
  file = path.join(directory, 'settings.json')
})

afterEach(() => fs.rmSync(path.dirname(directory), { recursive: true, force: true }))

function writeSettings(content: unknown): void {
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content))
}

const saved = () => JSON.parse(fs.readFileSync(file, 'utf8')) as unknown

describe('SidebarStateStore', () => {
  it('is expanded when nothing was saved, without writing anything', () => {
    expect(new SidebarStateStore(directory).open).toBe(true)
    expect(fs.existsSync(file)).toBe(false)
  })

  it('saves whether the sidebar is collapsed, and keeps it across instances', () => {
    const first = new SidebarStateStore(directory)
    first.setOpen(false)
    expect(first.open).toBe(false)
    expect(saved()).toEqual({ sidebarCollapsed: true })
    expect(new SidebarStateStore(directory).open).toBe(false)

    first.setOpen(true)
    expect(saved()).toEqual({ sidebarCollapsed: false })
    expect(new SidebarStateStore(directory).open).toBe(true)
  })

  it('reports each change once', () => {
    const store = new SidebarStateStore(directory)
    const changes: boolean[] = []
    store.on('changed', (open) => changes.push(open))
    store.setOpen(true)
    store.setOpen(false)
    store.setOpen(false)
    store.setOpen(true)
    expect(changes).toEqual([false, true])
  })

  it('shares settings.json with the permission levels without overwriting them', () => {
    const levels = new PermissionLevelStore(directory)
    const sidebar = new SidebarStateStore(directory)
    levels.select('claude', 'plan')
    sidebar.setOpen(false)
    levels.select('codex', 'read-only')
    expect(saved()).toEqual({
      permissionLevels: { claude: 'plan', codex: 'read-only' },
      sidebarCollapsed: true,
    })
    expect(new PermissionLevelStore(directory).level('claude').label).toBe('Plan')
    expect(new SidebarStateStore(directory).open).toBe(false)
  })

  it('is expanded when the saved value is not a boolean or the file is malformed', () => {
    writeSettings({ sidebarCollapsed: 'yes' })
    expect(new SidebarStateStore(directory).open).toBe(true)
    writeSettings('{ not json')
    const store = new SidebarStateStore(directory)
    expect(store.open).toBe(true)
    store.setOpen(false)
    expect(saved()).toEqual({ sidebarCollapsed: true })
  })
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LaunchSettingsStore } from './launch-settings-store'
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

  it('shares settings.json with the launch settings without overwriting them', () => {
    const launch = new LaunchSettingsStore(directory)
    const sidebar = new SidebarStateStore(directory)
    launch.setYoloMode(false)
    sidebar.setOpen(false)
    launch.change('claude', { model: 'opus' })
    expect(saved()).toMatchObject({
      launchSettings: { yoloMode: false, agents: { claude: { model: 'opus' } } },
      sidebarCollapsed: true,
    })
    expect(new LaunchSettingsStore(directory).agent('claude').model).toBe('opus')
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

describe('SidebarStateStore: collapsed projects', () => {
  it('has every project expanded when nothing was saved, without writing anything', () => {
    expect(new SidebarStateStore(directory).collapsedProjects).toEqual([])
    expect(fs.existsSync(file)).toBe(false)
  })

  it('saves which projects are collapsed, and keeps them across instances', () => {
    const first = new SidebarStateStore(directory)
    first.setProjectCollapsed(3, true)
    first.setProjectCollapsed(1, true)
    expect(first.collapsedProjects).toEqual([3, 1])
    expect(saved()).toEqual({ collapsedProjects: [3, 1] })
    expect(new SidebarStateStore(directory).collapsedProjects).toEqual([3, 1])

    first.setProjectCollapsed(3, false)
    expect(saved()).toEqual({ collapsedProjects: [1] })
    expect(new SidebarStateStore(directory).collapsedProjects).toEqual([1])
  })

  it('writes nothing when a project is already in the state asked for', () => {
    const store = new SidebarStateStore(directory)
    store.setProjectCollapsed(2, false)
    expect(fs.existsSync(file)).toBe(false)
    store.setProjectCollapsed(2, true)
    fs.writeFileSync(file, JSON.stringify({ collapsedProjects: [2], marker: true }))
    store.setProjectCollapsed(2, true)
    expect(saved()).toEqual({ collapsedProjects: [2], marker: true })
  })

  it('forgets the projects that are no longer in the list, so that they are expanded when added again', () => {
    const store = new SidebarStateStore(directory)
    for (const id of [1, 2, 3]) store.setProjectCollapsed(id, true)
    store.retainProjects([1, 3, 4])
    expect(store.collapsedProjects).toEqual([1, 3])
    expect(saved()).toEqual({ collapsedProjects: [1, 3] })
    expect(new SidebarStateStore(directory).collapsedProjects).toEqual([1, 3])

    // Nothing to forget: the file is left as it is.
    fs.writeFileSync(file, JSON.stringify({ collapsedProjects: [1, 3], marker: true }))
    store.retainProjects([1, 3])
    expect(saved()).toEqual({ collapsedProjects: [1, 3], marker: true })
  })

  it('shares settings.json with the sidebar state and the launch settings', () => {
    const launch = new LaunchSettingsStore(directory)
    const sidebar = new SidebarStateStore(directory)
    launch.setYoloMode(false)
    sidebar.setProjectCollapsed(5, true)
    sidebar.setOpen(false)
    expect(saved()).toMatchObject({
      launchSettings: { yoloMode: false },
      collapsedProjects: [5],
      sidebarCollapsed: true,
    })
    const reopened = new SidebarStateStore(directory)
    expect(reopened.open).toBe(false)
    expect(reopened.collapsedProjects).toEqual([5])
  })

  it('leaves out saved values that are not project ids', () => {
    writeSettings({ collapsedProjects: [1, 'two', 3.5, -4, 0, null, 6] })
    expect(new SidebarStateStore(directory).collapsedProjects).toEqual([1, 6])
    writeSettings({ collapsedProjects: 'all' })
    const store = new SidebarStateStore(directory)
    expect(store.collapsedProjects).toEqual([])
    store.setProjectCollapsed(7, true)
    expect(saved()).toEqual({ collapsedProjects: [7] })
  })
})

describe('SidebarStateStore: collapsed worktrees', () => {
  it('has every worktree expanded when nothing was saved, without writing anything', () => {
    expect(new SidebarStateStore(directory).collapsedWorktrees).toEqual([])
    expect(fs.existsSync(file)).toBe(false)
  })

  it('saves which worktrees are collapsed, and keeps them across instances', () => {
    const first = new SidebarStateStore(directory)
    first.setWorktreeCollapsed('/wt/b', true)
    first.setWorktreeCollapsed('/wt/a', true)
    expect(first.collapsedWorktrees).toEqual(['/wt/b', '/wt/a'])
    expect(saved()).toEqual({ collapsedWorktrees: ['/wt/b', '/wt/a'] })
    expect(new SidebarStateStore(directory).collapsedWorktrees).toEqual(['/wt/b', '/wt/a'])

    first.setWorktreeCollapsed('/wt/b', false)
    expect(saved()).toEqual({ collapsedWorktrees: ['/wt/a'] })
    expect(new SidebarStateStore(directory).collapsedWorktrees).toEqual(['/wt/a'])
  })

  it('writes nothing when a worktree is already in the state asked for', () => {
    const store = new SidebarStateStore(directory)
    store.setWorktreeCollapsed('/wt/a', false)
    expect(fs.existsSync(file)).toBe(false)
    store.setWorktreeCollapsed('/wt/a', true)
    fs.writeFileSync(file, JSON.stringify({ collapsedWorktrees: ['/wt/a'], marker: true }))
    store.setWorktreeCollapsed('/wt/a', true)
    expect(saved()).toEqual({ collapsedWorktrees: ['/wt/a'], marker: true })
  })

  it('shares settings.json with the collapsed projects and the rest of the sidebar state', () => {
    const sidebar = new SidebarStateStore(directory)
    sidebar.setProjectCollapsed(2, true)
    sidebar.setWorktreeCollapsed('/wt/a', true)
    sidebar.setOpen(false)
    expect(saved()).toEqual({
      collapsedProjects: [2],
      collapsedWorktrees: ['/wt/a'],
      sidebarCollapsed: true,
    })
    const reopened = new SidebarStateStore(directory)
    expect(reopened.collapsedProjects).toEqual([2])
    expect(reopened.collapsedWorktrees).toEqual(['/wt/a'])
    expect(reopened.open).toBe(false)
  })

  it('leaves out saved values that are not worktree roots', () => {
    writeSettings({ collapsedWorktrees: ['/wt/a', '', 3, null, '/wt/b'] })
    expect(new SidebarStateStore(directory).collapsedWorktrees).toEqual(['/wt/a', '/wt/b'])
    writeSettings({ collapsedWorktrees: '/wt/a' })
    const store = new SidebarStateStore(directory)
    expect(store.collapsedWorktrees).toEqual([])
    store.setWorktreeCollapsed('/wt/c', true)
    expect(saved()).toEqual({ collapsedWorktrees: ['/wt/c'] })
  })
})

describe('SidebarStateStore: width', () => {
  it('is 275 pixels wide when nothing was saved, without writing anything', () => {
    expect(new SidebarStateStore(directory).width).toBe(275)
    expect(fs.existsSync(file)).toBe(false)
  })

  it('saves the width, and keeps it across instances', () => {
    const first = new SidebarStateStore(directory)
    first.setWidth(320)
    expect(first.width).toBe(320)
    expect(saved()).toEqual({ sidebarWidth: 320 })
    expect(new SidebarStateStore(directory).width).toBe(320)
  })

  it('saves a width brought within 240 to 520 pixels, in whole pixels', () => {
    const store = new SidebarStateStore(directory)
    store.setWidth(900)
    expect(store.width).toBe(520)
    expect(saved()).toEqual({ sidebarWidth: 520 })
    store.setWidth(100)
    expect(saved()).toEqual({ sidebarWidth: 240 })
    store.setWidth(300.4)
    expect(saved()).toEqual({ sidebarWidth: 300 })
  })

  it('writes nothing when the width does not change', () => {
    const store = new SidebarStateStore(directory)
    store.setWidth(275)
    expect(fs.existsSync(file)).toBe(false)
    store.setWidth(330)
    fs.writeFileSync(file, JSON.stringify({ sidebarWidth: 330, marker: true }))
    store.setWidth(330.2)
    expect(saved()).toEqual({ sidebarWidth: 330, marker: true })
  })

  it('reads a saved width outside the limits as the nearest limit, and one that is not a number as the default', () => {
    writeSettings({ sidebarWidth: 2000 })
    expect(new SidebarStateStore(directory).width).toBe(520)
    writeSettings({ sidebarWidth: 'wide' })
    expect(new SidebarStateStore(directory).width).toBe(275)
  })

  it('shares settings.json with the rest of the sidebar state', () => {
    const sidebar = new SidebarStateStore(directory)
    sidebar.setOpen(false)
    sidebar.setWidth(400)
    sidebar.setProjectCollapsed(2, true)
    expect(saved()).toEqual({ sidebarCollapsed: true, sidebarWidth: 400, collapsedProjects: [2] })
    const reopened = new SidebarStateStore(directory)
    expect(reopened.open).toBe(false)
    expect(reopened.width).toBe(400)
    expect(reopened.collapsedProjects).toEqual([2])
  })
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Appearance } from '../../shared/appearance'
import { AppearanceStore } from './appearance-store'
import { LaunchSettingsStore } from './launch-settings-store'
import { SidebarStateStore } from './sidebar-state-store'

let directory: string
let file: string

beforeEach(() => {
  directory = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-appearance-')), 'nested')
  file = path.join(directory, 'settings.json')
})

afterEach(() => fs.rmSync(path.dirname(directory), { recursive: true, force: true }))

function writeSettings(content: unknown): void {
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content))
}

const saved = () => JSON.parse(fs.readFileSync(file, 'utf8')) as unknown

describe('AppearanceStore', () => {
  it('follows macOS when nothing was saved, without writing anything', () => {
    expect(new AppearanceStore(directory).appearance).toBe('system')
    expect(fs.existsSync(file)).toBe(false)
  })

  it('saves the appearance picked, and keeps it across instances', () => {
    const first = new AppearanceStore(directory)
    first.select('dark')
    expect(first.appearance).toBe('dark')
    expect(saved()).toEqual({ appearance: 'dark' })
    expect(new AppearanceStore(directory).appearance).toBe('dark')

    first.select('light')
    expect(saved()).toEqual({ appearance: 'light' })
    first.select('system')
    expect(saved()).toEqual({ appearance: 'system' })
    expect(new AppearanceStore(directory).appearance).toBe('system')
  })

  it('reports each change once', () => {
    const store = new AppearanceStore(directory)
    const changes: Appearance[] = []
    store.on('changed', (appearance) => changes.push(appearance))
    store.select('system')
    store.select('light')
    store.select('light')
    store.select('dark')
    expect(changes).toEqual(['light', 'dark'])
  })

  it('shares settings.json with the launch settings and the sidebar without overwriting them', () => {
    const launch = new LaunchSettingsStore(directory)
    const sidebar = new SidebarStateStore(directory)
    const appearance = new AppearanceStore(directory)
    launch.setYoloMode(false)
    appearance.select('dark')
    sidebar.setOpen(false)
    expect(saved()).toMatchObject({
      launchSettings: { yoloMode: false },
      appearance: 'dark',
      sidebarCollapsed: true,
    })
    expect(new LaunchSettingsStore(directory).all().yoloMode).toBe(false)
    expect(new SidebarStateStore(directory).open).toBe(false)
    expect(new AppearanceStore(directory).appearance).toBe('dark')
  })

  it('follows macOS when the saved value names no appearance or the file is malformed', () => {
    writeSettings({ appearance: 'sepia' })
    expect(new AppearanceStore(directory).appearance).toBe('system')
    writeSettings({ appearance: 1 })
    expect(new AppearanceStore(directory).appearance).toBe('system')
    writeSettings('{ not json')
    const store = new AppearanceStore(directory)
    expect(store.appearance).toBe('system')
    store.select('light')
    expect(saved()).toEqual({ appearance: 'light' })
  })
})

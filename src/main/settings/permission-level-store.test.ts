import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PermissionLevelSettings } from '../../shared/permission-levels'
import { PermissionLevelStore } from './permission-level-store'

let directory: string
let file: string

beforeEach(() => {
  directory = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-settings-')), 'nested')
  file = path.join(directory, 'settings.json')
})

afterEach(() => fs.rmSync(path.dirname(directory), { recursive: true, force: true }))

const highest: PermissionLevelSettings = {
  claude: 'bypass-permissions',
  codex: 'full-access',
  opencode: 'auto-approve',
}

function writeSettings(content: unknown): void {
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content))
}

describe('PermissionLevelStore', () => {
  it('selects the highest level of every tool when nothing was saved', () => {
    const store = new PermissionLevelStore(directory)
    expect(store.all()).toEqual(highest)
    expect(store.level('claude').args).toEqual(['--dangerously-skip-permissions'])
    expect(store.level('codex').args).toEqual(['--dangerously-bypass-approvals-and-sandbox'])
    expect(store.level('opencode').args).toEqual(['--auto'])
    expect(fs.existsSync(file)).toBe(false)
  })

  it('saves only the levels that were picked, and keeps them across instances', () => {
    const first = new PermissionLevelStore(directory)
    first.select('claude', 'plan')
    first.select('opencode', 'standard')
    expect(first.level('claude').label).toBe('Plan')
    expect(first.level('opencode').args).toEqual([])

    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({
      permissionLevels: { claude: 'plan', opencode: 'standard' },
    })
    const second = new PermissionLevelStore(directory)
    expect(second.all()).toEqual({ claude: 'plan', codex: 'full-access', opencode: 'standard' })
    expect(second.level('claude').args).toEqual(['--permission-mode', 'plan'])
  })

  it('reports each change once, and ignores unknown levels', () => {
    const store = new PermissionLevelStore(directory)
    const changes: PermissionLevelSettings[] = []
    store.on('changed', (settings) => changes.push(settings))

    store.select('codex', 'read-only')
    store.select('codex', 'read-only')
    store.select('codex', 'plan')
    store.select('claude', 'missing')
    expect(changes).toEqual([{ ...highest, codex: 'read-only' }])
    expect(store.all()).toEqual({ ...highest, codex: 'read-only' })
  })

  it('uses the highest level for saved values that name no level of the tool', () => {
    writeSettings({ permissionLevels: { claude: 'read-only', codex: 3, opencode: 'standard' } })
    expect(new PermissionLevelStore(directory).all()).toEqual({ ...highest, opencode: 'standard' })
  })

  it('treats an unreadable or malformed file as no saved levels', () => {
    writeSettings('{ not json')
    expect(new PermissionLevelStore(directory).all()).toEqual(highest)

    writeSettings({ permissionLevels: 'plan' })
    const store = new PermissionLevelStore(directory)
    expect(store.all()).toEqual(highest)
    store.select('claude', 'manual')
    expect(new PermissionLevelStore(directory).all()).toEqual({ ...highest, claude: 'manual' })
  })
})

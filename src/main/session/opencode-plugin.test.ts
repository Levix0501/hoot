import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import plugin, {
  HOOT_OPENCODE_PLUGIN,
  messageReport,
  type OpenCodeEvent,
  type PluginContext,
} from '../../../resources/opencode-plugin/tui'
import { HOOT_ENV } from '../../shared/hoot-cli'
import {
  OPENCODE_CLI_CONFIG,
  openCodeCliConfig,
  openCodeConfigFolder,
  openCodePluginFolder,
} from './opencode-plugin'

const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-opencode-')))

afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

describe('openCodePluginFolder', () => {
  it('is in the packaged app’s resources, or in the repository', () => {
    const where = {
      resourcesPath: '/Applications/Hoot.app/Contents/Resources',
      appPath: '/work/hoot',
      platform: 'darwin' as const,
    }
    expect(openCodePluginFolder({ ...where, packaged: true })).toBe(
      '/Applications/Hoot.app/Contents/Resources/opencode-plugin',
    )
    expect(openCodePluginFolder({ ...where, packaged: false })).toBe(
      '/work/hoot/resources/opencode-plugin',
    )
    expect(
      openCodePluginFolder({
        packaged: true,
        resourcesPath: 'C:\\Users\\me\\AppData\\Local\\Programs\\Hoot\\resources',
        appPath: 'C:\\Users\\me\\AppData\\Local\\Programs\\Hoot\\resources\\app.asar',
        platform: 'win32',
      }),
    ).toBe('C:\\Users\\me\\AppData\\Local\\Programs\\Hoot\\resources\\opencode-plugin')
  })
})

describe('openCodeConfigFolder', () => {
  it('is where OpenCode 2 finds its settings in its environment', () => {
    expect(openCodeConfigFolder({ HOME: '/home/me' }, '/work/app', 'darwin')).toBe(
      '/home/me/.config/opencode',
    )
    expect(
      openCodeConfigFolder({ HOME: '/home/me', XDG_CONFIG_HOME: '/xdg' }, '/work/app', 'darwin'),
    ).toBe('/xdg/opencode')
    // Given outright, as it is, from the folder OpenCode runs in.
    expect(
      openCodeConfigFolder(
        { HOME: '/home/me', XDG_CONFIG_HOME: '/xdg', OPENCODE_CONFIG_DIR: '/settings' },
        '/work/app',
        'darwin',
      ),
    ).toBe('/settings')
    expect(openCodeConfigFolder({ OPENCODE_CONFIG_DIR: 'settings' }, '/work/app', 'darwin')).toBe(
      '/work/app/settings',
    )
    // `.config` in the home folder on Windows too, its variables in any case.
    expect(openCodeConfigFolder({ UserProfile: 'C:\\Users\\me' }, 'C:\\work', 'win32')).toBe(
      'C:\\Users\\me\\.config\\opencode',
    )
    expect(
      openCodeConfigFolder(
        { USERPROFILE: 'C:\\Users\\me', xdg_config_home: 'D:\\xdg' },
        'C:\\work',
        'win32',
      ),
    ).toBe('D:\\xdg\\opencode')
  })
})

describe('openCodeCliConfig', () => {
  /** A folder of OpenCode's settings, with a cli.json of this text when one is given. */
  const settingsFolder = (name: string, cliJson?: string): string => {
    const folder = path.join(root, name)
    fs.mkdirSync(folder, { recursive: true })
    if (cliJson !== undefined) fs.writeFileSync(path.join(folder, 'cli.json'), cliJson)
    return folder
  }
  const pluginFolder = path.join(root, 'Hoot', 'resources', 'opencode-plugin')

  const config = async (env: Record<string, string>) =>
    JSON.parse(await openCodeCliConfig({ env, cwd: root, plugin: pluginFolder })) as unknown

  it('gives Hoot’s plugin and turns OpenCode’s tab strip off', async () => {
    const folder = settingsFolder('none')
    expect(await config({ OPENCODE_CONFIG_DIR: folder })).toEqual({
      tabs: { mode: 'off', enabled: false },
      plugins: [pluginFolder],
    })
  })

  it('keeps the plugins of cli.json, after Hoot’s, and leaves the file as it is', async () => {
    const text = [
      '{',
      '  // The user’s own.',
      '  "$schema": "https://opencode.ai/v2/cli.json",',
      '  "tabs": { "mode": "on" },',
      '  "plugins": ["./plugins/status", { "package": "@acme/tui", "options": { "a": 1 } }, "-hoot",],',
      '}',
      '',
    ].join('\n')
    const folder = settingsFolder('cli-json', text)
    const file = path.join(folder, 'cli.json')
    const before = fs.statSync(file).mtimeMs
    expect(await config({ OPENCODE_CONFIG_DIR: folder })).toEqual({
      tabs: { mode: 'off', enabled: false },
      plugins: [
        pluginFolder,
        './plugins/status',
        { package: '@acme/tui', options: { a: 1 } },
        '-hoot',
      ],
    })
    expect(fs.readFileSync(file, 'utf8')).toBe(text)
    expect(fs.statSync(file).mtimeMs).toBe(before)
    expect(fs.readdirSync(folder)).toEqual(['cli.json'])
  })

  it('reads a cli.json that starts with a byte order mark, as OpenCode does', async () => {
    // As Windows PowerShell 5.1 writes a UTF-8 file.
    const folder = settingsFolder('bom', '\uFEFF{ "plugins": ["./plugins/status", "-hoot"] }\r\n')
    expect(fs.readFileSync(path.join(folder, 'cli.json')).subarray(0, 3)).toEqual(
      Buffer.from([0xef, 0xbb, 0xbf]),
    )
    expect(await config({ OPENCODE_CONFIG_DIR: folder })).toEqual({
      tabs: { mode: 'off', enabled: false },
      plugins: [pluginFolder, './plugins/status', '-hoot'],
    })
  })

  it('gives no other entry for Hoot’s plugin when the user’s own already names it', async () => {
    for (const named of [
      pluginFolder,
      pathToFileURL(pluginFolder).href,
      path.relative(path.join(root, 'named'), pluginFolder).replaceAll(path.sep, '/'),
    ]) {
      const folder = settingsFolder('named', JSON.stringify({ plugins: ['-hoot', named] }))
      expect(await config({ OPENCODE_CONFIG_DIR: folder })).toMatchObject({
        plugins: ['-hoot', named],
      })
    }
  })

  it('builds on the user’s own OPENCODE_CLI_CONFIG_CONTENT, whose plugins replace those of cli.json', async () => {
    const folder = settingsFolder(
      'own',
      JSON.stringify({ plugins: ['from-cli-json'], theme: { name: 'opencode' } }),
    )
    const own = JSON.stringify({
      theme: { name: 'tokyonight' },
      tabs: { mode: 'on', scope: 'global' },
      plugins: ['/plugins/u'],
    })
    expect(await config({ OPENCODE_CONFIG_DIR: folder, [OPENCODE_CLI_CONFIG]: own })).toEqual({
      theme: { name: 'tokyonight' },
      tabs: { mode: 'off', enabled: false, scope: 'global' },
      plugins: [pluginFolder, '/plugins/u'],
    })
    // Without plugins of its own, those of cli.json.
    expect(
      await config({
        OPENCODE_CONFIG_DIR: folder,
        [OPENCODE_CLI_CONFIG]: '{ "theme": { "name": "tokyonight" }, }',
      }),
    ).toEqual({
      theme: { name: 'tokyonight' },
      tabs: { mode: 'off', enabled: false },
      plugins: [pluginFolder, 'from-cli-json'],
    })
  })

  it('leaves aside settings OpenCode would leave aside', async () => {
    const folder = settingsFolder('broken', '{ "plugins": "not a list" }')
    for (const own of [
      'not JSON',
      '[]',
      '{ "theme": { "name": "nord" }, "plugins": [7] }',
      '{ "theme": { "name": "nord" }, "tabs": "off" }',
    ]) {
      expect(await config({ OPENCODE_CONFIG_DIR: folder, [OPENCODE_CLI_CONFIG]: own })).toEqual({
        tabs: { mode: 'off', enabled: false },
        plugins: [pluginFolder],
      })
    }
    for (const text of ['{ "plugins": ["a"] ', '{ "plugins": ["a"], "tabs": true }']) {
      const unread = settingsFolder('unread', text)
      expect(await config({ OPENCODE_CONFIG_DIR: unread })).toEqual({
        tabs: { mode: 'off', enabled: false },
        plugins: [pluginFolder],
      })
    }
  })
})

/** What OpenCode's terminal interface shows, and what it knows of its conversations. */
const context = (
  route: { type: string; sessionID?: string },
  conversations: Record<string, { parentID?: string; location?: { directory?: string } }> = {},
) => {
  let listener: ((event: { details: OpenCodeEvent }) => void) | null = null
  const shown = { route }
  const opencode: PluginContext = {
    data: {
      listen(handler) {
        listener = handler
        return () => {
          listener = null
        }
      },
      session: { get: (id) => conversations[id] },
    },
    ui: { router: { current: () => shown.route } },
  }
  return {
    opencode,
    shown,
    listening: () => listener !== null,
    emit: (details: OpenCodeEvent) => listener?.({ details }),
  }
}

/** The event of OpenCode's server that tells of a message sent in a conversation. */
const enqueued = (sessionID: string, type = 'user', directory = '/work/w'): OpenCodeEvent => ({
  type: 'session.inbox.enqueued',
  location: { directory },
  data: { sessionID, item: { type } },
})

/** The environment of an OpenCode session of Hoot's, with a stand-in for Hoot's executable. */
const inSession = (record: string) => {
  const script = path.join(root, 'hoot-cli.cjs')
  fs.writeFileSync(
    script,
    [
      "const fs = require('node:fs')",
      'const chunks = []',
      "process.stdin.on('data', (chunk) => chunks.push(chunk))",
      "process.stdin.on('end', () => {",
      '  fs.writeFileSync(process.env.RECORD_FILE, JSON.stringify({',
      '    args: process.argv.slice(2),',
      "    input: Buffer.concat(chunks).toString('utf8'),",
      '    runAsNode: process.env.ELECTRON_RUN_AS_NODE,',
      "    nodeOptions: process.env.NODE_OPTIONS ?? 'unset',",
      '  }))',
      '})',
      '',
    ].join('\n'),
  )
  vi.stubEnv(HOOT_ENV.openCodePlugin, '1')
  vi.stubEnv(HOOT_ENV.node, process.execPath)
  vi.stubEnv(HOOT_ENV.script, script)
  vi.stubEnv(HOOT_ENV.socket, path.join(root, 'hoot.sock'))
  vi.stubEnv(HOOT_ENV.sessionId, 'session-1')
  vi.stubEnv('NODE_OPTIONS', '--max-old-space-size=100')
  vi.stubEnv('RECORD_FILE', record)
}

describe('the plugin Hoot gives OpenCode', () => {
  it('tells of a message the user sent in the conversation its window shows, with its folder', () => {
    const { opencode } = context(
      { type: 'session', sessionID: 'ses_one' },
      { ses_one: { location: { directory: '/work/w/sub' } } },
    )
    expect(messageReport(opencode, enqueued('ses_one'))).toEqual({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'ses_one',
      cwd: '/work/w/sub',
    })
    // The folder the event names, while OpenCode does not know the conversation yet.
    const { opencode: fresh } = context({ type: 'session', sessionID: 'ses_new' })
    expect(messageReport(fresh, enqueued('ses_new'))).toEqual({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'ses_new',
      cwd: '/work/w',
    })
    expect(
      messageReport(fresh, { type: 'session.inbox.enqueued', data: enqueued('ses_new').data }),
    ).toEqual({ hook_event_name: 'UserPromptSubmit', session_id: 'ses_new' })
  })

  it('tells of nothing else', () => {
    const { opencode, shown } = context(
      { type: 'session', sessionID: 'ses_one' },
      { ses_child: { parentID: 'ses_one' } },
    )
    // Another window's message, which OpenCode's background server sends this one too.
    expect(messageReport(opencode, enqueued('ses_other'))).toBeNull()
    // What is not a message the user sent, such as a summary of `/compact`.
    expect(messageReport(opencode, enqueued('ses_one', 'synthetic'))).toBeNull()
    expect(messageReport(opencode, enqueued('ses_one', 'compaction'))).toBeNull()
    expect(
      messageReport(opencode, { type: 'session.created', data: { sessionID: 'ses_one' } }),
    ).toBeNull()
    // A subagent's conversation, shown in the window.
    shown.route = { type: 'session', sessionID: 'ses_child' }
    expect(messageReport(opencode, enqueued('ses_child'))).toBeNull()
    // Nor while the window shows no conversation, as after `/new`.
    shown.route = { type: 'home' }
    expect(messageReport(opencode, enqueued('ses_one'))).toBeNull()
  })

  afterEach(() => vi.unstubAllEnvs())

  it('is the plugin `hoot`, for the variable Hoot sets', () => {
    expect(plugin.id).toBe('hoot')
    expect(HOOT_OPENCODE_PLUGIN).toBe(HOOT_ENV.openCodePlugin)
  })

  it("reports each message by running hoot's hook command with Hoot's executable", async () => {
    const record = path.join(root, 'reported.json')
    inSession(record)
    const window = context(
      { type: 'session', sessionID: 'ses_one' },
      { ses_one: { location: { directory: '/work/w' } } },
    )
    const stop = plugin.setup(window.opencode)
    expect(window.listening()).toBe(true)
    window.emit(enqueued('ses_other'))
    window.emit(enqueued('ses_one'))
    for (let tries = 0; tries < 200 && !fs.existsSync(record); tries++) await delay(50)
    await delay(200)
    expect(JSON.parse(fs.readFileSync(record, 'utf8'))).toEqual({
      args: ['hook'],
      input: JSON.stringify({
        hook_event_name: 'UserPromptSubmit',
        session_id: 'ses_one',
        cwd: '/work/w',
      }),
      runAsNode: '1',
      nodeOptions: 'unset',
    })
    stop?.()
    expect(window.listening()).toBe(false)
  })

  it('does nothing in an OpenCode Hoot did not start, as one in a Shell session or a terminal', () => {
    const record = path.join(root, 'unreported.json')
    inSession(record)
    vi.stubEnv(HOOT_ENV.openCodePlugin, undefined)
    const shell = context({ type: 'session', sessionID: 'ses_one' })
    expect(plugin.setup(shell.opencode)).toBeUndefined()
    expect(shell.listening()).toBe(false)
    vi.unstubAllEnvs()
    const terminal = context({ type: 'session', sessionID: 'ses_one' })
    vi.stubEnv(HOOT_ENV.openCodePlugin, '1')
    vi.stubEnv(HOOT_ENV.node, undefined)
    expect(plugin.setup(terminal.opencode)).toBeUndefined()
    expect(terminal.listening()).toBe(false)
  })
})

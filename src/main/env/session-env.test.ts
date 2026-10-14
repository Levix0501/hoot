import { describe, expect, it } from 'vitest'
import {
  appendToPath,
  buildSessionEnv,
  fallbackUtf8Locale,
  hootCliEnvironment,
  prependToPath,
  terminalEnvironment,
} from './session-env'

const hoot = {
  binDirectory: '/Applications/Hoot.app/Contents/Resources/bin',
  node: '/Applications/Hoot.app/Contents/MacOS/Hoot',
  script: '/Applications/Hoot.app/Contents/Resources/app.asar/dist-electron/cli/index.js',
  socket: '/Users/me/Library/Application Support/Hoot/hoot.sock',
  sessionId: 'session-1',
}
const options = {
  appVersion: '1.2.3',
  fallbackLang: 'C.UTF-8',
  cwd: '/work/project',
  hoot,
  platform: 'darwin' as const,
}

describe('buildSessionEnv', () => {
  it("keeps the source environment and adds only terminal variables and hoot's", () => {
    const env = buildSessionEnv({ PATH: '/bin', HOME: '/home/me', LANG: 'en_GB.UTF-8' }, options)
    expect(env).toEqual({
      PATH: `${hoot.binDirectory}:/bin`,
      HOME: '/home/me',
      LANG: 'en_GB.UTF-8',
      PWD: '/work/project',
      ...terminalEnvironment(options),
      HOOT_SOCKET: hoot.socket,
      HOOT_SESSION_ID: 'session-1',
      HOOT_NODE: hoot.node,
      HOOT_CLI: hoot.script,
    })
    expect(hootCliEnvironment(hoot)).toEqual({
      HOOT_SOCKET: hoot.socket,
      HOOT_SESSION_ID: 'session-1',
      HOOT_NODE: hoot.node,
      HOOT_CLI: hoot.script,
    })
  })

  it("puts the folder of hoot's launchers first on PATH, also when there is no PATH", () => {
    const env = buildSessionEnv({ PATH: '/usr/local/bin:/usr/bin:/bin' }, options)
    expect(env.PATH!.split(':')[0]).toBe(hoot.binDirectory)
    expect(env.PATH).toBe(`${hoot.binDirectory}:/usr/local/bin:/usr/bin:/bin`)
    expect(buildSessionEnv({}, options).PATH).toBe(hoot.binDirectory)
  })

  it('puts the folders it is given last on PATH, after every folder the environment has', () => {
    const lastOnPath = [
      '/Applications/Hoot.app/Contents/Resources/node',
      '/Users/me/.hoot/agents/bin',
    ]
    const env = buildSessionEnv({ PATH: '/usr/local/bin:/usr/bin' }, { ...options, lastOnPath })
    expect(env.PATH).toBe(`${hoot.binDirectory}:/usr/local/bin:/usr/bin:${lastOnPath.join(':')}`)
    const none: Record<string, string> = {}
    appendToPath(none, '/a', 'darwin')
    expect(none).toEqual({ PATH: '/a' })
  })

  it('names the session and the Hoot that starts it, over what the source environment says', () => {
    // As when Hoot itself was started from a session of another Hoot.
    const env = buildSessionEnv(
      {
        PATH: '/other/hoot/bin:/bin',
        HOOT_SOCKET: '/other/hoot.sock',
        HOOT_SESSION_ID: 'other',
        HOOT_NODE: '/other/Hoot',
        HOOT_CLI: '/other/cli.js',
      },
      options,
    )
    expect(env).toMatchObject({
      HOOT_SOCKET: hoot.socket,
      HOOT_SESSION_ID: 'session-1',
      HOOT_NODE: hoot.node,
      HOOT_CLI: hoot.script,
    })
    expect(env.PATH!.split(':')[0]).toBe(hoot.binDirectory)
  })

  it('drops variables that describe the shell instance the environment came from', () => {
    const env = buildSessionEnv(
      { PATH: '/bin', OLDPWD: '/x', SHLVL: '1', _: '/usr/bin/env', PWD: '/home/me' },
      options,
    )
    expect(env).not.toHaveProperty('OLDPWD')
    expect(env).not.toHaveProperty('SHLVL')
    expect(env).not.toHaveProperty('_')
    expect(env.PWD).toBe('/work/project')
  })

  it('sets LANG only when the environment has none', () => {
    expect(buildSessionEnv({}, options).LANG).toBe('C.UTF-8')
  })

  it('overrides terminal variables inherited from elsewhere', () => {
    const env = buildSessionEnv({ TERM: 'dumb', TERM_PROGRAM: 'Apple_Terminal' }, options)
    expect(env.TERM).toBe('xterm-256color')
    expect(env.COLORTERM).toBe('truecolor')
    expect(env.TERM_PROGRAM).toBe('hoot')
    expect(env.TERM_PROGRAM_VERSION).toBe('1.2.3')
  })
})

describe('on Windows', () => {
  const windowsHoot = {
    binDirectory: 'C:\\Program Files\\Hoot\\resources\\bin',
    node: 'C:\\Program Files\\Hoot\\Hoot.exe',
    script: 'C:\\Program Files\\Hoot\\resources\\app.asar\\dist-electron\\cli\\index.js',
    socket: '\\\\.\\pipe\\hoot-0123456789abcdef',
    sessionId: 'session-1',
  }
  const windows = { ...options, hoot: windowsHoot, platform: 'win32' as const }

  it("puts the folder of hoot's launchers first on the Path the environment has, separated by ;", () => {
    const env = buildSessionEnv(
      { Path: 'C:\\Windows\\system32;C:\\Program Files\\Git\\cmd', USERPROFILE: 'C:\\Users\\me' },
      windows,
    )
    expect(env.Path!.split(';')[0]).toBe(windowsHoot.binDirectory)
    expect(env.Path).toBe(
      `${windowsHoot.binDirectory};C:\\Windows\\system32;C:\\Program Files\\Git\\cmd`,
    )
    // One variable for the path, whatever its name's case.
    expect(Object.keys(env).filter((name) => name.toUpperCase() === 'PATH')).toEqual(['Path'])
    expect(env).toMatchObject({
      HOOT_SOCKET: windowsHoot.socket,
      HOOT_SESSION_ID: 'session-1',
      HOOT_NODE: windowsHoot.node,
      HOOT_CLI: windowsHoot.script,
    })
  })

  it('keeps the name of the path variable the environment uses, or adds Path', () => {
    const upper = { PATH: 'C:\\Windows' }
    prependToPath(upper, 'C:\\hoot\\bin', 'win32')
    expect(upper).toEqual({ PATH: 'C:\\hoot\\bin;C:\\Windows' })
    const none: Record<string, string> = {}
    prependToPath(none, 'C:\\hoot\\bin', 'win32')
    expect(none).toEqual({ Path: 'C:\\hoot\\bin' })
  })
})

describe('fallbackUtf8Locale', () => {
  it('prefers C.UTF-8 and falls back to en_US.UTF-8', () => {
    expect(fallbackUtf8Locale(() => true)).toBe('C.UTF-8')
    expect(fallbackUtf8Locale(() => false)).toBe('en_US.UTF-8')
  })
})

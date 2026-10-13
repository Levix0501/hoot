import { describe, expect, it } from 'vitest'
import { buildSessionEnv } from '../env/session-env'
import { hootCliSetup } from './setup'

const terminal = { appVersion: '1.2.3', fallbackLang: 'C.UTF-8' }

describe('hootCliSetup', () => {
  it("gives the packaged app's launchers, executable and script, and a socket in its user data directory", () => {
    expect(
      hootCliSetup({
        userData: '/Users/me/Library/Application Support/Hoot',
        packaged: true,
        resourcesPath: '/Applications/Hoot.app/Contents/Resources',
        appPath: '/Applications/Hoot.app/Contents/Resources/app.asar',
        executable: '/Applications/Hoot.app/Contents/MacOS/Hoot',
        mainDirectory: '/Applications/Hoot.app/Contents/Resources/app.asar/dist-electron/main',
        platform: 'darwin',
      }),
    ).toEqual({
      binDirectory: '/Applications/Hoot.app/Contents/Resources/bin',
      node: '/Applications/Hoot.app/Contents/MacOS/Hoot',
      script: '/Applications/Hoot.app/Contents/Resources/app.asar/dist-electron/cli/index.js',
      socket: '/Users/me/Library/Application Support/Hoot/hoot.sock',
    })
  })

  it("gives a Hoot run from its repository the repository's launchers", () => {
    expect(
      hootCliSetup({
        userData: '/Users/me/Library/Application Support/Hoot-dev',
        packaged: false,
        resourcesPath: '/repo/node_modules/electron/dist/Electron.app/Contents/Resources',
        appPath: '/repo',
        executable: '/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
        mainDirectory: '/repo/dist-electron/main',
        platform: 'darwin',
      }),
    ).toMatchObject({
      binDirectory: '/repo/resources/bin',
      script: '/repo/dist-electron/cli/index.js',
      socket: '/Users/me/Library/Application Support/Hoot-dev/hoot.sock',
    })
  })

  it("gives the sessions on Windows a named pipe, and the launchers' folder first on Path", () => {
    const setup = hootCliSetup({
      userData: 'C:\\Users\\me\\AppData\\Roaming\\Hoot',
      packaged: true,
      resourcesPath: 'C:\\Program Files\\Hoot\\resources',
      appPath: 'C:\\Program Files\\Hoot\\resources\\app.asar',
      executable: 'C:\\Program Files\\Hoot\\Hoot.exe',
      mainDirectory: 'C:\\Program Files\\Hoot\\resources\\app.asar\\dist-electron\\main',
      platform: 'win32',
    })
    expect(setup).toMatchObject({
      binDirectory: 'C:\\Program Files\\Hoot\\resources\\bin',
      node: 'C:\\Program Files\\Hoot\\Hoot.exe',
      script: 'C:\\Program Files\\Hoot\\resources\\app.asar\\dist-electron\\cli\\index.js',
    })
    expect(setup.socket).toMatch(/^\\\\\.\\pipe\\hoot-[0-9a-f]{16}$/)
    const env = buildSessionEnv(
      { Path: 'C:\\Windows\\system32;C:\\Program Files\\Git\\cmd' },
      {
        ...terminal,
        cwd: 'C:\\work\\project',
        hoot: { ...setup, sessionId: 's1' },
        platform: 'win32',
      },
    )
    expect(env.Path!.split(';')[0]).toBe('C:\\Program Files\\Hoot\\resources\\bin')
    expect(env.HOOT_SOCKET).toBe(setup.socket)
    expect(env.HOOT_SESSION_ID).toBe('s1')
  })
})

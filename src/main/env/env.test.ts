import { describe, expect, it } from 'vitest'
import { captureBaseEnv, envVariable, setEnvVariable, toEnv } from './env'

describe('captureBaseEnv', () => {
  it('copies the environment without variables added by launch tooling', () => {
    expect(
      captureBaseEnv({
        HOME: '/home/me',
        PATH: '/usr/bin',
        VITE_DEV_SERVER_URL: 'http://localhost:5173',
        ELECTRON_RUN_AS_NODE: '1',
        UNSET: undefined,
      }),
    ).toEqual({ HOME: '/home/me', PATH: '/usr/bin' })
  })

  it('drops unset values', () => {
    expect(toEnv({ A: 'a', B: undefined })).toEqual({ A: 'a' })
  })
})

describe('envVariable and setEnvVariable', () => {
  it('read and set a variable by its name, in any case on Windows', () => {
    const env = { Path: 'C:\\Windows', HOME: '/home/me' }
    expect(envVariable(env, 'PATH', 'win32')).toBe('C:\\Windows')
    expect(envVariable(env, 'PATH', 'darwin')).toBeUndefined()
    expect(envVariable(env, 'HOME', 'darwin')).toBe('/home/me')

    const windows = { Path: 'C:\\Windows', path: 'D:\\Tools' }
    setEnvVariable(windows, 'PATH', 'E:\\Bin', 'win32')
    expect(windows).toEqual({ PATH: 'E:\\Bin' })
    const mac = { Path: '/usr/bin' }
    setEnvVariable(mac, 'PATH', '/bin', 'darwin')
    expect(mac).toEqual({ Path: '/usr/bin', PATH: '/bin' })
  })
})

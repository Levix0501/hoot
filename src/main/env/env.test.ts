import { describe, expect, it } from 'vitest'
import { captureBaseEnv, toEnv } from './env'

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

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseEnvOutput, resolveLoginShellEnv } from './login-shell-env'

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-env-')))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('parseEnvOutput', () => {
  it('parses NUL-separated assignments, keeping `=` and newlines in values', () => {
    expect(parseEnvOutput('A=1\0B=x=y\0MULTI=line1\nline2\0\0')).toEqual({
      A: '1',
      B: 'x=y',
      MULTI: 'line1\nline2',
    })
  })

  it('ignores malformed entries', () => {
    expect(parseEnvOutput('=nope\0noequals\0OK=1')).toEqual({ OK: '1' })
  })
})

describe('resolveLoginShellEnv', () => {
  it('returns the environment after the login and interactive startup files ran', async () => {
    const home = temporaryDirectory()
    fs.writeFileSync(path.join(home, '.zprofile'), 'export FROM_LOGIN_FILE=yes\n')
    fs.writeFileSync(
      path.join(home, '.zshrc'),
      'export FROM_RC_FILE=yes\nexport PATH="/opt/from-rc:$PATH"\necho noise from rc\n',
    )
    const env = await resolveLoginShellEnv({
      shell: '/bin/zsh',
      baseEnv: { HOME: home, SHELL: '/bin/zsh', PATH: '/usr/bin:/bin', BASE_ONLY: 'kept' },
      cwd: home,
    })
    expect(env.FROM_LOGIN_FILE).toBe('yes')
    expect(env.FROM_RC_FILE).toBe('yes')
    expect(env.BASE_ONLY).toBe('kept')
    expect(env.PATH?.startsWith('/opt/from-rc:')).toBe(true)
    expect(env.HOME).toBe(home)
  })

  it('fails when the shell does not report an environment in time', async () => {
    const directory = temporaryDirectory()
    const shell = path.join(directory, 'hanging-shell')
    fs.writeFileSync(shell, '#!/bin/sh\nsleep 30\n', { mode: 0o755 })
    await expect(
      resolveLoginShellEnv({
        shell,
        baseEnv: { PATH: '/usr/bin:/bin' },
        cwd: directory,
        timeoutMs: 300,
      }),
    ).rejects.toThrow(/Timed out/)
  })

  it('fails when the shell exits without reporting an environment', async () => {
    const directory = temporaryDirectory()
    const shell = path.join(directory, 'broken-shell')
    fs.writeFileSync(shell, '#!/bin/sh\necho broken >&2\nexit 7\n', { mode: 0o755 })
    await expect(
      resolveLoginShellEnv({ shell, baseEnv: { PATH: '/usr/bin:/bin' }, cwd: directory }),
    ).rejects.toThrow(/code 7.*broken/)
  })
})

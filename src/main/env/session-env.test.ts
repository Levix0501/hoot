import { describe, expect, it } from 'vitest'
import { buildSessionEnv, fallbackUtf8Locale, terminalEnvironment } from './session-env'

const options = { appVersion: '1.2.3', fallbackLang: 'C.UTF-8', cwd: '/work/project' }

describe('buildSessionEnv', () => {
  it('keeps the source environment and adds only terminal variables', () => {
    const env = buildSessionEnv({ PATH: '/bin', HOME: '/home/me', LANG: 'en_GB.UTF-8' }, options)
    expect(env).toEqual({
      PATH: '/bin',
      HOME: '/home/me',
      LANG: 'en_GB.UTF-8',
      PWD: '/work/project',
      ...terminalEnvironment(options),
    })
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

describe('fallbackUtf8Locale', () => {
  it('prefers C.UTF-8 and falls back to en_US.UTF-8', () => {
    expect(fallbackUtf8Locale(() => true)).toBe('C.UTF-8')
    expect(fallbackUtf8Locale(() => false)).toBe('en_US.UTF-8')
  })
})

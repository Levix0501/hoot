import { describe, expect, it } from 'vitest'
import {
  CANCELLED_MESSAGE,
  failedMessage,
  installedMessage,
  installMethodLabel,
  installNeedsNodeVersionMessage,
  isNewerVersion,
  nodeRequirementMessage,
  nodeVersionsText,
  parseVersion,
  shownCommand,
  updatedMessage,
} from './agents'

describe('parseVersion', () => {
  it('finds the version in what each agent writes for --version', () => {
    expect(parseVersion('2.1.293 (Claude Code)\n')).toBe('2.1.293')
    expect(parseVersion('codex-cli 0.161.0\n')).toBe('0.161.0')
    expect(parseVersion('1.18.35\n')).toBe('1.18.35')
    expect(parseVersion('v24.21.0')).toBe('24.21.0')
    expect(parseVersion('tool 1.0.0-beta.2+build.5')).toBe('1.0.0-beta.2+build.5')
  })

  it('finds none in output without a version', () => {
    expect(parseVersion('')).toBeNull()
    expect(parseVersion('env: node: No such file or directory')).toBeNull()
    expect(parseVersion('built on 10.14 at 192.168.1.10')).toBeNull()
    expect(parseVersion('1.2')).toBeNull()
  })
})

describe('isNewerVersion', () => {
  it('compares by the rules of semantic versioning', () => {
    expect(isNewerVersion('2.1.299', '2.1.293')).toBe(true)
    expect(isNewerVersion('0.162.1', '0.161.10')).toBe(true)
    expect(isNewerVersion('1.10.0', '1.9.0')).toBe(true)
    expect(isNewerVersion('1.0.0', '1.0.0-beta.1')).toBe(true)
    expect(isNewerVersion('2.1.293', '2.1.293')).toBe(false)
    expect(isNewerVersion('2.1.293', '2.1.299')).toBe(false)
    expect(isNewerVersion('not a version', '1.0.0')).toBe(false)
  })
})

describe('the texts of the Agents page', () => {
  it('names each install method, but none it cannot tell', () => {
    expect(installMethodLabel('npm')).toBe('npm')
    expect(installMethodLabel('homebrew')).toBe('Homebrew')
    expect(installMethodLabel('official')).toBe('Official installer')
    expect(installMethodLabel('unknown')).toBeNull()
  })

  it('writes the results of operations', () => {
    expect(installedMessage('2.1.299')).toBe('✓ Installed 2.1.299')
    expect(updatedMessage('2.1.299', 0, '2.1.293')).toBe('✓ Updated to 2.1.299')
    expect(updatedMessage('2.1.299', 1, '2.1.293')).toBe(
      '✓ Updated to 2.1.299. 1 running session still uses 2.1.293.',
    )
    expect(updatedMessage('2.1.299', 2, '2.1.293')).toBe(
      '✓ Updated to 2.1.299. 2 running sessions still use 2.1.293.',
    )
    expect(failedMessage('install', 'npm exited with code 1')).toBe(
      '✕ Install failed: npm exited with code 1',
    )
    expect(failedMessage('update', 'the version is still 1.0.0')).toBe(
      '✕ Update failed: the version is still 1.0.0',
    )
    expect(CANCELLED_MESSAGE).toBe('Cancelled')
  })
})

describe('the commands and the Node.js requirements the Agents page shows', () => {
  it('writes a command as a user would run it, quoting what has a space', () => {
    expect(
      shownCommand([
        '~/.nvm/versions/node/v24.15.0/bin/npm',
        'install',
        '-g',
        '@openai/codex@latest',
      ]),
    ).toBe('~/.nvm/versions/node/v24.15.0/bin/npm install -g @openai/codex@latest')
    expect(shownCommand(['C:\\Program Files\\nodejs\\npm.cmd', 'install'])).toBe(
      '"C:\\Program Files\\nodejs\\npm.cmd" install',
    )
  })

  it('writes a lower bound as the version or later, and any other range as it is', () => {
    expect(nodeVersionsText('>=22.19.0')).toBe('22.19.0 or later')
    expect(nodeVersionsText('>= 16')).toBe('16 or later')
    expect(nodeVersionsText('^20.19.0 || >=22.12.0')).toBe('^20.19.0 || >=22.12.0')
  })

  it('says what Install and a version need', () => {
    const requirement = { range: '>=22.19.0', found: '20.19.6' }
    expect(installNeedsNodeVersionMessage(requirement)).toBe(
      'Install needs Node.js 22.19.0 or later',
    )
    expect(nodeRequirementMessage('1.3.0', requirement)).toBe(
      '1.3.0 needs Node.js 22.19.0 or later (yours is 20.19.6)',
    )
  })
})

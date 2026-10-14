import { describe, expect, it } from 'vitest'
import { environmentEntries, environmentText, systemName, type AppInfo } from './app-info'

const mac: AppInfo = {
  version: '0.1.0-alpha.2',
  system: 'macOS',
  systemVersion: '26.3.1',
  arch: 'arm64',
  electron: '44.7.0',
  chromium: '152.0.7977.130',
  node: '24.21.0',
}

describe('systemName', () => {
  it('names the systems Hoot runs on', () => {
    expect(systemName('darwin')).toBe('macOS')
    expect(systemName('win32')).toBe('Windows')
  })

  it('leaves any other platform as it is called', () => {
    expect(systemName('linux')).toBe('Linux')
    expect(systemName('freebsd')).toBe('freebsd')
  })
})

describe('environmentEntries', () => {
  it('gives the system with its architecture in brackets, then Electron, Chromium and Node.js', () => {
    expect(environmentEntries(mac)).toEqual([
      { name: 'macOS', value: '26.3.1 (arm64)' },
      { name: 'Electron', value: '44.7.0' },
      { name: 'Chromium', value: '152.0.7977.130' },
      { name: 'Node.js', value: '24.21.0' },
    ])
  })

  it('names Windows and gives its architecture', () => {
    const [system] = environmentEntries({
      ...mac,
      system: 'Windows',
      systemVersion: '10.0.26100',
      arch: 'x64',
    })
    expect(system).toEqual({ name: 'Windows', value: '10.0.26100 (x64)' })
  })
})

describe('environmentText', () => {
  it("starts with Hoot's version, then has a line for each part of the environment", () => {
    expect(environmentText(mac)).toBe(
      [
        'Hoot 0.1.0-alpha.2',
        'macOS 26.3.1 (arm64)',
        'Electron 44.7.0',
        'Chromium 152.0.7977.130',
        'Node.js 24.21.0',
      ].join('\n'),
    )
  })
})

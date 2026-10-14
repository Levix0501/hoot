import { describe, expect, it } from 'vitest'
import { readAppInfo } from './app-info'

describe('readAppInfo', () => {
  it('names the system, and takes Chromium from the version Electron calls chrome', () => {
    expect(
      readAppInfo({
        version: '0.1.0-alpha.2',
        platform: 'darwin',
        systemVersion: '26.3.1',
        arch: 'arm64',
        versions: { electron: '44.7.0', chrome: '152.0.7977.130', node: '24.21.0' },
      }),
    ).toEqual({
      version: '0.1.0-alpha.2',
      system: 'macOS',
      systemVersion: '26.3.1',
      arch: 'arm64',
      electron: '44.7.0',
      chromium: '152.0.7977.130',
      node: '24.21.0',
    })
  })

  it('names Windows and gives its architecture', () => {
    const info = readAppInfo({
      version: '0.1.0-alpha.2',
      platform: 'win32',
      systemVersion: '10.0.26100',
      arch: 'x64',
      versions: { electron: '44.7.0', chrome: '152.0.7977.130', node: '24.21.0' },
    })
    expect([info.system, info.systemVersion, info.arch]).toEqual(['Windows', '10.0.26100', 'x64'])
  })
})

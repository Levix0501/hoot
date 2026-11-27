import { describe, expect, it } from 'vitest'
import { releasesOf } from './releases'

describe('releasesOf', () => {
  it('offers the newest releases of their own, from the oldest version Hoot works with', () => {
    const releases = releasesOf('opencode', '@opencode/cli', 'opencode', {
      'dist-tags': { latest: '2.4.2', beta: '0.0.0-beta-19507' },
      time: {
        '2.4.2': '2026-11-20T08:00:00.000Z',
        '2.1.0': '2026-10-12T08:00:00.000Z',
        '2.0.32': '2026-10-09T08:00:00.000Z',
      },
      versions: {
        '1.18.35': {},
        '2.0.32': {},
        '2.1.0': {},
        '2.4.2': {},
        '2.4.3-beta.1': {},
        '0.0.0-beta-19507': {},
      },
    })
    expect(releases.versions).toEqual([
      { version: '2.4.2', date: '2026-11-20' },
      { version: '2.1.0', date: '2026-10-12' },
    ])
    expect(releases.stable).toBeNull()
  })
})

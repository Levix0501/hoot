import { describe, expect, it } from 'vitest'
import { hootSocketPath, MAX_SOCKET_PATH_BYTES } from './address'

/** A user data directory too deep to listen in. */
const deep = (name: string) => `/Users/me/${'nested/'.repeat(14)}${name}`

describe('hootSocketPath', () => {
  it('listens in the user data directory on macOS', () => {
    expect(hootSocketPath('/Users/me/Library/Application Support/Hoot', 'darwin', '/tmp/t')).toBe(
      '/Users/me/Library/Application Support/Hoot/hoot.sock',
    )
    expect(
      hootSocketPath('/Users/me/Library/Application Support/Hoot-dev', 'darwin', '/tmp/t'),
    ).toBe('/Users/me/Library/Application Support/Hoot-dev/hoot.sock')
  })

  it('listens in the folder for temporary files when the user data directory is too deep to connect to', () => {
    const socket = hootSocketPath(deep('Hoot'), 'darwin', '/var/folders/xy/abc/T')
    expect(socket).toMatch(/^\/var\/folders\/xy\/abc\/T\/hoot-[0-9a-f]{16}\.sock$/)
    expect(Buffer.byteLength(socket)).toBeLessThanOrEqual(MAX_SOCKET_PATH_BYTES)
    // Counted in bytes, which a name in another script takes more of than its characters.
    const wide = `/Users/me/${'項目/'.repeat(12)}Hoot`
    expect(wide.length).toBeLessThan(MAX_SOCKET_PATH_BYTES - 'hoot.sock'.length)
    expect(hootSocketPath(wide, 'darwin', '/tmp/t')).toMatch(/^\/tmp\/t\/hoot-[0-9a-f]{16}\.sock$/)
  })

  it('gives Hoots with different user data directories different places', () => {
    expect(hootSocketPath(deep('a'), 'darwin', '/tmp')).not.toBe(
      hootSocketPath(deep('b'), 'darwin', '/tmp'),
    )
    expect(hootSocketPath(deep('a'), 'darwin', '/tmp')).toBe(
      hootSocketPath(deep('a'), 'darwin', '/tmp'),
    )
  })

  it('listens on a named pipe on Windows', () => {
    const installed = hootSocketPath('C:\\Users\\me\\AppData\\Roaming\\Hoot', 'win32')
    const fromRepository = hootSocketPath('C:\\Users\\me\\AppData\\Roaming\\Hoot-dev', 'win32')
    for (const pipe of [installed, fromRepository]) {
      expect(pipe.startsWith('\\\\.\\pipe\\') || pipe.startsWith('\\\\?\\pipe\\')).toBe(true)
      expect(pipe).toMatch(/^\\\\\.\\pipe\\hoot-[0-9a-f]{16}$/)
    }
    expect(installed).not.toBe(fromRepository)
  })
})

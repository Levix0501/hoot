import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { canonicalPath, homeDisplayPath, isInside, samePath } from './agent-paths'

describe('paths as they are on disk and as Hoot shows them', () => {
  it('follows symbolic links, also of the part of a path that exists', async () => {
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-canonical-')))
    try {
      fs.mkdirSync(path.join(root, 'real'))
      fs.symlinkSync(path.join(root, 'real'), path.join(root, 'link'))
      expect(await canonicalPath(path.join(root, 'link'))).toBe(path.join(root, 'real'))
      expect(await canonicalPath(path.join(root, 'link', 'not', 'yet'))).toBe(
        path.join(root, 'real', 'not', 'yet'),
      )
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('writes the home folder as ~, however the path writes it', () => {
    expect(homeDisplayPath('/Users/me/.local/bin/claude', '/Users/me', '/Users/me')).toBe(
      '~/.local/bin/claude',
    )
    expect(homeDisplayPath('/private/var/home/x', '/var/home', '/private/var/home')).toBe('~/x')
    expect(homeDisplayPath('/opt/homebrew/bin/claude', '/Users/me', '/Users/me')).toBe(
      '/opt/homebrew/bin/claude',
    )
  })

  it('tells a path below a folder', () => {
    expect(isInside('/a/b/c', '/a/b')).toBe(true)
    expect(isInside('/a/b', '/a/b')).toBe(false)
    expect(isInside('/a/bc', '/a/b')).toBe(false)
    // On Windows a path is written with backslashes, and case does not matter.
    expect(isInside('C:\\Users\\me\\.local\\bin', 'C:\\Users\\me\\.local', 'win32')).toBe(true)
    expect(isInside('c:\\users\\ME\\.local\\bin', 'C:\\Users\\me\\.local', 'win32')).toBe(true)
    expect(isInside('C:\\Users\\me\\.local', 'C:\\Users\\me\\.local', 'win32')).toBe(false)
    expect(isInside('C:\\Users\\other', 'C:\\Users\\me', 'win32')).toBe(false)
  })

  it('tells two paths that name the same file', () => {
    expect(samePath('/a/b', '/a/b', 'darwin')).toBe(true)
    // Case matters outside Windows.
    expect(samePath('/a/b', '/A/b', 'darwin')).toBe(false)
    expect(
      samePath(
        'C:\\Users\\me\\AppData\\Roaming\\npm',
        'c:\\users\\ME\\appdata\\roaming\\NPM',
        'win32',
      ),
    ).toBe(true)
    expect(samePath('C:\\a', 'C:\\b', 'win32')).toBe(false)
  })
})

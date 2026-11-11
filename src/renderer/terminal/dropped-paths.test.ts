import { parse } from 'shell-quote'
import { describe, expect, it } from 'vitest'
import { droppedPathsText } from './dropped-paths'

describe('droppedPathsText', () => {
  it('pastes a path that needs no quoting as it is, followed by a space', () => {
    expect(droppedPathsText(['/Users/me/project/src/main.ts'], 'posix')).toBe(
      '/Users/me/project/src/main.ts ',
    )
  })

  it('quotes paths with spaces and shell characters as POSIX shell words', () => {
    const paths = [
      '/Users/me/Desktop/Screenshot 2026-11-11 at 11.06.12.png',
      '/Users/me/Desktop/截屏 2026-11-11.png',
      '/Users/me/notes (1).md',
      "/Users/me/it's here.txt",
      "/Users/me/it's done!.txt",
      '/Users/me/$HOME & `date`; [a]*?.txt',
      '/Users/me/back\\slash',
    ]
    for (const path of paths) {
      const text = droppedPathsText([path], 'posix')
      expect(text.endsWith(' ')).toBe(true)
      expect(parse(text)).toEqual([path])
    }
    expect(droppedPathsText([paths[0]], 'posix')).toBe(
      "'/Users/me/Desktop/Screenshot 2026-11-11 at 11.06.12.png' ",
    )
    expect(droppedPathsText(['/Users/me/x(1).png'], 'posix')).toBe('/Users/me/x\\(1\\).png ')
  })

  it('separates several paths with spaces', () => {
    const paths = ['/Users/me/a.png', '/Users/me/My Folder', '/Users/me/b(2).png']
    const text = droppedPathsText(paths, 'posix')
    expect(text).toBe("/Users/me/a.png '/Users/me/My Folder' /Users/me/b\\(2\\).png ")
    expect(parse(text)).toEqual(paths)
  })

  it('puts Windows paths with a space in double quotes, as Windows Terminal does', () => {
    expect(
      droppedPathsText(['C:\\Users\\me\\notes.md', 'C:\\Users\\me\\My Pictures\\a.png'], 'windows'),
    ).toBe('C:\\Users\\me\\notes.md "C:\\Users\\me\\My Pictures\\a.png" ')
  })

  it('leaves out control characters, which would end the line early', () => {
    expect(droppedPathsText(['/tmp/a\nb\r\u0003c.txt'], 'posix')).toBe('/tmp/abc.txt ')
    expect(droppedPathsText(['C:\\a\r\nb.txt'], 'windows')).toBe('C:\\ab.txt ')
  })

  it('is empty without paths, leaving out those of files that are not on disk', () => {
    expect(droppedPathsText([], 'posix')).toBe('')
    expect(droppedPathsText(['', ''], 'posix')).toBe('')
    expect(droppedPathsText(['', 'C:\\a.txt'], 'windows')).toBe('C:\\a.txt ')
  })
})

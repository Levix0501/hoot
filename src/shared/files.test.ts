import { describe, expect, it } from 'vitest'
import { entryExtension } from './files'

describe('entryExtension', () => {
  it("gives the extension of an entry's name, in lowercase", () => {
    expect(entryExtension('assets/logo.SVG')).toBe('svg')
    expect(entryExtension('archive.tar.gz')).toBe('gz')
    expect(entryExtension('src/index.ts')).toBe('ts')
  })

  it('gives none for a name without one', () => {
    for (const entry of ['Makefile', '.env', 'src/.png', 'notes.', 'src/', '']) {
      expect(entryExtension(entry)).toBeNull()
    }
  })
})

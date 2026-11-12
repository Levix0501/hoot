import { describe, expect, it } from 'vitest'
import {
  entryExtension,
  entryReference,
  isMarkdownPath,
  parentPath,
  referencedEntry,
} from './files'

describe('isMarkdownPath', () => {
  it('knows Markdown files by their extension', () => {
    for (const entry of ['README.md', 'docs/Guide.MD', 'notes.markdown']) {
      expect(isMarkdownPath(entry)).toBe(true)
    }
    for (const entry of ['index.mdx', 'md', 'docs.md/', 'README', 'a.txt']) {
      expect(isMarkdownPath(entry)).toBe(false)
    }
  })
})

describe('parentPath', () => {
  it('gives the folder an entry is in', () => {
    expect(parentPath('docs/api/a.md')).toBe('docs/api/')
    expect(parentPath('docs/api/')).toBe('docs/')
    expect(parentPath('a.md')).toBe('')
    expect(parentPath('docs/')).toBe('')
  })
})

describe('referencedEntry', () => {
  it('reads references from the folder of the document, as GitHub does', () => {
    expect(referencedEntry('docs/a.md', 'images/x.png')).toBe('docs/images/x.png')
    expect(referencedEntry('docs/a.md', './x.png')).toBe('docs/x.png')
    expect(referencedEntry('docs/a.md', '../assets/x.png')).toBe('assets/x.png')
    expect(referencedEntry('docs/a.md', '/assets/x.png')).toBe('assets/x.png')
    expect(referencedEntry('a.md', 'b.md')).toBe('b.md')
    expect(referencedEntry('docs/a.md', 'guides/')).toBe('docs/guides/')
  })

  it('leaves out the query and the fragment, and decodes escapes', () => {
    expect(referencedEntry('a.md', 'My%20Notes.md#usage')).toBe('My Notes.md')
    expect(referencedEntry('a.md', 'logo.png?raw=true')).toBe('logo.png')
    expect(referencedEntry('a.md', '%E4%B8%AD%E6%96%87.png')).toBe('中文.png')
    expect(referencedEntry('a.md', '100%.png')).toBe('100%.png')
  })

  it('names no entry for other references', () => {
    for (const reference of [
      'https://example.com/x.png',
      'mailto:someone@example.com',
      'data:image/png;base64,AAAA',
      '//example.com/x.png',
      'C:/x.png',
      '#usage',
      '?x',
      '',
      '/',
      '..',
      '../../x.png',
      'a%2Fb.png',
    ]) {
      expect(referencedEntry('docs/a.md', reference)).toBeNull()
    }
  })
})

describe('entryReference', () => {
  it('refers to an entry from the folder of the document', () => {
    expect(entryReference('a.md', 'image.png')).toBe('image.png')
    expect(entryReference('docs/a.md', 'docs/image.png')).toBe('image.png')
    expect(entryReference('docs/a.md', 'docs/img/x.png')).toBe('img/x.png')
    expect(entryReference('docs/api/a.md', 'assets/x.png')).toBe('../../assets/x.png')
    expect(entryReference('docs/api/a.md', 'docs/x.png')).toBe('../x.png')
  })

  it('gives references that read back as the entry', () => {
    for (const [document, entry] of [
      ['docs/api/a.md', 'assets/x.png'],
      ['a.md', 'docs/b.md'],
      ['docs/a.md', 'docs/a.md'],
    ] as const) {
      expect(referencedEntry(document, entryReference(document, entry))).toBe(entry)
    }
  })
})

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

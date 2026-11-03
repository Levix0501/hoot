import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_OPENED_FILE_BYTES } from '../../shared/files'
import { entryLocation, listFolder, readTextFile, writeTextFile } from './folder-files'

describe('folder files', () => {
  let root: string
  let folder: string

  beforeEach(() => {
    root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-folder-files-')))
    folder = path.join(root, 'project')
    fs.mkdirSync(path.join(folder, 'src'), { recursive: true })
  })

  afterEach(async () => {
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  const write = (entry: string, content: string | Buffer) =>
    fs.writeFileSync(path.join(folder, ...entry.split('/')), content)

  describe('entryLocation', () => {
    it('finds the entries of the folder, and the folder itself', () => {
      expect(entryLocation(folder, '')).toBe(folder)
      expect(entryLocation(folder, 'src/')).toBe(path.join(folder, 'src'))
      expect(entryLocation(folder, 'src/index.ts')).toBe(path.join(folder, 'src', 'index.ts'))
    })

    it('names nothing outside the folder', () => {
      for (const entry of ['..', '../x', 'src/../../x', '/etc/passwd', 'src//x', './x', 'a\0b']) {
        expect(entryLocation(folder, entry)).toBeNull()
      }
    })
  })

  describe('listFolder', () => {
    it("lists a folder's files and folders, without what the Explorer leaves out", async () => {
      write('README.md', '# Hi')
      write('src/index.ts', '')
      fs.mkdirSync(path.join(folder, '.git'))
      write('.DS_Store', '')
      write('.env', 'A=1')
      const top = await listFolder(folder, '')
      expect(top.kind).toBe('listed')
      if (top.kind !== 'listed') return
      expect(top.entries.toSorted((a, b) => a.name.localeCompare(b.name))).toEqual([
        { name: '.env', directory: false },
        { name: 'README.md', directory: false },
        { name: 'src', directory: true },
      ])
      expect(await listFolder(folder, 'src/')).toEqual({
        kind: 'listed',
        entries: [{ name: 'index.ts', directory: false }],
      })
    })

    it('says when the folder is gone', async () => {
      expect(await listFolder(folder, 'gone/')).toEqual({ kind: 'missing' })
    })

    it('takes only folder paths', async () => {
      write('README.md', '')
      expect((await listFolder(folder, 'README.md')).kind).toBe('error')
      expect((await listFolder(folder, '../')).kind).toBe('error')
    })

    it.skipIf(process.platform === 'win32')(
      'shows a link as what it leads to, without folders outside the folder',
      async () => {
        write('src/index.ts', '')
        fs.mkdirSync(path.join(root, 'outside'))
        fs.symlinkSync(path.join(folder, 'src'), path.join(folder, 'inside-link'))
        fs.symlinkSync(path.join(folder, 'src', 'index.ts'), path.join(folder, 'file-link'))
        fs.symlinkSync(path.join(root, 'outside'), path.join(folder, 'outside-link'))
        fs.symlinkSync(path.join(folder, 'nowhere'), path.join(folder, 'broken-link'))
        const listed = await listFolder(folder, '')
        expect(listed.kind).toBe('listed')
        if (listed.kind !== 'listed') return
        expect(listed.entries.toSorted((a, b) => a.name.localeCompare(b.name))).toEqual([
          { name: 'broken-link', directory: false },
          { name: 'file-link', directory: false },
          { name: 'inside-link', directory: true },
          { name: 'src', directory: true },
        ])
      },
    )
  })

  describe('readTextFile', () => {
    it("reads a file's text and version", async () => {
      write('src/index.ts', 'export const a = 1\r\n')
      const stats = fs.statSync(path.join(folder, 'src', 'index.ts'))
      expect(await readTextFile(folder, 'src/index.ts')).toEqual({
        kind: 'text',
        content: 'export const a = 1\r\n',
        version: { mtimeMs: stats.mtimeMs, size: stats.size },
        bom: false,
      })
    })

    it('reads past a byte order mark, and says it was there', async () => {
      write('a.txt', '﻿hello')
      const read = await readTextFile(folder, 'a.txt')
      expect(read).toMatchObject({ kind: 'text', content: 'hello', bom: true })
    })

    it('does not read binary files, text in other encodings, or folders', async () => {
      write('image.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]))
      write('latin1.txt', Buffer.from([0x63, 0x61, 0x66, 0xe9]))
      expect(await readTextFile(folder, 'image.png')).toEqual({ kind: 'not-text' })
      expect(await readTextFile(folder, 'latin1.txt')).toEqual({ kind: 'not-text' })
      expect(await readTextFile(folder, 'src')).toEqual({ kind: 'not-text' })
    })

    it('does not read a file too large to edit', async () => {
      write('big.txt', Buffer.alloc(MAX_OPENED_FILE_BYTES + 1, 0x61))
      expect(await readTextFile(folder, 'big.txt')).toEqual({
        kind: 'too-large',
        size: MAX_OPENED_FILE_BYTES + 1,
      })
    })

    it('says when the file is gone', async () => {
      expect(await readTextFile(folder, 'gone.txt')).toEqual({ kind: 'missing' })
    })
  })

  describe('writeTextFile', () => {
    it('writes over the file it read, and returns its new version', async () => {
      write('a.txt', 'one')
      const read = await readTextFile(folder, 'a.txt')
      if (read.kind !== 'text') throw new Error('not read')
      const written = await writeTextFile(folder, 'a.txt', 'two!', read.version, false)
      const stats = fs.statSync(path.join(folder, 'a.txt'))
      expect(written).toEqual({
        kind: 'saved',
        version: { mtimeMs: stats.mtimeMs, size: stats.size },
      })
      expect(fs.readFileSync(path.join(folder, 'a.txt'), 'utf8')).toBe('two!')
    })

    it('keeps the byte order mark', async () => {
      write('a.txt', '﻿one')
      const read = await readTextFile(folder, 'a.txt')
      if (read.kind !== 'text') throw new Error('not read')
      await writeTextFile(folder, 'a.txt', 'two', read.version, read.bom)
      expect(fs.readFileSync(path.join(folder, 'a.txt'), 'utf8')).toBe('﻿two')
    })

    it('leaves a file alone that changed since it was read', async () => {
      write('a.txt', 'one')
      const read = await readTextFile(folder, 'a.txt')
      if (read.kind !== 'text') throw new Error('not read')
      write('a.txt', 'changed by an agent')
      expect(await writeTextFile(folder, 'a.txt', 'mine', read.version, false)).toEqual({
        kind: 'changed',
      })
      expect(fs.readFileSync(path.join(folder, 'a.txt'), 'utf8')).toBe('changed by an agent')
    })

    it('does not bring back a file that is gone', async () => {
      write('a.txt', 'one')
      const read = await readTextFile(folder, 'a.txt')
      if (read.kind !== 'text') throw new Error('not read')
      fs.rmSync(path.join(folder, 'a.txt'))
      expect(await writeTextFile(folder, 'a.txt', 'mine', read.version, false)).toEqual({
        kind: 'missing',
      })
      expect(fs.existsSync(path.join(folder, 'a.txt'))).toBe(false)
    })

    it('writes nothing outside the folder', async () => {
      const result = await writeTextFile(folder, '../x.txt', 'x', { mtimeMs: 0, size: 0 }, false)
      expect(result.kind).toBe('error')
      expect(fs.existsSync(path.join(root, 'x.txt'))).toBe(false)
    })
  })
})

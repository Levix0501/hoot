import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deleteContents } from './delete-contents'

// macOS's locked flag makes deleting a file fail with EPERM, which is tried
// again, as it is for a file in use on Windows.
describe.runIf(process.platform === 'darwin')('deleting what is in a folder', () => {
  let root: string
  let locked: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-delete-contents-'))
    fs.writeFileSync(path.join(root, '.git'), 'gitdir: elsewhere\n')
    fs.writeFileSync(path.join(root, 'README.md'), '\n')
    // As deep as the default_app.asar in an Electron project's dependencies.
    locked = path.join(
      root,
      'node_modules/.pnpm/electron@44.7.0/node_modules/electron/dist',
      'Electron.app/Contents/Resources/locked.bin',
    )
    fs.mkdirSync(path.dirname(locked), { recursive: true })
    fs.writeFileSync(locked, 'x\n')
    execFileSync('chflags', ['uchg', locked])
  })

  afterEach(async () => {
    execFileSync('chflags', ['-R', 'nouchg', root])
    await fs.promises.rm(root, { recursive: true, force: true })
  })

  it('gives up within seconds on a file that stays undeletable deep inside, naming it', async () => {
    const started = Date.now()
    const problem = await deleteContents(root)
    expect(Date.now() - started).toBeLessThan(15_000)
    expect(problem).toContain('EPERM')
    expect(problem).toContain(locked)
    expect(fs.existsSync(path.join(root, '.git'))).toBe(true)
  })

  it('deletes a file that is let go of while it is tried again', async () => {
    const unlock = setTimeout(() => execFileSync('chflags', ['nouchg', locked]), 250)
    try {
      expect(await deleteContents(root)).toBeNull()
    } finally {
      clearTimeout(unlock)
    }
    expect(fs.readdirSync(root)).toEqual(['.git'])
  })
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { canCreateFilesIn, findComputerNpm, npmGlobalFolder, npmGlobalFolderOf } from './npm'

let root: string

/** A stand-in npm whose global folder is `prefix`, which warns on standard error as npm may. */
function fakeNpm(file: string, prefix: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(
    file,
    `#!/bin/sh\necho 'npm warn Unknown user config' >&2\n[ "$1 $2" = "prefix -g" ] && echo ${JSON.stringify(prefix)}\n`,
    { mode: 0o755 },
  )
}

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-npm-')))
})

afterEach(() => {
  for (const folder of ['global/lib/node_modules', 'global/bin', 'locked']) {
    const target = path.join(root, folder)
    if (fs.existsSync(target)) fs.chmodSync(target, 0o755)
  }
  fs.rmSync(root, { recursive: true, force: true })
})

describe('npmGlobalFolder', () => {
  it('reads what npm prefix -g writes on its standard output', async () => {
    const prefix = path.join(root, 'global')
    fs.mkdirSync(prefix)
    fakeNpm(path.join(root, 'bin', 'npm'), prefix)
    expect(await npmGlobalFolder(path.join(root, 'bin', 'npm'), {}, root)).toBe(prefix)
  })

  it('reads none from an npm that fails or does not run', async () => {
    const npm = path.join(root, 'npm')
    fs.writeFileSync(npm, '#!/bin/sh\nexit 1\n', { mode: 0o755 })
    expect(await npmGlobalFolder(npm, {}, root)).toBeNull()
    expect(await npmGlobalFolder(path.join(root, 'missing'), {}, root)).toBeNull()
  })

  it('runs the npm of another folder with that folder first on PATH', async () => {
    const npm = path.join(root, 'other', 'bin', 'npm')
    fs.mkdirSync(path.dirname(npm), { recursive: true })
    fs.writeFileSync(npm, '#!/bin/sh\necho "${PATH%%:*}"\n', { mode: 0o755 })
    expect(await npmGlobalFolderOf(npm, { PATH: '/usr/bin:/bin' }, root)).toBe(path.dirname(npm))
  })
})

describe('canCreateFilesIn', () => {
  it('checks the folder, or the nearest of its parents that exists', async () => {
    expect(await canCreateFilesIn(root)).toBe(true)
    expect(await canCreateFilesIn(path.join(root, 'not', 'yet'))).toBe(true)
    const locked = path.join(root, 'locked')
    fs.mkdirSync(locked)
    fs.chmodSync(locked, 0o555)
    expect(await canCreateFilesIn(locked)).toBe(false)
    expect(await canCreateFilesIn(path.join(locked, 'inside'))).toBe(false)
    const notFolder = path.join(root, 'file')
    fs.writeFileSync(notFolder, '')
    expect(await canCreateFilesIn(path.join(notFolder, 'inside'))).toBe(false)
  })
})

describe('findComputerNpm', () => {
  it('finds the first npm on PATH, its global folder and whether it can install into it', async () => {
    const prefix = path.join(root, 'global')
    fs.mkdirSync(path.join(prefix, 'lib', 'node_modules'), { recursive: true })
    fakeNpm(path.join(prefix, 'bin', 'npm'), prefix)
    const env = { PATH: `${path.join(prefix, 'bin')}:/usr/bin:/bin` }
    expect(await findComputerNpm(env, root)).toEqual({
      path: path.join(prefix, 'bin', 'npm'),
      prefix,
      usable: true,
    })
    fs.chmodSync(path.join(prefix, 'lib', 'node_modules'), 0o555)
    expect((await findComputerNpm(env, root))?.usable).toBe(false)
    fs.chmodSync(path.join(prefix, 'lib', 'node_modules'), 0o755)
    fs.chmodSync(path.join(prefix, 'bin'), 0o555)
    expect((await findComputerNpm(env, root))?.usable).toBe(false)
  })

  it('finds none without an npm on PATH', async () => {
    expect(await findComputerNpm({ PATH: root }, root)).toBeNull()
  })
})

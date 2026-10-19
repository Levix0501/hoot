import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { onPath, writeNodeCommand } from '../tools/test-support'
import { samePath } from './agent-paths'
import { canCreateFilesIn, findComputerNpm, npmGlobalFolder, npmGlobalFolderOf } from './npm'
import { npmCommandsFolder, npmPackagesFolder } from './test-support'

let root: string

/**
 * A stand-in npm whose global folder is `prefix`, which warns on standard
 * error as npm may. Returns the path a PATH lookup finds it at.
 */
function fakeNpm(file: string, prefix: string): Promise<string> {
  return writeNodeCommand(
    file,
    'console.error("npm warn Unknown user config")\n' +
      `if (process.argv.slice(2, 4).join(" ") === "prefix -g") console.log(${JSON.stringify(prefix)})\n`,
  )
}

beforeEach(() => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-npm-')))
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
    const npm = await fakeNpm(path.join(root, 'bin', 'npm'), prefix)
    expect(await npmGlobalFolder(npm, {}, root)).toBe(prefix)
  })

  it('reads none from an npm that fails or does not run', async () => {
    const npm = await writeNodeCommand(path.join(root, 'npm'), 'process.exitCode = 1')
    expect(await npmGlobalFolder(npm, {}, root)).toBeNull()
    expect(await npmGlobalFolder(path.join(root, 'missing'), {}, root)).toBeNull()
  })

  it('runs the npm of another folder with that folder first on PATH', async () => {
    const npm = await writeNodeCommand(
      path.join(root, 'other', 'bin', 'npm'),
      'console.log(process.env.PATH.split(require("node:path").delimiter)[0])',
    )
    expect(await npmGlobalFolderOf(npm, { PATH: path.join(root, 'elsewhere') }, root)).toBe(
      path.dirname(npm),
    )
  })
})

describe('canCreateFilesIn', () => {
  it('checks the folder, or the nearest of its parents that exists', async () => {
    expect(await canCreateFilesIn(root)).toBe(true)
    expect(await canCreateFilesIn(path.join(root, 'not', 'yet'))).toBe(true)
    const notFolder = path.join(root, 'file')
    fs.writeFileSync(notFolder, '')
    expect(await canCreateFilesIn(path.join(notFolder, 'inside'))).toBe(false)
  })

  // Folders have no permission bits on Windows, and fs.access does not read their access control lists.
  it.skipIf(process.platform === 'win32')(
    'refuses a folder the user cannot create files in, also for what would be created in it',
    async () => {
      const locked = path.join(root, 'locked')
      fs.mkdirSync(locked)
      fs.chmodSync(locked, 0o555)
      expect(await canCreateFilesIn(locked)).toBe(false)
      expect(await canCreateFilesIn(path.join(locked, 'inside'))).toBe(false)
    },
  )
})

describe('findComputerNpm', () => {
  it('finds the first npm on PATH, its global folder and whether it can install into it', async () => {
    const prefix = path.join(root, 'global')
    const packages = npmPackagesFolder(prefix)
    const commands = npmCommandsFolder(prefix)
    fs.mkdirSync(packages, { recursive: true })
    const npm = await fakeNpm(path.join(commands, 'npm'), prefix)
    const env = { PATH: onPath(commands, path.join(root, 'elsewhere')) }
    const found = await findComputerNpm(env, root)
    expect(found).toEqual({ path: expect.any(String), prefix, usable: true })
    // On Windows the lookup spells the extension as PATHEXT does.
    expect(samePath(found!.path, npm)).toBe(true)
  })

  // Folders have no permission bits on Windows, and fs.access does not read their access control lists.
  it.skipIf(process.platform === 'win32')(
    'finds that it cannot install into a global folder whose packages or commands the user cannot add to',
    async () => {
      const prefix = path.join(root, 'global')
      fs.mkdirSync(path.join(prefix, 'lib', 'node_modules'), { recursive: true })
      await fakeNpm(path.join(prefix, 'bin', 'npm'), prefix)
      const env = { PATH: `${path.join(prefix, 'bin')}:/usr/bin:/bin` }
      expect((await findComputerNpm(env, root))?.usable).toBe(true)
      fs.chmodSync(path.join(prefix, 'lib', 'node_modules'), 0o555)
      expect((await findComputerNpm(env, root))?.usable).toBe(false)
      fs.chmodSync(path.join(prefix, 'lib', 'node_modules'), 0o755)
      fs.chmodSync(path.join(prefix, 'bin'), 0o555)
      expect((await findComputerNpm(env, root))?.usable).toBe(false)
    },
  )

  it('finds none without an npm on PATH', async () => {
    expect(await findComputerNpm({ PATH: root }, root)).toBeNull()
  })
})

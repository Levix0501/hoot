import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { samePath } from '../agents/agent-paths'
import { findCommand, pathFolders } from './find-command'
import { onPath, writeNodeCommand } from './test-support'

let root: string
/** The command in `c`, as a lookup finds it. */
let tool: string

beforeAll(async () => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-find-')))
  for (const directory of ['a', 'b', 'c']) fs.mkdirSync(path.join(root, directory))
  fs.writeFileSync(path.join(root, 'a', 'tool'), 'not executable', { mode: 0o644 })
  // A folder by the name a lookup tries: on Windows, with an extension of PATHEXT.
  fs.mkdirSync(path.join(root, 'b', process.platform === 'win32' ? 'tool.cmd' : 'tool'))
  tool = await writeNodeCommand(path.join(root, 'c', 'tool'), '')
})

afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

/** Whether a lookup found `tool`, whose extension it spells on Windows as PATHEXT does. */
const isTool = (found: string | null) => found !== null && samePath(found, tool)

describe('findCommand', () => {
  it('returns the first executable file in PATH order', async () => {
    const pathValue = onPath(...['a', 'b', 'c'].map((directory) => path.join(root, directory)))
    expect(await findCommand('tool', { PATH: pathValue })).toSatisfy(isTool)
  })

  it('returns null when no PATH entry has the command', async () => {
    expect(await findCommand('tool', { PATH: path.join(root, 'a') })).toBeNull()
    expect(await findCommand('missing', { PATH: path.join(root, 'c') })).toBeNull()
    expect(await findCommand('tool', {})).toBeNull()
  })

  it('ignores relative PATH entries', async () => {
    // From the working directory, `c` is the folder with the command. The
    // tests start in the repository, from which no relative path leads to a
    // temporary folder on another drive, as on Windows.
    const cwd = process.cwd()
    process.chdir(root)
    try {
      expect(await findCommand('tool', { PATH: 'c' })).toBeNull()
    } finally {
      process.chdir(cwd)
    }
  })
})

describe('pathFolders', () => {
  it('reads PATH, keeping its absolute folders in order', () => {
    expect(pathFolders({ PATH: '/usr/local/bin:bin::/usr/bin' }, 'darwin')).toEqual([
      '/usr/local/bin',
      '/usr/bin',
    ])
    expect(pathFolders({}, 'darwin')).toEqual([])
  })

  it('takes the names of variables as case-sensitive outside Windows', () => {
    expect(pathFolders({ Path: '/usr/bin' }, 'darwin')).toEqual([])
  })

  it('reads Path on Windows, or PATH in any other case, separated by ;', () => {
    const windowsPath = 'C:\\Windows\\system32;C:\\Program Files\\Git\\cmd;;bin;'
    const folders = ['C:\\Windows\\system32', 'C:\\Program Files\\Git\\cmd']
    expect(pathFolders({ Path: windowsPath, USERPROFILE: 'C:\\Users\\me' }, 'win32')).toEqual(
      folders,
    )
    expect(pathFolders({ PATH: windowsPath }, 'win32')).toEqual(folders)
    expect(pathFolders({}, 'win32')).toEqual([])
  })
})

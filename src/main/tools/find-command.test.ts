import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findAgentCommand, findCommand, pathFolders } from './find-command'

let root: string

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-find-')))
  for (const directory of ['a', 'b', 'c']) fs.mkdirSync(path.join(root, directory))
  fs.writeFileSync(path.join(root, 'a', 'tool'), 'not executable', { mode: 0o644 })
  fs.mkdirSync(path.join(root, 'b', 'tool'))
  fs.writeFileSync(path.join(root, 'c', 'tool'), '#!/bin/sh\n', { mode: 0o755 })
})

afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

describe('findCommand', () => {
  it('returns the first executable file in PATH order', async () => {
    const pathValue = ['a', 'b', 'c'].map((directory) => path.join(root, directory)).join(':')
    expect(await findCommand('tool', { PATH: pathValue })).toBe(path.join(root, 'c', 'tool'))
  })

  it('returns null when no PATH entry has the command', async () => {
    expect(await findCommand('tool', { PATH: path.join(root, 'a') })).toBeNull()
    expect(await findCommand('missing', { PATH: path.join(root, 'c') })).toBeNull()
    expect(await findCommand('tool', {})).toBeNull()
  })

  it('ignores relative PATH entries', async () => {
    const relative = path.relative(process.cwd(), path.join(root, 'c'))
    expect(path.isAbsolute(relative)).toBe(false)
    expect(await findCommand('tool', { PATH: relative })).toBeNull()
  })
})

describe('findAgentCommand', () => {
  it('prefers the command on PATH to the one in the folder of agents', async () => {
    const agentsBin = path.join(root, 'c')
    expect(await findAgentCommand('tool', { PATH: path.join(root, 'c') }, agentsBin)).toBe(
      path.join(root, 'c', 'tool'),
    )
    expect(await findAgentCommand('tool', { PATH: path.join(root, 'a') }, agentsBin)).toBe(
      path.join(agentsBin, 'tool'),
    )
  })

  it('finds none where neither has it, or without a folder of agents', async () => {
    expect(await findAgentCommand('tool', {}, path.join(root, 'a'))).toBeNull()
    expect(await findAgentCommand('tool', {}, path.join(root, 'b'))).toBeNull()
    expect(await findAgentCommand('tool', {}, null)).toBeNull()
    expect(await findAgentCommand('tool', {}, path.join(root, 'missing'))).toBeNull()
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

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findCommand } from './find-command'

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
    expect(await findCommand('tool', pathValue)).toBe(path.join(root, 'c', 'tool'))
  })

  it('returns null when no PATH entry has the command', async () => {
    expect(await findCommand('tool', path.join(root, 'a'))).toBeNull()
    expect(await findCommand('missing', path.join(root, 'c'))).toBeNull()
    expect(await findCommand('tool', undefined)).toBeNull()
  })

  it('ignores relative PATH entries', async () => {
    const relative = path.relative(process.cwd(), path.join(root, 'c'))
    expect(path.isAbsolute(relative)).toBe(false)
    expect(await findCommand('tool', relative)).toBeNull()
  })
})

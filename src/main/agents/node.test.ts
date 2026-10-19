import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readNodeVersion, unmetNodeRequirement } from './node'

let root: string

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-node-')))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

/** A stand-in node in a folder of its own, which reports a version. */
function fakeNode(folder: string, script: string): string {
  const directory = path.join(root, folder)
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(path.join(directory, 'node'), `#!/bin/sh\n${script}\n`, { mode: 0o755 })
  return directory
}

// On Windows node is a program, node.exe, which no script can stand in for.
describe.skipIf(process.platform === 'win32')('readNodeVersion', () => {
  it('reads the version of the first node on PATH', async () => {
    const first = fakeNode('first', 'echo v20.19.6')
    const second = fakeNode('second', 'echo v24.15.0')
    expect(await readNodeVersion({ PATH: `${first}:${second}` }, root)).toBe('20.19.6')
  })

  it('reads none where PATH has no node, or it does not run', async () => {
    expect(await readNodeVersion({ PATH: path.join(root, 'empty') }, root)).toBeNull()
    const broken = fakeNode('broken', 'echo "dyld: Library not loaded" >&2; exit 134')
    expect(await readNodeVersion({ PATH: broken }, root)).toBeNull()
  })
})

describe('unmetNodeRequirement', () => {
  it('tells a range that the version is not in', () => {
    expect(unmetNodeRequirement('>=22.19.0', '20.19.6')).toEqual({
      range: '>=22.19.0',
      found: '20.19.6',
    })
    expect(unmetNodeRequirement('^20.19.0 || >=22.12.0', '22.11.0')).toEqual({
      range: '^20.19.0 || >=22.12.0',
      found: '22.11.0',
    })
  })

  it('tells none where the version is in the range, counting a pre-release as its release', () => {
    expect(unmetNodeRequirement('>=22.19.0', '24.15.0')).toBeNull()
    expect(unmetNodeRequirement('^20.19.0 || >=22.12.0', '20.19.6')).toBeNull()
    expect(unmetNodeRequirement('>=16', '16.0.0')).toBeNull()
    expect(unmetNodeRequirement('>=22', '25.0.0-nightly20261001abcdef')).toBeNull()
  })

  it('tells none where either is not known, or the range cannot be read', () => {
    expect(unmetNodeRequirement(null, '20.19.6')).toBeNull()
    expect(unmetNodeRequirement('>=22.19.0', null)).toBeNull()
    expect(unmetNodeRequirement('the latest LTS', '20.19.6')).toBeNull()
  })
})

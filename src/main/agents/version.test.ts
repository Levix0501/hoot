import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readVersion } from './version'

let root: string

function script(name: string, body: string): string {
  const file = path.join(root, name)
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 })
  return file
}

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-version-')))
})

afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

describe('readVersion', () => {
  it('reads the version an agent reports for --version', async () => {
    const claude = script('claude', '[ "$1" = --version ] && echo "2.1.293 (Claude Code)"')
    expect(await readVersion(claude, {}, root)).toEqual({ version: '2.1.293', output: '' })
  })

  it('keeps what an agent that does not run wrote, and how it ended', async () => {
    const failing = script('failing', 'echo "env: node: No such file or directory" >&2\nexit 127')
    expect(await readVersion(failing, {}, root)).toEqual({
      version: null,
      output: 'env: node: No such file or directory\nIt exited with code 127.',
    })
    const silent = script('silent', 'echo "\\033[31mno version here\\033[0m"')
    expect(await readVersion(silent, {}, root)).toEqual({
      version: null,
      output: 'no version here\nIt reported no version.',
    })
    const slow = script('slow', 'sleep 5')
    expect(await readVersion(slow, {}, root, process.platform, 100)).toEqual({
      version: null,
      output: 'It did not finish within 0.1 seconds.',
    })
    expect((await readVersion(path.join(root, 'missing'), {}, root)).output).toMatch(
      /^It could not start: .*ENOENT/,
    )
  })
})

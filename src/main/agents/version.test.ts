import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { writeNodeCommand } from '../tools/test-support'
import { readVersion } from './version'

let root: string

/** A stand-in agent command, which runs `script` with Node.js. */
function script(name: string, body: string): Promise<string> {
  return writeNodeCommand(path.join(root, name), body)
}

beforeAll(() => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-version-')))
})

afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

describe('readVersion', () => {
  it('reads the version an agent reports for --version', async () => {
    const claude = await script(
      'claude',
      'if (process.argv[2] === "--version") console.log("2.1.293 (Claude Code)")',
    )
    expect(await readVersion(claude, {}, root)).toEqual({ version: '2.1.293', output: '' })
  })

  it('keeps what an agent that does not run wrote, and how it ended', async () => {
    const failing = await script(
      'failing',
      'console.error("env: node: No such file or directory"); process.exitCode = 127',
    )
    expect(await readVersion(failing, {}, root)).toEqual({
      version: null,
      output: 'env: node: No such file or directory\nIt exited with code 127.',
    })
    const silent = await script('silent', 'console.log("\\u001b[31mno version here\\u001b[0m")')
    expect(await readVersion(silent, {}, root)).toEqual({
      version: null,
      output: 'no version here\nIt reported no version.',
    })
    const slow = await script('slow', 'setTimeout(() => {}, 5000)')
    expect(await readVersion(slow, {}, root, process.platform, 100)).toEqual({
      version: null,
      output: 'It did not finish within 0.1 seconds.',
    })
    // On Windows, where an agent's command is a program or a batch file, a program.
    const missing = path.join(root, process.platform === 'win32' ? 'missing.exe' : 'missing')
    expect((await readVersion(missing, {}, root)).output).toMatch(/^It could not start: .*ENOENT/)
  })
})

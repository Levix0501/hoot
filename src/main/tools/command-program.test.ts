import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { cmdShim as pnpmCmdShim } from '@zkochan/cmd-shim'
import cmdShim from 'cmd-shim'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { commandProgram, commandTarget } from './command-program'

let root: string
/** A global folder of npm without Node.js, as `%APPDATA%\npm`. */
let npm: string
/** The folder of Node.js, also npm's global folder, as `C:\Program Files\nodejs`. */
let nodejs: string
/** pnpm's folder of commands. */
let pnpm: string
/** A folder on PATH with another Node.js. */
let otherNode: string
/** A batch file that no package manager made. */
let ownBatchFile: string

/** Writes a file, in folders made for it as needed, and returns its path. */
function write(file: string, text: string): string {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text, { mode: 0o755 })
  return file
}

/** Claude Code's command is a program, Codex's a script. */
const claudeProgram = (folder: string) =>
  path.join(folder, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
const codexScript = (folder: string) =>
  path.join(folder, 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
const opencodeScript = () =>
  path.join(pnpm, 'global', '5', 'node_modules', '@opencode', 'cli', 'bin', 'opencode')

beforeAll(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-program-')))
  npm = path.join(root, 'npm')
  nodejs = path.join(root, 'nodejs')
  pnpm = path.join(root, 'pnpm')
  otherNode = path.join(root, 'other-node')
  for (const folder of [nodejs, otherNode]) write(path.join(folder, 'node.exe'), '')
  // The batch files that npm and pnpm make for the commands of packages.
  for (const folder of [npm, nodejs]) {
    await cmdShim(write(claudeProgram(folder), 'MZ'), path.join(folder, 'claude'))
    await cmdShim(write(codexScript(folder), '#!/usr/bin/env node\n'), path.join(folder, 'codex'))
  }
  await pnpmCmdShim(write(claudeProgram(pnpm), 'MZ'), path.join(pnpm, 'claude'), {
    createCmdFile: true,
  })
  await pnpmCmdShim(write(opencodeScript(), '#!/usr/bin/env node\n'), path.join(pnpm, 'opencode'), {
    createCmdFile: true,
  })
  ownBatchFile = write(path.join(root, 'bin', 'claude.cmd'), '@echo off\r\nnpx claude %*\r\n')
})

afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

describe('commandProgram', () => {
  it('runs a command as it is outside Windows', async () => {
    expect(await commandProgram('/opt/homebrew/bin/claude', {}, 'darwin')).toEqual({
      file: '/opt/homebrew/bin/claude',
      args: [],
    })
  })

  it('runs a program as it is on Windows', async () => {
    for (const program of [
      'C:\\Users\\me\\.local\\bin\\claude.exe',
      'C:\\tools\\codex.EXE',
      'C:\\tools\\opencode.COM',
    ]) {
      expect(await commandProgram(program, {}, 'win32')).toEqual({ file: program, args: [] })
    }
  })

  it('runs the program that the batch file of npm or pnpm points to', async () => {
    // `which` spells the extension as PATHEXT does.
    expect(await commandProgram(path.join(npm, 'claude.CMD'), {}, 'win32')).toEqual({
      file: claudeProgram(npm),
      args: [],
    })
    expect(await commandProgram(path.join(pnpm, 'claude.cmd'), {}, 'win32')).toEqual({
      file: claudeProgram(pnpm),
      args: [],
    })
  })

  it('runs the script a batch file points to with the node.exe next to it, or else the first on PATH', async () => {
    const env = { PATH: otherNode }
    expect(await commandProgram(path.join(nodejs, 'codex.cmd'), env, 'win32')).toEqual({
      file: path.join(nodejs, 'node.exe'),
      args: [codexScript(nodejs)],
    })
    expect(await commandProgram(path.join(npm, 'codex.cmd'), env, 'win32')).toEqual({
      file: path.join(otherNode, 'node.exe'),
      args: [codexScript(npm)],
    })
    expect(await commandProgram(path.join(pnpm, 'opencode.cmd'), env, 'win32')).toEqual({
      file: path.join(otherNode, 'node.exe'),
      args: [opencodeScript()],
    })
  })

  it('says that a script needs Node.js when there is none', async () => {
    await expect(commandProgram(path.join(npm, 'codex.cmd'), {}, 'win32')).rejects.toThrow(
      `Node.js, which runs ${codexScript(npm)}, is not on PATH.`,
    )
  })

  it('refuses any other file on Windows, a batch file that no package manager made included', async () => {
    for (const command of [ownBatchFile, 'C:\\tools\\claude.bat', 'C:\\tools\\claude.js']) {
      await expect(commandProgram(command, {}, 'win32')).rejects.toThrow(
        `${command} is neither a program nor a command that npm or pnpm installed.`,
      )
    }
  })
})

describe('commandTarget', () => {
  it('tells what a batch file of npm or pnpm points to, and leaves other commands alone', async () => {
    expect(await commandTarget('/opt/homebrew/bin/claude', 'darwin')).toBe(
      '/opt/homebrew/bin/claude',
    )
    expect(await commandTarget(path.join(npm, 'claude.CMD'), 'win32')).toBe(claudeProgram(npm))
    expect(await commandTarget(path.join(pnpm, 'opencode.cmd'), 'win32')).toBe(opencodeScript())
    // A program, and a batch file that no package manager made.
    expect(await commandTarget('C:\\Users\\me\\.local\\bin\\claude.exe', 'win32')).toBe(
      'C:\\Users\\me\\.local\\bin\\claude.exe',
    )
    expect(await commandTarget(ownBatchFile, 'win32')).toBe(ownBatchFile)
  })

  it("tells what npm's own batch file, which the Node.js installer writes, runs", async () => {
    const installer = path.join(root, 'installer-nodejs')
    const npmCmd = write(
      path.join(installer, 'npm.cmd'),
      '@ECHO off\r\n"%~dp0\\node.exe" "%~dp0\\node_modules\\npm\\bin\\npm-cli.js" %*\r\n',
    )
    const npmCli = write(
      path.join(installer, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      '// npm\n',
    )
    expect(await commandTarget(npmCmd, 'win32')).toBe(npmCli)
    // The same batch file without npm beside it is one Hoot cannot read: it
    // counts as a command of its own.
    const loose = write(path.join(root, 'loose-npm', 'npm.cmd'), '@ECHO off\r\necho npm\r\n')
    expect(await commandTarget(loose, 'win32')).toBe(loose)
  })
})

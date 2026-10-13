import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/** The folder of hoot's launchers, which Hoot puts first on the PATH of its sessions. */
const bin = path.join(import.meta.dirname, '../../../resources/bin')
const run = promisify(execFile)

let directory: string
let node: string

beforeAll(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-launchers-'))
  // Stands in for Hoot's executable: says what it was run with, and exits with code 3.
  node = path.join(directory, 'Hoot')
  fs.writeFileSync(
    node,
    [
      '#!/bin/sh',
      'printf "ELECTRON_RUN_AS_NODE=%s\\n" "$ELECTRON_RUN_AS_NODE"',
      'printf "NODE_OPTIONS=%s\\n" "${NODE_OPTIONS-unset}"',
      'for argument in "$@"; do printf "[%s]\\n" "$argument"; done',
      'exit 3',
      '',
    ].join('\n'),
    { mode: 0o755 },
  )
})

afterAll(() => fs.rmSync(directory, { recursive: true, force: true }))

/** Runs the POSIX launcher, and returns its output and exit code. */
async function launch(args: string[], env: Record<string, string>) {
  try {
    const { stdout, stderr } = await run(path.join(bin, 'hoot'), args, { env })
    return { code: 0, stdout, stderr }
  } catch (error) {
    const failed = error as { code: number; stdout: string; stderr: string }
    return { code: failed.code, stdout: failed.stdout, stderr: failed.stderr }
  }
}

describe("hoot's launcher for macOS and Git Bash", () => {
  it("runs hoot's script with Hoot's executable as Node.js, with its arguments as given, and ends as it does", async () => {
    const script = '/Applications/Hoot.app/Contents/Resources/app.asar/dist-electron/cli/index.js'
    const result = await launch(['issue', 'create', '--title', 'a "b"  c', '--description', ''], {
      PATH: '/usr/bin:/bin',
      HOOT_NODE: node,
      HOOT_CLI: script,
      NODE_OPTIONS: '--require ./not-hoots.js',
    })
    expect(result).toEqual({
      code: 3,
      stdout: [
        'ELECTRON_RUN_AS_NODE=1',
        'NODE_OPTIONS=unset',
        `[${script}]`,
        '[issue]',
        '[create]',
        '[--title]',
        '[a "b"  c]',
        '[--description]',
        '[]',
        '',
      ].join('\n'),
      stderr: '',
    })
  })

  it('says that hoot works only in the sessions Hoot starts, outside them', async () => {
    const outside: Array<Record<string, string>> = [
      {},
      { HOOT_NODE: node },
      { HOOT_CLI: '/cli.js' },
    ]
    for (const env of outside) {
      const result = await launch(['issue', 'list'], { PATH: '/usr/bin:/bin', ...env })
      expect(result.code).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('hoot works only in the sessions that Hoot starts')
    }
  })
})

describe("hoot's launchers on Windows", () => {
  const cmd = fs.readFileSync(path.join(bin, 'hoot.cmd'), 'utf8')
  const sh = fs.readFileSync(path.join(bin, 'hoot'), 'utf8')

  it('lets PowerShell and cmd run hoot by name, through hoot.cmd, and Git Bash through hoot', () => {
    // PowerShell and cmd find a command by its name with each extension in
    // PATHEXT, whose default has .CMD; Git Bash finds a script by its name.
    const defaultPathExt = '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC'.split(';')
    expect(defaultPathExt).toContain(path.extname('hoot.cmd').toUpperCase())
    expect(fs.readdirSync(bin).toSorted()).toEqual(['hoot', 'hoot.cmd'])
    expect(sh.startsWith('#!/bin/sh\n')).toBe(true)
    expect(sh).toContain('ELECTRON_RUN_AS_NODE=1 exec "$HOOT_NODE" "$HOOT_CLI" "$@"')
  })

  it('keeps the line endings each launcher needs in any checkout, also one on Windows', async () => {
    // Git for Windows checks text files out with Windows line endings by
    // default, unless their attributes say otherwise: sh, Git Bash's too,
    // cannot run a script with them, and cmd needs them.
    const { stdout } = await run('git', ['check-attr', 'text', 'eol', '--', 'hoot', 'hoot.cmd'], {
      cwd: bin,
    })
    expect(stdout.split('\n')).toEqual([
      'hoot: text: set',
      'hoot: eol: lf',
      'hoot.cmd: text: set',
      'hoot.cmd: eol: crlf',
      '',
    ])
  })

  it("runs hoot's script with Hoot's executable as Node.js from cmd and PowerShell, and ends as it does", () => {
    const lines = cmd.split('\r\n')
    // cmd finds the labels of a batch file reliably only with Windows line endings.
    expect(cmd.replaceAll('\r\n', '')).not.toContain('\n')
    expect(lines[0]).toBe('@echo off')
    expect(lines).toContain('setlocal')
    expect(lines).toContain('set NODE_OPTIONS=')
    expect(lines).toContain('set ELECTRON_RUN_AS_NODE=1')
    expect(lines).toContain('"%HOOT_NODE%" "%HOOT_CLI%" %*')
    expect(lines).toContain('exit /b %ERRORLEVEL%')
  })

  it('says from cmd and PowerShell that hoot works only in the sessions Hoot starts, outside them', () => {
    const lines = cmd.split('\r\n')
    expect(lines).toContain('if not defined HOOT_NODE goto outside')
    expect(lines).toContain('if not defined HOOT_CLI goto outside')
    const outside = lines.indexOf(':outside')
    expect(outside).toBeGreaterThan(lines.indexOf('exit /b %ERRORLEVEL%'))
    expect(lines[outside + 1]).toMatch(
      /^echo error: hoot works only in the sessions that Hoot starts.* 1>&2$/,
    )
    expect(lines[outside + 2]).toBe('exit /b 1')
  })
})

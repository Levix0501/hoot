import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCommand, startProcess, type CommandSpec } from './processes'

let directory: string

beforeAll(() => {
  directory = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-processes-')))
})

afterAll(() => fs.rmSync(directory, { recursive: true, force: true }))

/** A script run by the Node.js that runs the tests: a command on every platform. */
const node = (script: string): CommandSpec => ({
  file: process.execPath,
  args: ['-e', script],
  env: { MARK: 'from the environment' },
  cwd: directory,
})

/** A script run by sh, for what only exists outside Windows: signals and process groups. */
const sh = (script: string): CommandSpec => ({
  file: '/bin/sh',
  args: ['-c', script],
  env: { PATH: '/usr/bin:/bin', MARK: 'from the environment' },
  cwd: directory,
})

describe('startProcess', () => {
  it('passes on what the command writes to both its outputs, as it arrives, and how it ended', async () => {
    const chunks: string[] = []
    const running = startProcess(
      node(
        [
          'process.stdout.write(process.env.MARK + " in " + process.cwd() + "\\n")',
          'setTimeout(() => process.stderr.write("to stderr\\n"), 200)',
          'setTimeout(() => { process.stdout.write("é"); process.exitCode = 3 }, 400)',
        ].join('\n'),
      ),
      (text) => chunks.push(text),
    )
    expect(await running.ended).toEqual({ code: 3, signal: null, error: null })
    expect(chunks.join('')).toBe(`from the environment in ${directory}\nto stderr\né`)
  })

  it('gives the command nothing on its standard input', async () => {
    const chunks: string[] = []
    const running = startProcess(
      node(
        'process.stdin.on("data", (chunk) => process.stdout.write(chunk))\n' +
          'process.stdin.on("end", () => console.log("done"))',
      ),
      (text) => chunks.push(text),
    )
    expect((await running.ended).code).toBe(0)
    expect(chunks.join('')).toBe('done\n')
  })

  // Windows has no signals: a process sent one is ended at once.
  it.skipIf(process.platform === 'win32')(
    'sends the process a signal while it runs, and not after it ended',
    async () => {
      let output = ''
      const running = startProcess(
        sh('trap "echo stopped; exit 7" TERM; echo ready; while :; do sleep 0.05; done'),
        (text) => {
          output += text
        },
      )
      await expect.poll(() => output, { timeout: 10_000 }).toBe('ready\n')
      running.signal('SIGTERM')
      expect(await running.ended).toEqual({ code: 7, signal: null, error: null })
      expect(output).toBe('ready\nstopped\n')
      // Once it has ended, signals go nowhere.
      running.signal('SIGTERM')
    },
  )

  it.runIf(process.platform === 'win32')(
    'ends the process on Windows when it is sent a signal, which it cannot handle there, and not after it ended',
    async () => {
      let output = ''
      const running = startProcess(
        node(
          'process.on("SIGTERM", () => console.log("stopped"))\n' +
            'console.log("ready")\n' +
            'setInterval(() => {}, 50)',
        ),
        (text) => {
          output += text
        },
      )
      await expect.poll(() => output, { timeout: 10_000 }).toBe('ready\n')
      running.signal('SIGTERM')
      expect(await running.ended).toEqual({ code: null, signal: 'SIGTERM', error: null })
      expect(output).toBe('ready\n')
      // Once it has ended, signals go nowhere.
      running.signal('SIGTERM')
    },
  )

  it('says why a command could not start', async () => {
    const running = startProcess({ ...node(''), file: path.join(directory, 'missing') }, () => {})
    const end = await running.ended
    expect(end.code).toBeNull()
    expect(end.error?.message).toContain('ENOENT')
  })
})

describe('runCommand', () => {
  it('returns what the command wrote to its standard output, and all it wrote', async () => {
    const result = await runCommand(
      node('console.log("out"); console.error("err"); console.log("more")'),
      5_000,
    )
    expect(result).toMatchObject({ code: 0, signal: null, error: null, timedOut: false })
    expect(result.stdout).toBe('out\nmore\n')
    expect(result.output.split('\n').toSorted()).toEqual(['', 'err', 'more', 'out'])
  })

  // Windows has neither signals nor process groups: see the test after this one.
  it.skipIf(process.platform === 'win32')(
    'ends a command that takes too long with SIGKILL, and what it started, which keeps its output open',
    async () => {
      const started = Date.now()
      const result = await runCommand(sh('trap "" TERM; echo started; sleep 10'), 300)
      expect(result).toMatchObject({ code: null, signal: 'SIGKILL', timedOut: true })
      expect(result.stdout).toBe('started\n')
      expect(Date.now() - started).toBeLessThan(5_000)
    },
  )

  // What a command that is not Node.js starts outlives it unless it is ended
  // too: here PING.EXE, which cmd.exe starts, keeps the error output open.
  it.runIf(process.platform === 'win32')(
    'ends a command that takes too long on Windows, and what it started, which keeps its output open',
    async () => {
      const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
      const ping = path.join(systemRoot, 'System32', 'PING.EXE')
      const started = Date.now()
      const result = await runCommand(
        {
          file: path.join(systemRoot, 'System32', 'cmd.exe'),
          args: ['/d', '/s', '/c', `echo started& ${ping} -n 10 127.0.0.1 >nul`],
          env: { SystemRoot: systemRoot },
          cwd: directory,
        },
        300,
      )
      expect(result).toMatchObject({ timedOut: true })
      expect(result.stdout).toBe('started\r\n')
      expect(Date.now() - started).toBeLessThan(5_000)
    },
  )

  // As the npm package of Codex starts codex.exe with Node.js: a console
  // window of its own would flash on the screen. PowerShell says which
  // window its console has.
  it.runIf(process.platform === 'win32')(
    'gives what a command starts on Windows a console without a window',
    async () => {
      const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
      const powershell = path.join(
        systemRoot,
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      )
      const consoleWindow =
        'Add-Type -Namespace Hoot -Name Console -MemberDefinition ' +
        `'[DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();'; ` +
        '[Hoot.Console]::GetConsoleWindow()'
      const args = ['-NoProfile', '-NonInteractive', '-Command', consoleWindow]
      const result = await runCommand(
        {
          ...node(
            `require("node:child_process").spawnSync(${JSON.stringify(powershell)}, ` +
              `${JSON.stringify(args)}, { stdio: "inherit" })`,
          ),
          env: { SystemRoot: systemRoot },
        },
        20_000,
      )
      expect(result).toMatchObject({ code: 0, timedOut: false })
      expect(result.stdout.trim()).toBe('0')
    },
  )

  it('says why a command could not start', async () => {
    const result = await runCommand({ ...node(''), file: path.join(directory, 'missing') }, 5_000)
    expect(result.error?.message).toContain('ENOENT')
    expect(result.timedOut).toBe(false)
  })
})

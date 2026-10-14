import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCommand, startProcess, type CommandSpec } from './processes'

let directory: string

beforeAll(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-processes-'))
})

afterAll(() => fs.rmSync(directory, { recursive: true, force: true }))

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
      sh(
        'echo "$MARK in $(pwd -P)"; sleep 0.2; echo "to stderr" >&2; sleep 0.2; printf "é"; exit 3',
      ),
      (text) => chunks.push(text),
    )
    expect(await running.ended).toEqual({ code: 3, signal: null, error: null })
    expect(chunks.join('')).toBe(
      `from the environment in ${fs.realpathSync(directory)}\nto stderr\né`,
    )
  })

  it('gives the command nothing on its standard input', async () => {
    const chunks: string[] = []
    const running = startProcess(sh('cat; echo done'), (text) => chunks.push(text))
    expect((await running.ended).code).toBe(0)
    expect(chunks.join('')).toBe('done\n')
  })

  it('sends the process a signal while it runs, and not after it ended', async () => {
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
  })

  it('says why a command could not start', async () => {
    const running = startProcess({ ...sh(''), file: path.join(directory, 'missing') }, () => {})
    const end = await running.ended
    expect(end.code).toBeNull()
    expect(end.error?.message).toContain('ENOENT')
  })
})

describe('runCommand', () => {
  it('returns what the command wrote to its standard output, and all it wrote', async () => {
    const result = await runCommand(sh('echo out; echo err >&2; echo more'), 5_000)
    expect(result).toMatchObject({ code: 0, signal: null, error: null, timedOut: false })
    expect(result.stdout).toBe('out\nmore\n')
    expect(result.output.split('\n').toSorted()).toEqual(['', 'err', 'more', 'out'])
  })

  it('ends a command that takes too long with SIGKILL, and what it started, which keeps its output open', async () => {
    const started = Date.now()
    const result = await runCommand(sh('trap "" TERM; echo started; sleep 10'), 300)
    expect(result).toMatchObject({ code: null, signal: 'SIGKILL', timedOut: true })
    expect(result.stdout).toBe('started\n')
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('says why a command could not start', async () => {
    const result = await runCommand({ ...sh(''), file: path.join(directory, 'missing') }, 5_000)
    expect(result.error?.message).toContain('ENOENT')
    expect(result.timedOut).toBe(false)
  })
})

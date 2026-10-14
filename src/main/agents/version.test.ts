import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fetchLatestVersion, type Fetch } from './latest-version'
import { runCommand, startProcess } from './processes'
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
    expect(await readVersion(slow, {}, root, 100)).toEqual({
      version: null,
      output: 'It did not finish within 0.1 seconds.',
    })
    expect((await readVersion(path.join(root, 'missing'), {}, root)).output).toMatch(
      /^It could not start: .*ENOENT/,
    )
  })
})

describe('processes', () => {
  it('runs a command to its end, keeping its standard output apart', async () => {
    const both = script('both', 'echo out\necho err >&2\nexit 3')
    const result = await runCommand({ file: both, args: [], env: {}, cwd: root }, 5_000)
    expect(result).toMatchObject({
      code: 3,
      signal: null,
      error: null,
      stdout: 'out\n',
      timedOut: false,
    })
    expect(result.output).toContain('out\n')
    expect(result.output).toContain('err\n')
  })

  it('passes on what a started process writes, and sends it signals', async () => {
    const waiting = script(
      'waiting',
      "trap 'echo stopped; exit 1' TERM\necho ready\nwhile :; do sleep 0.05; done",
    )
    let output = ''
    const process = startProcess({ file: waiting, args: [], env: {}, cwd: root }, (text) => {
      output += text
    })
    await expect.poll(() => output).toBe('ready\n')
    process.signal('SIGTERM')
    expect(await process.ended).toEqual({ code: 1, signal: null, error: null })
    expect(output).toBe('ready\nstopped\n')
    // Once it has ended, signals go nowhere.
    process.signal('SIGTERM')
  })

  it('says why a process could not start', async () => {
    const process = startProcess(
      { file: path.join(root, 'missing'), args: [], env: {}, cwd: root },
      () => {},
    )
    const end = await process.ended
    expect(end.code).toBeNull()
    expect(end.error?.message).toMatch(/ENOENT/)
  })
})

/** A registry that answers with this body and status. */
function answering(body: unknown, status = 200): Fetch {
  return async () => new Response(JSON.stringify(body), { status })
}

/** A registry that never answers, until the request is aborted. */
const never: Fetch = (_url, init) =>
  new Promise((_resolve, reject) =>
    init.signal.addEventListener('abort', () => reject(init.signal.reason)),
  )

describe('fetchLatestVersion', () => {
  it("reads the latest tag of the package's dist-tags on registry.npmjs.org", async () => {
    const urls: string[] = []
    const fetch: Fetch = async (url) => {
      urls.push(url)
      return new Response(JSON.stringify({ latest: '2.1.299', stable: '2.1.287' }))
    }
    expect(await fetchLatestVersion('@anthropic-ai/claude-code', fetch)).toBe('2.1.299')
    expect(urls).toEqual([
      'https://registry.npmjs.org/-/package/@anthropic-ai/claude-code/dist-tags',
    ])
  })

  it('reads none when the registry cannot be reached or answers otherwise', async () => {
    expect(await fetchLatestVersion('x', answering({ latest: '1.0.0' }, 404))).toBeNull()
    expect(await fetchLatestVersion('x', answering({ next: '1.0.0' }))).toBeNull()
    expect(await fetchLatestVersion('x', answering({ latest: 'soon' }))).toBeNull()
    expect(
      await fetchLatestVersion('x', async () => {
        throw new TypeError('fetch failed')
      }),
    ).toBeNull()
    expect(await fetchLatestVersion('x', never, 50)).toBeNull()
    // Also when the request does not stop when it is aborted.
    expect(await fetchLatestVersion('x', () => new Promise(() => {}), 50)).toBeNull()
  })
})

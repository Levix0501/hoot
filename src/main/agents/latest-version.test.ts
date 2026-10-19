import { describe, expect, it, vi } from 'vitest'
import { fetchLatestRelease, type Fetch } from './latest-version'

/** A request without a network. */
const offline: Fetch = async () => {
  throw new TypeError('net::ERR_INTERNET_DISCONNECTED')
}

/** A request that never gets an answer, and fails once it is aborted. */
const untilAborted: Fetch = (_url, init) =>
  new Promise((_resolve, reject) =>
    init.signal.addEventListener('abort', () => reject(init.signal.reason)),
  )

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Reads OpenCode's latest release from an answer. */
const read = (answer: Response) => fetchLatestRelease('opencode-ai', 'opencode', async () => answer)

describe('fetchLatestRelease', () => {
  it("reads the version of the package's latest tag on registry.npmjs.org, afresh", async () => {
    const fetch = vi.fn<Fetch>(async () =>
      json({
        name: '@anthropic-ai/claude-code',
        version: '2.1.303',
        engines: { node: '>=22.0.0' },
        bin: { claude: 'bin/claude.exe' },
      }),
    )
    // Its command is a program of its own, which runs without Node.js.
    expect(await fetchLatestRelease('@anthropic-ai/claude-code', 'claude', fetch)).toEqual({
      version: '2.1.303',
      node: null,
    })
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe('https://registry.npmjs.org/@anthropic-ai/claude-code/latest')
    expect(init?.cache).toBe('no-store')
  })

  it('reads the Node.js versions it needs where its command is a JavaScript file', async () => {
    const pi = json({
      version: '1.3.0',
      engines: { node: '>=22.19.0' },
      bin: { pi: 'dist/bundle/cli.js' },
    })
    expect(
      await fetchLatestRelease('@earendil-works/pi-coding-agent', 'pi', async () => pi),
    ).toEqual({ version: '1.3.0', node: '>=22.19.0' })
    for (const file of ['bin/codex.mjs', 'bin/codex.cjs']) {
      const codex = json({ version: '0.163.0', engines: { node: '>=16' }, bin: { codex: file } })
      expect(await fetchLatestRelease('@openai/codex', 'codex', async () => codex)).toEqual({
        version: '0.163.0',
        node: '>=16',
      })
    }
    // A single file is the command named after the package, without its scope.
    const single = json({ version: '1.0.0', engines: { node: '>=20' }, bin: 'cli.js' })
    expect(await fetchLatestRelease('@acme/agent', 'agent', async () => single)).toEqual({
      version: '1.0.0',
      node: '>=20',
    })
  })

  it('reads no Node.js versions where it names none, or the command is not among its files', async () => {
    const none = json({ version: '0.2.1', bin: { dsh: 'lib/bin.js' } })
    expect(await fetchLatestRelease('@deepseek-ai/dsh', 'dsh', async () => none)).toEqual({
      version: '0.2.1',
      node: null,
    })
    const other = json({ version: '1.0.0', engines: { node: '>=20' }, bin: { other: 'cli.js' } })
    expect(await fetchLatestRelease('@acme/agent', 'agent', async () => other)).toEqual({
      version: '1.0.0',
      node: null,
    })
    // Fields written in a way Hoot does not read do not keep it from the version.
    const odd = json({ version: '1.0.0', engines: ['node >= 0.8'], bin: 7 })
    expect(await fetchLatestRelease('@acme/agent', 'agent', async () => odd)).toEqual({
      version: '1.0.0',
      node: null,
    })
  })

  it('reads none from an answer that is not a success, or names no valid version', async () => {
    expect(await read(json({}, 404))).toBeNull()
    expect(await read(json({ name: 'opencode-ai' }))).toBeNull()
    expect(await read(json({ version: 'soon' }))).toBeNull()
    expect(await read(new Response('<html>', { status: 200 }))).toBeNull()
  })

  it('reads none when the request fails, as without a network', async () => {
    expect(await fetchLatestRelease('@openai/codex', 'codex', offline)).toBeNull()
  })

  it('gives up after the time allowed, aborting the request, and does not wait for it', async () => {
    let signal: AbortSignal | undefined
    // Never answers, not even once it is aborted.
    const fetch: Fetch = (_url, init) => {
      signal = init.signal
      return new Promise<Response>(() => {})
    }
    const started = Date.now()
    expect(await fetchLatestRelease('@openai/codex', 'codex', fetch, 50)).toBeNull()
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(signal?.aborted).toBe(true)
    // And when the request ends once it is aborted.
    expect(await fetchLatestRelease('@openai/codex', 'codex', untilAborted, 50)).toBeNull()
  })
})

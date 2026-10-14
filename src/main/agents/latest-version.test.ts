import { describe, expect, it, vi } from 'vitest'
import { fetchLatestVersion, type Fetch } from './latest-version'

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

describe('fetchLatestVersion', () => {
  it("reads the version the package's latest tag names on registry.npmjs.org, afresh", async () => {
    const fetch = vi.fn<Fetch>(async () => json({ latest: '2.1.299', stable: '2.1.287' }))
    expect(await fetchLatestVersion('@anthropic-ai/claude-code', fetch)).toBe('2.1.299')
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe('https://registry.npmjs.org/-/package/@anthropic-ai/claude-code/dist-tags')
    expect(init?.cache).toBe('no-store')
  })

  it('reads none from an answer that is not a success, or names no valid version', async () => {
    expect(await fetchLatestVersion('opencode-ai', async () => json({}, 404))).toBeNull()
    expect(await fetchLatestVersion('opencode-ai', async () => json({ next: '1.0.0' }))).toBeNull()
    expect(await fetchLatestVersion('opencode-ai', async () => json({ latest: 'soon' }))).toBeNull()
    expect(
      await fetchLatestVersion('opencode-ai', async () => new Response('<html>', { status: 200 })),
    ).toBeNull()
  })

  it('reads none when the request fails, as without a network', async () => {
    expect(await fetchLatestVersion('@openai/codex', offline)).toBeNull()
  })

  it('gives up after the time allowed, aborting the request, and does not wait for it', async () => {
    let signal: AbortSignal | undefined
    // Never answers, not even once it is aborted.
    const fetch: Fetch = (_url, init) => {
      signal = init.signal
      return new Promise<Response>(() => {})
    }
    const started = Date.now()
    expect(await fetchLatestVersion('@openai/codex', fetch, 50)).toBeNull()
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(signal?.aborted).toBe(true)
    // And when the request ends once it is aborted.
    expect(await fetchLatestVersion('@openai/codex', untilAborted, 50)).toBeNull()
  })
})

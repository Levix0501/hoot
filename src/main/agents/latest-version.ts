import { valid } from 'semver'
import { z } from 'zod'

/** How long reading a latest version may take. */
const TIMEOUT_MS = 15_000

/** The `fetch` that reads from registry.npmjs.org: Electron's, in Hoot. */
export type Fetch = (
  url: string,
  init: { signal: AbortSignal; cache: 'no-store' },
) => Promise<Response>

const distTags = z.object({ latest: z.string() })

/**
 * The version an npm package's `latest` tag names on registry.npmjs.org,
 * whatever registry the user's npm is set to use, asked afresh rather than
 * read from a cache; `null` when it cannot be read within `timeoutMs`, for
 * example without a network. The request is aborted then, and the answer is
 * not waited for, should it still come.
 */
export async function fetchLatestVersion(
  npmPackage: string,
  fetch: Fetch,
  timeoutMs = TIMEOUT_MS,
): Promise<string | null> {
  const controller = new AbortController()
  const timedOut = new Promise<null>((resolve) => {
    controller.signal.addEventListener('abort', () => resolve(null))
  })
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const read = (async () => {
    const response = await fetch(`https://registry.npmjs.org/-/package/${npmPackage}/dist-tags`, {
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!response.ok) return null
    const tags = distTags.safeParse(await response.json())
    return tags.success && valid(tags.data.latest) ? tags.data.latest : null
  })().catch(() => null)
  try {
    return await Promise.race([read, timedOut])
  } finally {
    clearTimeout(timer)
  }
}

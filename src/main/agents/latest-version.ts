import { valid } from 'semver'
import { z } from 'zod'

/** How long reading a latest version may take. */
const TIMEOUT_MS = 15_000

/** The `fetch` that reads from registry.npmjs.org: Electron's, in Hoot. */
export type Fetch = (
  url: string,
  init: { signal: AbortSignal; cache: 'no-store' },
) => Promise<Response>

/** What Hoot reads about the latest version of an agent's npm package. */
export interface LatestRelease {
  version: string
  /**
   * The Node.js versions it needs, as its `engines` field says, when the
   * agent's command runs on Node.js: when the file its `bin` field links the
   * command to is a JavaScript file, which runs with the `node` found on
   * PATH. `null` otherwise, and when it names none.
   */
  node: string | null
}

// Only the version must be there; the other fields count where they read.
const manifest = z.object({
  version: z.string(),
  engines: z.object({ node: z.string().optional() }).optional().catch(undefined),
  bin: z
    .union([z.string(), z.record(z.string(), z.string())])
    .optional()
    .catch(undefined),
})

/**
 * The file a package's `bin` field links a command to. A single file is
 * linked to the command named after the package, without its scope.
 */
function commandFile(
  bin: string | Record<string, string> | undefined,
  npmPackage: string,
  command: string,
): string | undefined {
  if (typeof bin === 'string') return npmPackage.split('/').at(-1) === command ? bin : undefined
  return bin?.[command]
}

/**
 * The version an npm package's `latest` tag names on registry.npmjs.org,
 * whatever registry the user's npm is set to use, and the Node.js versions
 * it needs where the agent's `command` runs on Node.js; asked afresh rather
 * than read from a cache. `null` when it cannot be read within `timeoutMs`,
 * for example without a network. The request is aborted then, and the
 * answer is not waited for, should it still come.
 */
export async function fetchLatestRelease(
  npmPackage: string,
  command: string,
  fetch: Fetch,
  timeoutMs = TIMEOUT_MS,
): Promise<LatestRelease | null> {
  const controller = new AbortController()
  const timedOut = new Promise<null>((resolve) => {
    controller.signal.addEventListener('abort', () => resolve(null))
  })
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const read = (async () => {
    const response = await fetch(`https://registry.npmjs.org/${npmPackage}/latest`, {
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!response.ok) return null
    const latest = manifest.safeParse(await response.json())
    if (!latest.success || !valid(latest.data.version)) return null
    const file = commandFile(latest.data.bin, npmPackage, command)
    const runsOnNode = file !== undefined && /\.[cm]?js$/i.test(file)
    return {
      version: latest.data.version,
      node: (runsOnNode && latest.data.engines?.node) || null,
    }
  })().catch(() => null)
  try {
    return await Promise.race([read, timedOut])
  } finally {
    clearTimeout(timer)
  }
}

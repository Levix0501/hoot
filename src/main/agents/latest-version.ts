import { valid } from 'semver'
import { z } from 'zod'
import type { CodingToolDefinition } from '../../shared/tools'

/** How long reading a latest version may take. */
const TIMEOUT_MS = 15_000

/**
 * Where Antigravity CLI's installers read the latest version for each
 * platform, with where to download it (see `antigravityPlatform`).
 */
const ANTIGRAVITY_MANIFESTS =
  'https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests'

/** The `fetch` that reads from registry.npmjs.org and the like: Electron's, in Hoot. */
export type Fetch = (
  url: string,
  init: { signal: AbortSignal; cache: 'no-store' },
) => Promise<Response>

/** What Hoot reads about the latest version of an agent. */
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
 * What `read` gives within `timeoutMs`; `null` when it fails, or takes
 * longer. It is aborted then, and its answer is not waited for, should it
 * still come.
 */
async function readWithin<T>(
  timeoutMs: number,
  read: (signal: AbortSignal) => Promise<T | null>,
): Promise<T | null> {
  const controller = new AbortController()
  const timedOut = new Promise<null>((resolve) => {
    controller.signal.addEventListener('abort', () => resolve(null))
  })
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await Promise.race([read(controller.signal).catch(() => null), timedOut])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The version an npm package's `latest` tag names on registry.npmjs.org,
 * whatever registry the user's npm is set to use, and the Node.js versions
 * it needs where the agent's `command` runs on Node.js; asked afresh rather
 * than read from a cache. `null` when it cannot be read within `timeoutMs`,
 * for example without a network.
 */
export function fetchLatestRelease(
  npmPackage: string,
  command: string,
  fetch: Fetch,
  timeoutMs = TIMEOUT_MS,
): Promise<LatestRelease | null> {
  return readWithin(timeoutMs, async (signal) => {
    const response = await fetch(`https://registry.npmjs.org/${npmPackage}/latest`, {
      signal,
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
  })
}

/**
 * The name Antigravity CLI's manifests give a platform, as its installers
 * name it, such as `darwin_arm64`; `null` for one it has no build for that
 * Hoot runs on.
 */
export function antigravityPlatform(platform: NodeJS.Platform, arch: string): string | null {
  const system =
    platform === 'darwin'
      ? 'darwin'
      : platform === 'win32'
        ? 'windows'
        : platform === 'linux'
          ? 'linux'
          : null
  const processor = arch === 'x64' ? 'amd64' : arch === 'arm64' ? 'arm64' : null
  return system === null || processor === null ? null : `${system}_${processor}`
}

// Only the version counts.
const antigravityManifest = z.object({ version: z.string() })

/**
 * The version of Antigravity CLI its installer would install on this
 * platform, as the manifest it reads names it, asked afresh rather than read
 * from a cache; it runs on no Node.js. `null` when it cannot be read within
 * `timeoutMs`, and for a platform it has no build for.
 */
export function fetchAntigravityRelease(
  fetch: Fetch,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  timeoutMs = TIMEOUT_MS,
): Promise<LatestRelease | null> {
  const name = antigravityPlatform(platform, arch)
  if (name === null) return Promise.resolve(null)
  return readWithin(timeoutMs, async (signal) => {
    const response = await fetch(`${ANTIGRAVITY_MANIFESTS}/${name}.json`, {
      signal,
      cache: 'no-store',
    })
    if (!response.ok) return null
    const latest = antigravityManifest.safeParse(await response.json())
    if (!latest.success || !valid(latest.data.version)) return null
    return { version: latest.data.version, node: null }
  })
}

/**
 * The latest version of an agent: its npm package's (see
 * `fetchLatestRelease`), or for Antigravity CLI, which comes in none, its
 * installer's (see `fetchAntigravityRelease`).
 */
export function fetchAgentRelease(
  tool: CodingToolDefinition,
  fetch: Fetch,
): Promise<LatestRelease | null> {
  if (tool.npmPackage !== null) return fetchLatestRelease(tool.npmPackage, tool.command, fetch)
  if (tool.id === 'antigravity') return fetchAntigravityRelease(fetch)
  return Promise.resolve(null)
}

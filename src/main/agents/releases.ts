import { compare, gte, parse, valid } from 'semver'
import { z } from 'zod'
import type { AgentRelease } from '../../shared/agents'
import { getCodingTool, type CodingToolId } from '../../shared/tools'
import type { Fetch } from './latest-version'

/**
 * How long reading an agent's releases may take: Codex's list of them is
 * about 2 MB on the wire, 20 MB once unpacked, from its many builds.
 */
const TIMEOUT_MS = 60_000

/** How many of an agent's newest versions its version menu offers. */
const OFFERED = 40

/** What Hoot reads of an agent's releases on registry.npmjs.org. */
export interface Releases {
  /** The versions its version menu offers, newest first. */
  versions: AgentRelease[]
  /** The version its `stable` tag names, as Claude Code's has; `null` where none does. */
  stable: string | null
  /**
   * The Node.js versions each offered version needs, as its `engines`
   * field says, where its command runs on Node.js (see `LatestRelease`).
   */
  node: Map<string, string>
}

// Only the versions must be there; the other fields count where they read.
const packument = z.object({
  'dist-tags': z.record(z.string(), z.string()).optional().catch(undefined),
  time: z.record(z.string(), z.string()).optional().catch(undefined),
  versions: z.record(
    z.string(),
    z
      .object({
        engines: z.object({ node: z.string().optional() }).optional().catch(undefined),
        bin: z
          .union([z.string(), z.record(z.string(), z.string())])
          .optional()
          .catch(undefined),
      })
      .catch({}),
  ),
})

/** Whether a version is a release of its own: no prerelease, such as an alpha or a platform's build. */
function isPlainRelease(version: string): boolean {
  const parsed = parse(version)
  return parsed !== null && parsed.prerelease.length === 0 && parsed.build.length === 0
}

/** The day of a time the registry gives, as `YYYY-MM-DD`; `null` when it gives none. */
function dayOf(time: string | undefined): string | null {
  if (time === undefined) return null
  const match = /^(\d{4}-\d{2}-\d{2})T/.exec(time)
  return match?.[1] ?? null
}

/**
 * The versions of an agent's npm package that its version menu offers, from
 * the package's full document on registry.npmjs.org, with the day each came
 * out: its newest releases of their own, from the oldest Hoot works with
 * (see `minimumVersion`); and the version its `stable` tag names. `null`
 * when they cannot be read within `timeoutMs`; the request is then aborted.
 */
export async function fetchReleases(
  tool: CodingToolId,
  npmPackage: string,
  command: string,
  fetch: Fetch,
  timeoutMs = TIMEOUT_MS,
): Promise<Releases | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`https://registry.npmjs.org/${npmPackage}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!response.ok) return null
    const read = packument.safeParse(await response.json())
    if (!read.success) return null
    return releasesOf(tool, npmPackage, command, read.data)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** The releases a package's document names, as `fetchReleases` reads them. */
export function releasesOf(
  tool: CodingToolId,
  npmPackage: string,
  command: string,
  document: z.infer<typeof packument>,
): Releases {
  const oldest = getCodingTool(tool).minimumVersion
  const versions = Object.keys(document.versions)
    .filter((version) => isPlainRelease(version) && gte(version, oldest))
    .toSorted((a, b) => compare(b, a))
    .slice(0, OFFERED)
  const node = new Map<string, string>()
  for (const version of versions) {
    const manifest = document.versions[version]
    const bin = manifest?.bin
    const file =
      typeof bin === 'string'
        ? npmPackage.split('/').at(-1) === command
          ? bin
          : undefined
        : bin?.[command]
    const range = manifest?.engines?.node
    if (file !== undefined && /\.[cm]?js$/i.test(file) && range) node.set(version, range)
  }
  const stable = document['dist-tags']?.stable
  return {
    versions: versions.map((version) => ({ version, date: dayOf(document.time?.[version]) })),
    stable: stable !== undefined && valid(stable) ? stable : null,
    node,
  }
}

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  bareModel,
  codexDefaultEffort,
  codexEffortsOf,
  type CatalogModel,
} from '../../shared/providers'
import { runCommand, type CommandResult, type CommandSpec } from '../agents/processes'
import { setEnvVariable, type Env } from '../env/env'
import { commandProgram } from '../tools/command-program'
// What Codex itself tells a model its catalog does not list, word for word:
// its prompt.md (openai/codex, models-manager/prompt.md, the same from
// rust-v0.148.0 to rust-v0.172.0), under the Apache License 2.0, whose text
// and Codex's notice are beside it.
import CODEX_PROMPT from './codex-prompt/prompt.md?raw'

/**
 * A model of a catalog of Codex's, as `codex debug models` prints it and
 * `model_catalog_json` takes it: Codex's own fields, which Hoot passes on as
 * they are.
 */
export type CodexCatalogEntry = Record<string, unknown> & { slug: string }

/**
 * A catalog of Codex's models, as `codex debug models` prints it and the file
 * `model_catalog_json` names holds it.
 */
export interface CodexCatalog {
  models: CodexCatalogEntry[]
}

/**
 * What Codex counts a model's context as when its catalog does not list the
 * model: 272,000 tokens, as Codex 0.172 does.
 */
export const CODEX_FALLBACK_CONTEXT = 272_000

/** How long Codex may take to print its catalog. */
const CATALOG_TIMEOUT_MS = 30_000

/** What Codex's own catalog says of each effort level it knows. */
const EFFORT_DESCRIPTIONS: Readonly<Record<string, string>> = {
  none: 'No reasoning',
  minimal: 'Fastest responses with minimal reasoning',
  low: 'Fast responses with lighter reasoning',
  medium: 'Balances speed and reasoning depth for everyday tasks',
  high: 'Greater reasoning depth for complex problems',
  xhigh: 'Extra high reasoning depth for complex problems',
  max: 'Maximum reasoning depth for the hardest problems',
  ultra: 'Maximum reasoning with automatic task delegation',
}

/**
 * The entry Hoot gives Codex for a model its own catalog does not know: what
 * Codex 0.163 and later make of such a model themselves (`model_info_from_slug`),
 * its instructions among it, with the context and the effort levels
 * models.dev lists for it, the one Hoot starts a session at its default
 * (see `codexDefaultEffort`), also for a model models.dev lists no levels
 * for, which Codex would otherwise switch to with `/model` at `none`. Codex
 * then neither warns that it does not know the model nor counts its context
 * as `CODEX_FALLBACK_CONTEXT`, and `/model` offers its levels.
 */
export function codexModelEntry(
  id: string,
  listed: Pick<CatalogModel, 'context' | 'efforts'> | null,
  priority: number,
): CodexCatalogEntry {
  const levels = codexEffortsOf(listed)
  const context = listed?.context ?? CODEX_FALLBACK_CONTEXT
  return {
    slug: id,
    display_name: id,
    description: null,
    default_reasoning_level: codexDefaultEffort(levels),
    supported_reasoning_levels: levels.map((effort) => ({
      effort,
      description: EFFORT_DESCRIPTIONS[effort] ?? effort,
    })),
    shell_type: 'unified_exec',
    visibility: 'list',
    supported_in_api: true,
    priority,
    availability_nux: null,
    upgrade: null,
    base_instructions: CODEX_PROMPT,
    support_verbosity: false,
    default_verbosity: null,
    apply_patch_tool_type: null,
    truncation_policy: { mode: 'bytes', limit: 10_000 },
    context_window: context,
    max_context_window: context,
    effective_context_window_percent: 95,
    experimental_supported_tools: [],
  }
}

/** The entry among `entries` whose slug is the longest one `id` starts with, as Codex matches one. */
function longestPrefix(
  id: string,
  entries: readonly CodexCatalogEntry[],
): CodexCatalogEntry | undefined {
  let best: CodexCatalogEntry | undefined
  for (const entry of entries) {
    if (entry.slug === '' || !id.startsWith(entry.slug)) continue
    if (best === undefined || entry.slug.length > best.slug.length) best = entry
  }
  return best
}

/**
 * Codex's own entry for a model, as Codex finds it in its own catalog: the
 * one whose slug is the longest the model's id starts with, as for a dated
 * snapshot of a model, else, for an id with a namespace, such as a
 * gateway's `openai/gpt-6.2-sol`, that of the id without it.
 */
export function codexOwnEntry(
  id: string,
  entries: readonly CodexCatalogEntry[],
): CodexCatalogEntry | undefined {
  const found = longestPrefix(id, entries)
  if (found !== undefined) return found
  const slash = id.indexOf('/')
  if (slash <= 0) return undefined
  const [namespace, rest] = [id.slice(0, slash), id.slice(slash + 1)]
  if (rest.includes('/') || !/^[A-Za-z0-9_-]+$/.test(namespace)) return undefined
  return longestPrefix(rest, entries)
}

/**
 * The catalog of a Codex session on a provider of the user's, which replaces
 * Codex's own, so that `/model` offers the models its agent offers, the one
 * it starts with among them: for a model Codex knows (see `codexOwnEntry`),
 * Codex's own entry, which it would take anyway, under the model's id, with
 * no move to a newer model to offer; for another, Hoot's (see
 * `codexModelEntry`).
 */
export function codexSessionCatalog(input: {
  /** The models its agent offers on the provider. */
  models: readonly string[]
  /** The model the session starts with. */
  model: string | null
  /** What models.dev tells of a model of the provider; `null` where it lists none. */
  catalogModel(model: string): CatalogModel | null
  /** Codex's own catalog. */
  own: readonly CodexCatalogEntry[]
}): CodexCatalog {
  const ids = [
    ...new Set(
      [...input.models, ...(input.model === null ? [] : [input.model])].map((id) => bareModel(id)),
    ),
  ]
  return {
    models: ids.map((id, priority) => {
      const own = codexOwnEntry(id, input.own)
      if (own === undefined) return codexModelEntry(id, input.catalogModel(id), priority)
      return {
        ...own,
        slug: id,
        display_name: own.slug === id ? own.display_name : id,
        visibility: 'list',
        priority,
        upgrade: null,
        availability_nux: null,
      }
    }),
  }
}

/** An entry's priority, by which Codex orders its catalog: the lowest first, one without last. */
function priorityOf(entry: CodexCatalogEntry): number {
  return typeof entry.priority === 'number' ? entry.priority : Number.MAX_SAFE_INTEGER
}

/**
 * The model Codex starts a session with on a catalog while neither its
 * command nor its configuration names one: by their priority, the first
 * model `/model` lists, else the first. `null` for an empty catalog.
 */
export function codexDefaultModel(entries: readonly CodexCatalogEntry[]): string | null {
  const ordered = entries.toSorted((a, b) => priorityOf(a) - priorityOf(b))
  return (ordered.find((entry) => entry.visibility === 'list') ?? ordered[0])?.slug ?? null
}

/** The models of a catalog `codex debug models` printed; `null` for output of another form. */
export function catalogEntriesOf(output: string): CodexCatalogEntry[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(output)
  } catch {
    return null
  }
  const models =
    typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>).models
      : undefined
  if (!Array.isArray(models)) return null
  return models.filter(
    (entry): entry is CodexCatalogEntry =>
      typeof entry === 'object' &&
      entry !== null &&
      !Array.isArray(entry) &&
      typeof (entry as Record<string, unknown>).slug === 'string',
  )
}

/** What Hoot read of an installed Codex for the catalogs of its sessions. */
export interface CodexCatalogSupport {
  /** Codex's own catalog, as the installed version bundles it. */
  own: CodexCatalogEntry[]
}

/**
 * Reads an installed Codex's own catalog with `codex debug models`, in a
 * folder of Codex's own made for it, so that the user's configuration, which
 * may name a catalog of its own, plays no part; then checks that this Codex
 * takes a catalog as Hoot writes it, with one of each kind of entry, as one it
 * cannot read keeps Codex from starting. `null` where either fails, as for a
 * Codex whose catalog has another form: its sessions then get none.
 */
export async function readCodexCatalogSupport(
  command: string,
  env: Env,
  run: (spec: CommandSpec, timeoutMs: number) => Promise<CommandResult> = runCommand,
): Promise<CodexCatalogSupport | null> {
  let folder: string | null = null
  try {
    folder = await fs.mkdtemp(path.join(os.tmpdir(), 'hoot-codex-'))
    const codexEnv = { ...env }
    setEnvVariable(codexEnv, 'CODEX_HOME', folder)
    const program = await commandProgram(command, codexEnv)
    const models = (extra: string[]) =>
      run(
        {
          file: program.file,
          args: [...program.args, 'debug', 'models', ...extra],
          env: codexEnv,
          cwd: folder!,
        },
        CATALOG_TIMEOUT_MS,
      )
    const printed = await models([])
    const own = printed.code === 0 ? catalogEntriesOf(printed.stdout) : null
    if (own === null) return null
    const sample = path.join(folder, 'catalog.json')
    const probe = codexModelEntry('hoot-probe', null, 0)
    await fs.writeFile(sample, JSON.stringify({ models: [probe, ...own.slice(0, 1)] }))
    const checked = await models(['-c', `model_catalog_json=${JSON.stringify(sample)}`])
    const read = checked.code === 0 ? catalogEntriesOf(checked.stdout) : null
    if (read === null || !read.some((entry) => entry.slug === probe.slug)) return null
    return { own }
  } catch {
    return null
  } finally {
    if (folder !== null) await fs.rm(folder, { recursive: true, force: true }).catch(() => {})
  }
}

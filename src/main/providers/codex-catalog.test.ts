import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { CommandResult, CommandSpec } from '../agents/processes'
import {
  catalogEntriesOf,
  CODEX_FALLBACK_CONTEXT,
  codexDefaultModel,
  codexModelEntry,
  codexOwnEntry,
  codexSessionCatalog,
  readCodexCatalogSupport,
  type CodexCatalogEntry,
} from './codex-catalog'

/** Codex's own entries, as `codex debug models` prints them, with less of each. */
const own: CodexCatalogEntry[] = [
  {
    slug: 'gpt-6.2-sol',
    display_name: 'GPT-6.2-Sol',
    description: 'Fast, go-to model for coding and everyday work.',
    default_reasoning_level: 'low',
    upgrade: { model: 'gpt-6.3-sol', migration_markdown: 'Try it.' },
    availability_nux: { message: 'New' },
    visibility: 'list',
    priority: 1,
    base_instructions: 'You are Codex, an agent based on GPT-6.',
  },
  { slug: 'gpt-6', display_name: 'GPT-6', visibility: 'hide', priority: 9 },
]

describe("Codex's catalog of a session", () => {
  it('makes of a model Codex does not know what Codex would, with its context and levels', () => {
    const entry = codexModelEntry(
      'deepseek-v4-pro',
      { context: 1_000_000, efforts: ['low', 'high', 'max'] },
      2,
    )
    expect(entry).toMatchObject({
      slug: 'deepseek-v4-pro',
      display_name: 'deepseek-v4-pro',
      default_reasoning_level: 'high',
      supported_reasoning_levels: [
        { effort: 'low', description: 'Fast responses with lighter reasoning' },
        { effort: 'high', description: 'Greater reasoning depth for complex problems' },
        { effort: 'max', description: 'Maximum reasoning depth for the hardest problems' },
      ],
      shell_type: 'unified_exec',
      visibility: 'list',
      priority: 2,
      truncation_policy: { mode: 'bytes', limit: 10_000 },
      context_window: 1_000_000,
      max_context_window: 1_000_000,
      effective_context_window_percent: 95,
    })
    // Codex's own prompt for such a model, word for word.
    expect(entry.base_instructions).toMatch(
      /^You are a coding agent running in the Codex CLI, a terminal-based coding assistant\./,
    )
    // One models.dev knows nothing of: Codex's own context, no levels, and `high` where
    // `/model` switches to it, as Hoot starts it at.
    expect(codexModelEntry('mystery', null, 0)).toMatchObject({
      default_reasoning_level: 'high',
      supported_reasoning_levels: [],
      context_window: CODEX_FALLBACK_CONTEXT,
      max_context_window: CODEX_FALLBACK_CONTEXT,
    })
  })

  it("finds Codex's own entry for a model as Codex does: by the longest slug it starts with", () => {
    expect(codexOwnEntry('gpt-6.2-sol', own)?.slug).toBe('gpt-6.2-sol')
    expect(codexOwnEntry('gpt-6.2-sol-2026-11-17', own)?.slug).toBe('gpt-6.2-sol')
    expect(codexOwnEntry('gpt-6-luna', own)?.slug).toBe('gpt-6')
    // A gateway's, under a namespace of a provider's.
    expect(codexOwnEntry('openai/gpt-6.2-sol', own)?.slug).toBe('gpt-6.2-sol')
    expect(codexOwnEntry('a/b/gpt-6.2-sol', own)).toBeUndefined()
    expect(codexOwnEntry('open ai/gpt-6.2-sol', own)).toBeUndefined()
    expect(codexOwnEntry('deepseek-v4-pro', own)).toBeUndefined()
  })

  it("lists the agent's models, Codex's own entries for those it knows, and the session's model", () => {
    const catalog = codexSessionCatalog({
      models: ['deepseek-v4-pro[1m]', 'openai/gpt-6.2-sol', 'gpt-6.2-sol'],
      model: 'deepseek-v4-flash',
      catalogModel: (id) =>
        id === 'deepseek-v4-pro'
          ? { id, context: 1_000_000, output: 384_000, efforts: ['high', 'max'] }
          : null,
      own,
    })
    expect(catalog.models.map((entry) => [entry.slug, entry.priority])).toEqual([
      ['deepseek-v4-pro', 0],
      ['openai/gpt-6.2-sol', 1],
      ['gpt-6.2-sol', 2],
      ['deepseek-v4-flash', 3],
    ])
    expect(catalog.models[0]).toMatchObject({ context_window: 1_000_000 })
    // Codex's own entry, under the model's id, without a move to a model the provider may lack.
    expect(catalog.models[1]).toMatchObject({
      display_name: 'openai/gpt-6.2-sol',
      base_instructions: 'You are Codex, an agent based on GPT-6.',
      default_reasoning_level: 'low',
      upgrade: null,
      availability_nux: null,
    })
    expect(catalog.models[2]).toMatchObject({ display_name: 'GPT-6.2-Sol', visibility: 'list' })
    expect(catalog.models[3]).toMatchObject({ context_window: CODEX_FALLBACK_CONTEXT })
  })

  it('starts a session as Codex does without a model: on the first it lists by priority', () => {
    expect(
      codexDefaultModel([
        { slug: 'gpt-6-luna', visibility: 'list', priority: 7 },
        { slug: 'codex-auto-review', visibility: 'hide', priority: 0 },
        { slug: 'gpt-6.2-sol', visibility: 'list', priority: 1 },
      ]),
    ).toBe('gpt-6.2-sol')
    // Where it lists none, the first by priority.
    expect(codexDefaultModel(own.map((entry) => ({ ...entry, visibility: 'hide' })))).toBe(
      'gpt-6.2-sol',
    )
    expect(codexDefaultModel([])).toBeNull()
  })

  it('reads the catalog Codex prints, and nothing of other output', () => {
    expect(catalogEntriesOf(JSON.stringify({ models: [...own, { name: 'x' }, 7] }))).toEqual(own)
    expect(catalogEntriesOf('{"models": {}}')).toBeNull()
    expect(catalogEntriesOf('Error: unknown command')).toBeNull()
  })
})

/** A stand-in for running Codex: what it prints for each run, the runs it was asked for. */
function codex(answer: (spec: CommandSpec, run: number) => Partial<CommandResult>) {
  const runs: CommandSpec[] = []
  const run = async (spec: CommandSpec): Promise<CommandResult> => {
    runs.push(spec)
    return {
      code: 0,
      signal: null,
      error: null,
      stdout: '',
      output: '',
      timedOut: false,
      ...answer(spec, runs.length),
    }
  }
  return { runs, run }
}

describe('readCodexCatalogSupport', () => {
  it("reads Codex's own catalog apart from the user's configuration, then that it takes Hoot's", async () => {
    let written: unknown = null
    const { runs, run } = codex((spec, n) => {
      if (n === 1) return { stdout: JSON.stringify({ models: own }) }
      const file = JSON.parse(spec.args.at(-1)!.replace(/^model_catalog_json=/, '')) as string
      written = JSON.parse(fs.readFileSync(file, 'utf8'))
      return { stdout: fs.readFileSync(file, 'utf8') }
    })
    // A program, as Windows runs it too, rather than a command npm installed.
    const support = await readCodexCatalogSupport(
      'codex.exe',
      { PATH: '/usr/bin', CODEX_HOME: '/home/me/.codex' },
      run,
    )
    expect(support).toEqual({ own })
    expect(runs.map((spec) => spec.args.slice(0, 3))).toEqual([
      ['debug', 'models'],
      ['debug', 'models', '-c'],
    ])
    // In a folder of its own, gone after.
    const folder = runs[0]!.env.CODEX_HOME!
    expect(folder).not.toBe('/home/me/.codex')
    expect(runs[0]!.cwd).toBe(folder)
    expect(fs.existsSync(folder)).toBe(false)
    expect(written).toMatchObject({ models: [{ slug: 'hoot-probe' }, { slug: 'gpt-6.2-sol' }] })
  })

  it('reads nothing of a Codex that prints no catalog, or takes no catalog as Hoot writes it', async () => {
    const printsNone = codex(() => ({ code: 1, stdout: '' }))
    expect(await readCodexCatalogSupport('codex.exe', {}, printsNone.run)).toBeNull()
    const takesNone = codex((_spec, n) =>
      n === 1 ? { stdout: JSON.stringify({ models: own }) } : { code: 1 },
    )
    expect(await readCodexCatalogSupport('codex.exe', {}, takesNone.run)).toBeNull()
    // One that reads the catalog but leaves Hoot's entry out does not take it either.
    const dropsIt = codex(() => ({ stdout: JSON.stringify({ models: own }) }))
    expect(await readCodexCatalogSupport('codex.exe', {}, dropsIt.run)).toBeNull()
  })
})

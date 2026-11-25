/**
 * Writes the copy of models.dev that Hoot ships with,
 * src/main/providers/models-dev-snapshot.json: the providers Hoot's presets
 * name, each model with the fields Hoot reads (see `keptCatalogs` in
 * src/main/providers/models-dev.ts), a model a line. Hoot reads models.dev
 * again itself once a day; this copy is what it has until it can.
 *
 *   node scripts/models-dev-snapshot.ts
 */
import fs from 'node:fs'
import path from 'node:path'

const root = path.join(import.meta.dirname, '..')
const target = path.join(root, 'src/main/providers/models-dev-snapshot.json')

type Json = Record<string, unknown>

const objectOf = (value: unknown): Json | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined

/** The models.dev providers the presets name: each `catalog: '…'` of the presets' file. */
function catalogIds(): string[] {
  const presets = fs.readFileSync(path.join(root, 'src/shared/providers.ts'), 'utf8')
  const ids = [...presets.matchAll(/\bcatalog: '([^']+)'/g)].map((match) => match[1]!)
  return [...new Set(ids)].toSorted()
}

/** An object without the fields that are undefined, or undefined when none is left. */
function defined(fields: Json): Json | undefined {
  const kept = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))
  return Object.keys(kept).length === 0 ? undefined : kept
}

/** The fields of a model that Hoot reads. */
function keptModel(model: Json): Json {
  const modalities = objectOf(model.modalities)
  const limit = objectOf(model.limit)
  const provider = objectOf(model.provider)
  return (
    defined({
      id: model.id,
      status: model.status,
      tool_call: model.tool_call,
      modalities: defined({ output: modalities?.output }),
      release_date: model.release_date,
      limit: defined({ context: limit?.context }),
      provider: defined({ npm: provider?.npm, api: provider?.api }),
    }) ?? {}
  )
}

const response = await fetch('https://models.dev/api.json')
if (!response.ok) throw new Error(`models.dev answered ${response.status}.`)
const file = objectOf(await response.json())
if (file === undefined) throw new Error('models.dev answered with something other than an object.')

const lines = ['{', `  "fetchedAt": ${Date.now()},`]
lines.push(`  "etag": ${JSON.stringify(response.headers.get('etag'))},`, '  "catalogs": {')
const ids = catalogIds()
ids.forEach((id, index) => {
  const provider = objectOf(file[id])
  const models = objectOf(provider?.models)
  if (provider === undefined || models === undefined) throw new Error(`models.dev has no ${id}.`)
  lines.push(`    ${JSON.stringify(id)}: {`)
  if (typeof provider.api === 'string') lines.push(`      "api": ${JSON.stringify(provider.api)},`)
  lines.push('      "models": {')
  const entries = Object.entries(models).toSorted(([a], [b]) => a.localeCompare(b))
  entries.forEach(([key, model], at) => {
    const comma = at < entries.length - 1 ? ',' : ''
    lines.push(
      `        ${JSON.stringify(key)}: ${JSON.stringify(keptModel(objectOf(model) ?? {}))}${comma}`,
    )
  })
  lines.push('      }', `    }${index < ids.length - 1 ? ',' : ''}`)
})
lines.push('  }', '}', '')
fs.writeFileSync(target, lines.join('\n'))
console.log(`Wrote ${path.relative(root, target)}: ${ids.length} providers.`)

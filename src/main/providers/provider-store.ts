import type { DatabaseSync } from 'node:sqlite'
import type { Agent, KeyHeader, Provider, WireFormat } from '../../shared/providers'
import { CODING_TOOL_IDS, type CodingToolId } from '../../shared/tools'

interface ProviderRow {
  id: string
  name: string
  preset_id: string | null
  api_key: string
  key_header: KeyHeader
  urls: string
  models: string
}

interface AgentRow {
  id: string
  harness: CodingToolId
  provider_id: string
  name: string | null
  enabled: number
  model: string | null
  effort: string | null
  extra_args: string
  created_at: number
}

const WIRE_FORMATS: readonly WireFormat[] = ['anthropic', 'responses']

function parsed(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function stringsOf(text: string): string[] {
  const value = parsed(text)
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

function urlsOf(text: string): Partial<Record<WireFormat, string>> {
  const value = parsed(text)
  if (typeof value !== 'object' || value === null) return {}
  const record = value as Record<string, unknown>
  const urls: Partial<Record<WireFormat, string>> = {}
  for (const format of WIRE_FORMATS) {
    const url = record[format]
    if (typeof url === 'string' && url !== '') urls[format] = url
  }
  return urls
}

function providerFromRow(row: ProviderRow): Provider {
  return {
    id: row.id,
    name: row.name,
    presetId: row.preset_id,
    apiKey: row.api_key,
    keyHeader: row.key_header,
    urls: urlsOf(row.urls),
    models: stringsOf(row.models),
    own: null,
  }
}

function agentFromRow(row: AgentRow): Agent | null {
  if (!CODING_TOOL_IDS.includes(row.harness)) return null
  return {
    id: row.id,
    harness: row.harness,
    providerId: row.provider_id,
    name: row.name,
    enabled: row.enabled === 1,
    model: row.model,
    effort: row.effort,
    extraArgs: stringsOf(row.extra_args),
    createdAt: row.created_at,
  }
}

/**
 * The user's providers and the agents made of them, kept in the database, each
 * in the order they were made.
 */
export class ProviderStore {
  private readonly statements

  constructor(db: DatabaseSync) {
    this.statements = {
      providers: db.prepare(
        `SELECT id, name, preset_id, api_key, key_header, urls, models
         FROM providers ORDER BY created_at, rowid`,
      ),
      insertProvider: db.prepare(
        `INSERT INTO providers (id, name, preset_id, api_key, key_header, urls, models, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      updateProvider: db.prepare(
        `UPDATE providers SET name = ?, preset_id = ?, api_key = ?, key_header = ?, urls = ?,
         models = ? WHERE id = ?`,
      ),
      deleteProvider: db.prepare('DELETE FROM providers WHERE id = ?'),
      agents: db.prepare(
        `SELECT id, harness, provider_id, name, enabled, model, effort, extra_args, created_at
         FROM agents ORDER BY created_at, rowid`,
      ),
      insertAgent: db.prepare(
        `INSERT INTO agents (id, harness, provider_id, name, enabled, model, effort, extra_args,
         created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      updateAgent: db.prepare(
        `UPDATE agents SET provider_id = ?, name = ?, enabled = ?, model = ?, effort = ?,
         extra_args = ? WHERE id = ?`,
      ),
      deleteAgent: db.prepare('DELETE FROM agents WHERE id = ?'),
    }
  }

  providers(): Provider[] {
    return (this.statements.providers.all() as unknown as ProviderRow[]).map(providerFromRow)
  }

  insertProvider(provider: Provider, createdAt: number): void {
    this.statements.insertProvider.run(
      provider.id,
      provider.name,
      provider.presetId,
      provider.apiKey,
      provider.keyHeader,
      JSON.stringify(provider.urls),
      JSON.stringify(provider.models),
      createdAt,
    )
  }

  updateProvider(provider: Provider): void {
    this.statements.updateProvider.run(
      provider.name,
      provider.presetId,
      provider.apiKey,
      provider.keyHeader,
      JSON.stringify(provider.urls),
      JSON.stringify(provider.models),
      provider.id,
    )
  }

  deleteProvider(id: string): void {
    this.statements.deleteProvider.run(id)
  }

  agents(): Agent[] {
    return (this.statements.agents.all() as unknown as AgentRow[]).flatMap((row) => {
      const agent = agentFromRow(row)
      return agent === null ? [] : [agent]
    })
  }

  insertAgent(agent: Agent): void {
    this.statements.insertAgent.run(
      agent.id,
      agent.harness,
      agent.providerId,
      agent.name,
      agent.enabled ? 1 : 0,
      agent.model,
      agent.effort,
      JSON.stringify(agent.extraArgs),
      agent.createdAt,
    )
  }

  updateAgent(agent: Agent): void {
    this.statements.updateAgent.run(
      agent.providerId,
      agent.name,
      agent.enabled ? 1 : 0,
      agent.model,
      agent.effort,
      JSON.stringify(agent.extraArgs),
      agent.id,
    )
  }

  deleteAgent(id: string): void {
    this.statements.deleteAgent.run(id)
  }
}

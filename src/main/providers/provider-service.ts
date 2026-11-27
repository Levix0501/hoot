import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import {
  canRun,
  cleanModelMap,
  findProvider,
  withAgentChange,
  type Agent,
  type AgentChange,
  type NewAgent,
  type NewProvider,
  type Provider,
  type ProviderChange,
  type ProviderCloud,
  type ProvidersState,
  type WireFormat,
} from '../../shared/providers'
import type { ProviderStore } from './provider-store'

export interface ProviderServiceOptions {
  store: ProviderStore
  /** The time to record, in milliseconds since the Unix epoch. */
  now?(): number
  newId?(): string
}

/** What a change to the providers or agents came to: what it made, or why it made nothing. */
export type ProviderResult<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; message: string }

function cleanUrls(urls: Partial<Record<WireFormat, string>>): Partial<Record<WireFormat, string>> {
  const clean: Partial<Record<WireFormat, string>> = {}
  for (const [format, url] of Object.entries(urls) as Array<[WireFormat, string | undefined]>) {
    const trimmed = url?.trim() ?? ''
    if (trimmed !== '') clean[format] = trimmed
  }
  return clean
}

function cleanModels(models: readonly string[]): string[] {
  return [...new Set(models.map((model) => model.trim()).filter((model) => model !== ''))]
}

function cleanCloud(cloud: ProviderCloud | null): ProviderCloud | null {
  if (cloud === null) return null
  return cloud.kind === 'bedrock'
    ? { kind: 'bedrock', region: cloud.region.trim() }
    : { kind: 'vertex', region: cloud.region.trim(), project: cloud.project.trim() }
}

/**
 * The user's providers and the agents made of them, which the user makes by
 * hand: Hoot reads no agent's own configuration for them and writes none,
 * each session being given its provider by itself.
 */
export class ProviderService extends EventEmitter<{
  changed: [ProvidersState]
  /** An agent was deleted. */
  removed: [agentId: string]
}> {
  private readonly store: ProviderStore
  private readonly now: () => number
  private readonly newId: () => string
  private providers: Provider[]
  private agents: Agent[]

  constructor(options: ProviderServiceOptions) {
    super()
    this.store = options.store
    this.now = options.now ?? Date.now
    this.newId = options.newId ?? randomUUID
    this.providers = this.store.providers()
    this.agents = this.store.agents()
  }

  getState(): ProvidersState {
    return {
      providers: this.providers.map((provider) => ({ ...provider })),
      agents: this.agents.map((agent) => ({ ...agent })),
    }
  }

  /** A provider by id: one of the user's, or a harness's own models. */
  provider(id: string): Provider | undefined {
    return findProvider(this.providers, id)
  }

  agent(id: string): Agent | undefined {
    return this.agents.find((agent) => agent.id === id)
  }

  addProvider(input: NewProvider): ProviderResult<{ provider: Provider }> {
    const problem = this.providerProblem(input)
    if (problem !== null) return { ok: false, message: problem }
    const provider = this.insertProvider(input)
    this.emitChanged()
    return { ok: true, provider }
  }

  /** Changes a provider. */
  updateProvider(id: string, change: ProviderChange): ProviderResult<{ provider: Provider }> {
    const current = this.providers.find((provider) => provider.id === id)
    if (current === undefined) return { ok: false, message: 'The provider no longer exists.' }
    const next: Provider = {
      ...current,
      ...(change.name === undefined ? {} : { name: change.name.trim() }),
      ...(change.presetId === undefined ? {} : { presetId: change.presetId }),
      ...(change.planId === undefined ? {} : { planId: change.planId }),
      ...(change.apiKey === undefined ? {} : { apiKey: change.apiKey.trim() }),
      ...(change.keyHeader === undefined ? {} : { keyHeader: change.keyHeader }),
      ...(change.urls === undefined ? {} : { urls: cleanUrls(change.urls) }),
      ...(change.models === undefined ? {} : { models: cleanModels(change.models) }),
      ...(change.cloud === undefined ? {} : { cloud: cleanCloud(change.cloud) }),
    }
    const problem = this.providerProblem(next)
    if (problem !== null) return { ok: false, message: problem }
    this.providers = this.providers.map((provider) => (provider.id === id ? next : provider))
    this.store.updateProvider(next)
    this.emitChanged()
    return { ok: true, provider: { ...next } }
  }

  /** Deletes a provider no agent runs on. */
  removeProvider(id: string): ProviderResult {
    if (!this.providers.some((provider) => provider.id === id)) return { ok: true }
    if (this.agents.some((agent) => agent.providerId === id)) {
      return { ok: false, message: 'Agents run on it: delete them first.' }
    }
    this.providers = this.providers.filter((provider) => provider.id !== id)
    this.store.deleteProvider(id)
    this.emitChanged()
    return { ok: true }
  }

  addAgent(input: NewAgent): ProviderResult<{ agent: Agent }> {
    const provider = this.provider(input.providerId)
    if (provider === undefined) return { ok: false, message: 'The provider no longer exists.' }
    if (!canRun(provider, input.harness)) {
      return { ok: false, message: 'The provider cannot run this agent.' }
    }
    const agent = this.insertAgent(input)
    this.emitChanged()
    return { ok: true, agent: { ...agent } }
  }

  updateAgent(id: string, change: AgentChange): void {
    const current = this.agent(id)
    if (current === undefined) return
    const next = withAgentChange(current, change)
    const provider = this.provider(next.providerId)
    if (provider === undefined || !canRun(provider, next.harness)) return
    if (JSON.stringify(next) === JSON.stringify(current)) return
    this.agents = this.agents.map((agent) => (agent.id === id ? next : agent))
    this.store.updateAgent(next)
    this.emitChanged()
  }

  removeAgent(id: string): void {
    if (this.agent(id) === undefined) return
    this.agents = this.agents.filter((agent) => agent.id !== id)
    this.store.deleteAgent(id)
    this.emit('removed', id)
    this.emitChanged()
  }

  private insertAgent(input: NewAgent): Agent {
    const agent: Agent = {
      id: this.newId(),
      harness: input.harness,
      providerId: input.providerId,
      name: input.name?.trim() || null,
      enabled: true,
      model: input.model?.trim() || null,
      effort: input.effort?.trim() || null,
      extraArgs: input.extraArgs ?? [],
      modelMap: cleanModelMap(input.modelMap ?? {}),
      createdAt: this.now(),
    }
    this.agents = [...this.agents, agent]
    this.store.insertAgent(agent)
    return agent
  }

  private insertProvider(input: NewProvider): Provider {
    const provider: Provider = {
      id: this.newId(),
      name: input.name.trim(),
      presetId: input.presetId,
      planId: input.planId,
      apiKey: input.apiKey.trim(),
      keyHeader: input.keyHeader,
      urls: cleanUrls(input.urls),
      models: cleanModels(input.models),
      cloud: cleanCloud(input.cloud),
      own: null,
    }
    this.providers = [...this.providers, provider]
    this.store.insertProvider(provider, this.now())
    return provider
  }

  /** Why a provider cannot be kept as it is; `null` when it can. */
  private providerProblem(provider: NewProvider): string | null {
    if (provider.name.trim() === '') return 'A provider needs a name.'
    if (Object.keys(cleanUrls(provider.urls)).length === 0 && provider.cloud === null) {
      return 'A provider needs an address.'
    }
    return null
  }

  private emitChanged(): void {
    this.emit('changed', this.getState())
  }
}

import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { AgentLaunchSettings } from '../../shared/launch-settings'
import {
  agentsToMake,
  canRun,
  findProvider,
  providerFromConfig,
  providerNamed,
  withAgentChange,
  type Agent,
  type AgentChange,
  type GlobalConfig,
  type HarnessGlobal,
  type NewAgent,
  type NewProvider,
  type Provider,
  type ProviderChange,
  type ProvidersState,
  type WireFormat,
} from '../../shared/providers'
import { CODING_TOOL_IDS, type CodingToolId } from '../../shared/tools'
import type { ProviderStore } from './provider-store'

/** What a harness's own configuration names, and whether it is signed in to its own models. */
export interface GlobalReading {
  config: GlobalConfig
  signedIn: boolean
}

export interface ProviderServiceOptions {
  store: ProviderStore
  /** Reads a harness's own configuration. */
  readGlobal(harness: CodingToolId): Promise<GlobalReading>
  /** Writes a provider and a model into a harness's own configuration, as its global. */
  writeGlobal(harness: CodingToolId, provider: Provider, model: string | null): Promise<void>
  /**
   * The launch settings an earlier Hoot kept for a harness, before agents,
   * which the first agent made of its global takes; `null` for none.
   */
  legacyLaunchSettings?(harness: CodingToolId): AgentLaunchSettings | null
  /** The time to record, in milliseconds since the Unix epoch. */
  now?(): number
  newId?(): string
}

/** What a change to the providers or agents came to: what it made, or why it made nothing. */
export type ProviderResult<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; message: string }

/** What Hoot did as it opened, or as harnesses got installed: the agents it made. */
export interface InstallPass {
  /** Whether it was Hoot's first since it started. */
  opening: boolean
  made: Agent[]
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

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

/**
 * The user's providers, the agents made of them, and each installed harness's
 * global: the provider its own configuration names, which it runs on outside
 * Hoot. Hoot reads a harness's configuration when it opens, when the harness
 * gets installed, and when asked again, as when its window gets the focus: a
 * configuration that names none of the providers, by address and key, makes a
 * new one; an existing provider never changes by it. As it opens, and as a
 * harness gets installed, a harness that has a global and no agent gets one,
 * as the user would make it. Changing a global writes the harness's own
 * configuration, as does changing a provider that is one.
 */
export class ProviderService extends EventEmitter<{
  changed: [ProvidersState]
  /** A harness's global was read: the provider it names, which the chats made before providers take. */
  read: [harness: CodingToolId, global: HarnessGlobal]
  /** An agent was deleted. */
  removed: [agentId: string]
}> {
  private readonly store: ProviderStore
  private readonly now: () => number
  private readonly newId: () => string
  private providers: Provider[]
  private agents: Agent[]
  private globals: Partial<Record<CodingToolId, HarnessGlobal>> = {}
  /** The harnesses installed, as the last detection found them; `null` before the first. */
  private installed: Set<CodingToolId> | null = null
  /** Keeps reads and writes of the harnesses' configurations from overlapping. */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly options: ProviderServiceOptions) {
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
      globals: { ...this.globals },
      ready: this.installed !== null,
    }
  }

  /** A provider by id: one of the user's, or a harness's own models. */
  provider(id: string): Provider | undefined {
    return findProvider(this.providers, id)
  }

  agent(id: string): Agent | undefined {
    return this.agents.find((agent) => agent.id === id)
  }

  /**
   * The harnesses a detection found installed. The first detection since Hoot
   * started is its opening: every installed harness's global is read, and
   * each that has one and no agent gets one. After it, a harness that got
   * installed does the same; one that went loses its global, which is read
   * again once it is back.
   */
  installedChanged(installed: readonly CodingToolId[]): Promise<InstallPass> {
    return this.enqueue(async () => {
      const opening = this.installed === null
      const before = this.installed ?? new Set<CodingToolId>()
      const now = new Set(installed)
      const added = CODING_TOOL_IDS.filter((harness) => now.has(harness) && !before.has(harness))
      for (const harness of before) if (!now.has(harness)) delete this.globals[harness]
      this.installed = now
      for (const harness of added) await this.readGlobal(harness)
      const made = this.makeAgents(added)
      if (opening || added.length > 0 || before.size !== now.size) this.emitChanged()
      return { opening, made }
    })
  }

  /** Reads the global of every installed harness again; no agent is made. */
  refreshGlobals(): Promise<void> {
    return this.enqueue(async () => {
      if (this.installed === null) return
      const before = JSON.stringify(this.globals)
      const providers = this.providers.length
      for (const harness of CODING_TOOL_IDS) {
        if (this.installed.has(harness)) await this.readGlobal(harness)
      }
      if (JSON.stringify(this.globals) !== before || this.providers.length !== providers) {
        this.emitChanged()
      }
    })
  }

  addProvider(input: NewProvider): ProviderResult<{ provider: Provider }> {
    const problem = this.providerProblem(input)
    if (problem !== null) return { ok: false, message: problem }
    const provider = this.insertProvider(input)
    this.emitChanged()
    return { ok: true, provider }
  }

  /**
   * Changes a provider. One that is a harness's global is written into that
   * harness's configuration first, which an error there leaves unchanged.
   */
  updateProvider(
    id: string,
    change: ProviderChange,
  ): Promise<ProviderResult<{ provider: Provider }>> {
    return this.enqueue(async () => {
      const current = this.providers.find((provider) => provider.id === id)
      if (current === undefined) return { ok: false, message: 'The provider no longer exists.' }
      const next: Provider = {
        ...current,
        ...(change.name === undefined ? {} : { name: change.name.trim() }),
        ...(change.presetId === undefined ? {} : { presetId: change.presetId }),
        ...(change.apiKey === undefined ? {} : { apiKey: change.apiKey.trim() }),
        ...(change.keyHeader === undefined ? {} : { keyHeader: change.keyHeader }),
        ...(change.urls === undefined ? {} : { urls: cleanUrls(change.urls) }),
        ...(change.models === undefined ? {} : { models: cleanModels(change.models) }),
      }
      const problem = this.providerProblem(next)
      if (problem !== null) return { ok: false, message: problem }
      for (const harness of this.harnessesWithGlobal(id)) {
        if (!canRun(next, harness)) {
          return { ok: false, message: 'It is a global, which needs an address its agent takes.' }
        }
        try {
          await this.options.writeGlobal(harness, next, this.globals[harness]?.model ?? null)
        } catch (error) {
          return { ok: false, message: `Could not change the global: ${errorMessage(error)}` }
        }
      }
      this.providers = this.providers.map((provider) => (provider.id === id ? next : provider))
      this.store.updateProvider(next)
      this.emitChanged()
      return { ok: true, provider: { ...next } }
    })
  }

  /** Deletes a provider no agent runs on and no installed harness has for its global. */
  removeProvider(id: string): ProviderResult {
    if (!this.providers.some((provider) => provider.id === id)) return { ok: true }
    if (this.agents.some((agent) => agent.providerId === id)) {
      return { ok: false, message: 'Agents run on it: delete them first.' }
    }
    if (this.harnessesWithGlobal(id).length > 0) {
      return { ok: false, message: 'It is a global: make another provider the global first.' }
    }
    this.providers = this.providers.filter((provider) => provider.id !== id)
    this.store.deleteProvider(id)
    this.emitChanged()
    return { ok: true }
  }

  /**
   * Makes a provider a harness's global, writing it into the harness's own
   * configuration with the global's model, where the provider has that model,
   * else with the provider's first.
   */
  setGlobal(harness: CodingToolId, providerId: string): Promise<ProviderResult> {
    return this.enqueue(async () => {
      const provider = this.provider(providerId)
      if (provider === undefined || !canRun(provider, harness)) {
        return { ok: false, message: 'The provider cannot run this agent.' }
      }
      const model = this.globals[harness]?.model ?? null
      const kept =
        provider.own !== null
          ? null
          : model !== null && provider.models.includes(model)
            ? model
            : (provider.models[0] ?? null)
      return this.writeGlobal(harness, provider, kept)
    })
  }

  /** Writes another model into a harness's own configuration, keeping its provider. */
  setGlobalModel(harness: CodingToolId, model: string | null): Promise<ProviderResult> {
    return this.enqueue(async () => {
      const global = this.globals[harness]
      const provider = global === undefined ? undefined : this.provider(global.providerId)
      if (provider === undefined) return { ok: false, message: 'The agent has no global.' }
      return this.writeGlobal(harness, provider, model?.trim() || null)
    })
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

  /** Writes a global, then reads the harness's configuration again, as the window then shows it. */
  private async writeGlobal(
    harness: CodingToolId,
    provider: Provider,
    model: string | null,
  ): Promise<ProviderResult> {
    try {
      await this.options.writeGlobal(harness, provider, model)
    } catch (error) {
      return { ok: false, message: `Could not change the global: ${errorMessage(error)}` }
    }
    await this.readGlobal(harness)
    this.emitChanged()
    return { ok: true }
  }

  /**
   * Reads a harness's configuration: its global is the provider it names,
   * the one it had while it still names that, or a new one made of it. One
   * that cannot be read leaves the global as it was.
   */
  private async readGlobal(harness: CodingToolId): Promise<void> {
    let reading: GlobalReading
    try {
      reading = await this.options.readGlobal(harness)
    } catch (error) {
      console.error(`Could not read the configuration of ${harness}:`, error)
      return
    }
    const current = this.globals[harness]?.providerId ?? null
    const provider =
      providerNamed(this.providers, harness, reading.config, current) ??
      this.insertProvider(providerFromConfig(this.providers, harness, reading.config))
    const global: HarnessGlobal = {
      providerId: provider.id,
      model: reading.config.model,
      signedIn: reading.signedIn,
    }
    this.globals[harness] = global
    this.emit('read', harness, global)
  }

  /** Makes an agent for each of the harnesses that has a global and no agent (see `agentsToMake`). */
  private makeAgents(harnesses: readonly CodingToolId[]): Agent[] {
    const wanted = agentsToMake(
      { providers: this.providers, agents: this.agents, globals: this.globals },
      harnesses,
    )
    return wanted.map((input) => {
      const legacy = this.options.legacyLaunchSettings?.(input.harness) ?? null
      return this.insertAgent(
        input,
        legacy === null
          ? {}
          : {
              enabled: legacy.enabled,
              model: legacy.model ?? input.model,
              effort: legacy.effort,
              extraArgs: legacy.extraArgs,
            },
      )
    })
  }

  private insertAgent(input: NewAgent, settings: Partial<Agent> = {}): Agent {
    const agent: Agent = {
      id: this.newId(),
      harness: input.harness,
      providerId: input.providerId,
      name: input.name?.trim() || null,
      enabled: true,
      model: input.model?.trim() || null,
      effort: null,
      extraArgs: [],
      createdAt: this.now(),
      ...settings,
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
      apiKey: input.apiKey.trim(),
      keyHeader: input.keyHeader,
      urls: cleanUrls(input.urls),
      models: cleanModels(input.models),
      own: null,
    }
    this.providers = [...this.providers, provider]
    this.store.insertProvider(provider, this.now())
    return provider
  }

  /** Why a provider cannot be kept as it is; `null` when it can. */
  private providerProblem(provider: NewProvider): string | null {
    if (provider.name.trim() === '') return 'A provider needs a name.'
    if (Object.keys(cleanUrls(provider.urls)).length === 0) return 'A provider needs an address.'
    return null
  }

  /** The installed harnesses whose global a provider is. */
  private harnessesWithGlobal(providerId: string): CodingToolId[] {
    return CODING_TOOL_IDS.filter(
      (harness) =>
        this.installed?.has(harness) === true && this.globals[harness]?.providerId === providerId,
    )
  }

  private emitChanged(): void {
    this.emit('changed', this.getState())
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.catch(() => {})
    return run
  }
}

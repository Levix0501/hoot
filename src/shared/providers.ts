import { CODING_TOOL_IDS, getCodingTool, type CodingToolId } from './tools'

/**
 * The ways an agent talks to a model provider: Anthropic's Messages API,
 * which Claude Code speaks, and OpenAI's Responses API, which Codex speaks.
 */
export type WireFormat = 'anthropic' | 'responses'

/**
 * The formats in which each agent can run a provider of the user's, the one
 * it takes first leading; an agent with none runs only on its own models.
 */
export const FORMATS_OF: Readonly<Record<CodingToolId, readonly WireFormat[]>> = {
  claude: ['anthropic'],
  codex: [],
  opencode: [],
}

/**
 * How a provider takes its key: as a bearer token, as most do, or in
 * Anthropic's own `x-api-key` header, as Anthropic's API does.
 */
export type KeyHeader = 'bearer' | 'x-api-key'

/** The marks Hoot draws for providers; `custom` for one it does not know. */
export type ProviderMark =
  | 'anthropic'
  | 'openai'
  | 'deepseek'
  | 'kimi'
  | 'zhipu'
  | 'zai'
  | 'minimax'
  | 'doubao'
  | 'xiaomimimo'
  | 'stepfun'
  | 'openrouter'
  | 'opencode'
  | 'custom'

/** A provider Hoot knows, which a provider of the user's can be made from with a key. */
export interface ProviderPreset {
  id: string
  name: string
  mark: ProviderMark
  /** Its address for each format it serves. */
  urls: Partial<Record<WireFormat, string>>
  /** Its models, the one a new agent takes first leading. */
  models: readonly string[]
  keyHeader: KeyHeader
  /** Where it gives out keys. */
  keyUrl: string
}

/**
 * The providers Hoot knows, in the order the Providers page offers them, with
 * the Anthropic-compatible addresses and the models that cc-switch's presets
 * point Claude Code at (November 2026). A model ending in `[1m]` tells Claude
 * Code that it takes a million tokens of context.
 */
export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    mark: 'deepseek',
    urls: { anthropic: 'https://api.deepseek.com/anthropic' },
    models: ['deepseek-flash[1m]'],
    keyHeader: 'bearer',
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'kimi',
    name: 'Kimi',
    mark: 'kimi',
    urls: { anthropic: 'https://api.moonshot.cn/anthropic' },
    models: ['kimi-k3.1-pro'],
    keyHeader: 'bearer',
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
  },
  {
    id: 'kimi-coding',
    name: 'Kimi For Coding',
    mark: 'kimi',
    urls: { anthropic: 'https://api.kimi.com/coding/' },
    models: ['kimi-for-coding'],
    keyHeader: 'bearer',
    keyUrl: 'https://www.kimi.com/code',
  },
  {
    id: 'zhipu',
    name: 'Zhipu GLM',
    mark: 'zhipu',
    urls: { anthropic: 'https://open.bigmodel.cn/api/anthropic' },
    models: ['glm-5.3[1m]'],
    keyHeader: 'bearer',
    keyUrl: 'https://www.bigmodel.cn/claude-code',
  },
  {
    id: 'zai',
    name: 'Z.ai',
    mark: 'zai',
    urls: { anthropic: 'https://api.z.ai/api/anthropic' },
    models: ['glm-5.3[1m]'],
    keyHeader: 'bearer',
    keyUrl: 'https://z.ai/subscribe',
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    mark: 'minimax',
    urls: { anthropic: 'https://api.minimax.cn/anthropic' },
    models: ['MiniMax-M3.1-Flash[1m]'],
    keyHeader: 'bearer',
    keyUrl: 'https://platform.minimax.cn/user-center/basic-information/interface-key',
  },
  {
    id: 'doubao',
    name: 'Doubao',
    mark: 'doubao',
    urls: { anthropic: 'https://ark.cn-beijing.volces.com/api/compatible' },
    models: ['doubao-seed-2-1-pro-260915'],
    keyHeader: 'bearer',
    keyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
  },
  {
    id: 'xiaomi',
    name: 'Xiaomi MiMo',
    mark: 'xiaomimimo',
    urls: { anthropic: 'https://api.xiaomimimo.com/anthropic' },
    models: ['mimo-v2.6-pro[1m]'],
    keyHeader: 'bearer',
    keyUrl: 'https://platform.xiaomimimo.com/#/console/api-keys',
  },
  {
    id: 'stepfun',
    name: 'StepFun',
    mark: 'stepfun',
    urls: { anthropic: 'https://api.stepfun.com/step_plan' },
    models: ['step-5-preview'],
    keyHeader: 'bearer',
    keyUrl: 'https://platform.stepfun.com/interface-key',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    mark: 'openrouter',
    urls: { anthropic: 'https://openrouter.ai/api' },
    models: ['anthropic/claude-sonnet-5.5'],
    keyHeader: 'bearer',
    keyUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'anthropic',
    name: 'Anthropic API',
    mark: 'anthropic',
    urls: { anthropic: 'https://api.anthropic.com' },
    models: [],
    keyHeader: 'x-api-key',
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
]

export function presetById(id: string | null): ProviderPreset | undefined {
  return id === null ? undefined : PROVIDER_PRESETS.find((preset) => preset.id === id)
}

/**
 * A model provider: one of the user's, with a key, or an agent's own models,
 * which the agent reaches by its own sign-in, or has bundled, without a key.
 */
export interface Provider {
  id: string
  name: string
  /** The preset it was made from, which gives its mark; `null` for one Hoot does not know. */
  presetId: string | null
  /** Kept as the agents' own configuration files keep it, in plain text. */
  apiKey: string
  keyHeader: KeyHeader
  /** Its address for each format it serves. */
  urls: Partial<Record<WireFormat, string>>
  /** Its models, which its agents offer, the one a new agent takes first leading. */
  models: string[]
  /** For an agent's own models, that agent, the only one that can run them; `null` otherwise. */
  own: CodingToolId | null
}

/** The ids of the agents' own models, which are no provider of the user's. */
export const OWN_PROVIDER_IDS: Readonly<Record<CodingToolId, string>> = {
  claude: 'claude-subscription',
  codex: 'chatgpt-subscription',
  opencode: 'opencode-free',
}

const OWN_PROVIDER_NAMES: Readonly<Record<CodingToolId, string>> = {
  claude: 'Claude subscription',
  codex: 'ChatGPT subscription',
  opencode: 'OpenCode free models',
}

/** An agent's own models: its subscription, or for OpenCode, the free models it comes with. */
export function ownProvider(harness: CodingToolId): Provider {
  return {
    id: OWN_PROVIDER_IDS[harness],
    name: OWN_PROVIDER_NAMES[harness],
    presetId: null,
    apiKey: '',
    keyHeader: 'bearer',
    urls: {},
    models: [],
    own: harness,
  }
}

/** Whether an agent's own models need it signed in: OpenCode's free ones do not. */
export function ownNeedsSignIn(harness: CodingToolId): boolean {
  return harness !== 'opencode'
}

/** The mark Hoot draws for a provider. */
export function providerMark(provider: Pick<Provider, 'presetId' | 'own'>): ProviderMark {
  switch (provider.own) {
    case 'claude':
      return 'anthropic'
    case 'codex':
      return 'openai'
    case 'opencode':
      return 'opencode'
    case null:
      return presetById(provider.presetId)?.mark ?? 'custom'
  }
}

/** An address without the spaces around it and the slashes at its end, as addresses compare. */
export function trimUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

/** The address an agent runs a provider at: the first of the formats it speaks that the provider serves. */
export function providerUrl(provider: Provider, harness: CodingToolId): string {
  for (const format of FORMATS_OF[harness]) {
    const url = (provider.urls[format] ?? '').trim()
    if (url !== '') return url
  }
  return ''
}

/** Whether an agent can run a provider. */
export function canRun(provider: Provider, harness: CodingToolId): boolean {
  if (provider.own !== null) return provider.own === harness
  return providerUrl(provider, harness) !== ''
}

/** The agents that can run a provider, in the order of `CODING_TOOL_IDS`. */
export function harnessesOf(provider: Provider): CodingToolId[] {
  return CODING_TOOL_IDS.filter((harness) => canRun(provider, harness))
}

/**
 * An agent of Hoot's: a coding tool, its harness, run on a provider's model.
 * The new session menus list those turned on.
 */
export interface Agent {
  id: string
  harness: CodingToolId
  providerId: string
  /** The name the user gave it; `null` for the one made from its provider. */
  name: string | null
  /** Whether the new session menus list it. */
  enabled: boolean
  /** The model its sessions start with; `null` for the harness's default. */
  model: string | null
  /** The effort level its sessions start with; `null` for the harness's default. */
  effort: string | null
  /** Arguments added to the end of its sessions' own arguments, in order. */
  extraArgs: string[]
  /** Milliseconds since the Unix epoch, when it was made, which orders the agents. */
  createdAt: number
}

/** An agent to make: what its maker picks; it starts turned on, with no effort or extra arguments. */
export interface NewAgent {
  harness: CodingToolId
  providerId: string
  model: string | null
  name?: string | null
}

/**
 * What changes about an agent; what is left out stays as it is. Its chats
 * keep the provider they began on.
 */
export interface AgentChange {
  providerId?: string
  name?: string | null
  enabled?: boolean
  model?: string | null
  effort?: string | null
  extraArgs?: string[]
}

/** An agent with a change applied: a blank name or model is none. */
export function withAgentChange(agent: Agent, change: AgentChange): Agent {
  return {
    ...agent,
    ...(change.providerId === undefined ? {} : { providerId: change.providerId }),
    ...(change.name === undefined ? {} : { name: change.name?.trim() || null }),
    ...(change.enabled === undefined ? {} : { enabled: change.enabled }),
    ...(change.model === undefined ? {} : { model: change.model?.trim() || null }),
    ...(change.effort === undefined ? {} : { effort: change.effort }),
    ...(change.extraArgs === undefined ? {} : { extraArgs: [...change.extraArgs] }),
  }
}

/** A provider to make: what the Providers page asks for. */
export interface NewProvider {
  name: string
  presetId: string | null
  apiKey: string
  keyHeader: KeyHeader
  urls: Partial<Record<WireFormat, string>>
  models: string[]
}

/** What changes about a provider; what is left out stays as it is. */
export type ProviderChange = Partial<NewProvider>

/**
 * What an agent's own configuration names, as Hoot reads it: the provider
 * that agent runs on outside Hoot, and the model.
 */
export interface HarnessGlobal {
  /** One of the user's providers, or the agent's own models. */
  providerId: string
  /** The model it names; `null` when it names none. */
  model: string | null
  /** For its own models, whether it is signed in to them; OpenCode's free models need no sign-in. */
  signedIn: boolean
}

/** The providers and agents, and each installed agent's global, as the window shows them. */
export interface ProvidersState {
  /** The user's providers, in the order they were made; the agents' own are not among them. */
  providers: Provider[]
  /** In the order they were made. */
  agents: Agent[]
  /** For each installed harness Hoot read the configuration of, what it names. */
  globals: Partial<Record<CodingToolId, HarnessGlobal>>
  /**
   * Whether Hoot has read the installed harnesses' configurations since it
   * opened, and made the agents it makes as it opens.
   */
  ready: boolean
}

/** A provider by id: one of the user's, or an agent's own models. */
export function findProvider(providers: readonly Provider[], id: string): Provider | undefined {
  const harness = CODING_TOOL_IDS.find((candidate) => OWN_PROVIDER_IDS[candidate] === id)
  return harness === undefined
    ? providers.find((provider) => provider.id === id)
    : ownProvider(harness)
}

/**
 * The name an agent shows: the one the user gave it; else, on the harness's
 * own models, the harness's name; else its provider's, with its model when
 * another agent of the harness runs the same provider.
 */
export function agentName(
  agent: Agent,
  state: Pick<ProvidersState, 'providers' | 'agents'>,
): string {
  if (agent.name !== null && agent.name.trim() !== '') return agent.name.trim()
  const provider = findProvider(state.providers, agent.providerId)
  if (provider === undefined) return getCodingTool(agent.harness).label
  if (provider.own !== null) return getCodingTool(agent.harness).label
  const shared = state.agents.some(
    (other) =>
      other.id !== agent.id &&
      other.harness === agent.harness &&
      other.providerId === agent.providerId &&
      (other.name === null || other.name.trim() === ''),
  )
  return shared ? `${provider.name} · ${agent.model ?? 'Default'}` : provider.name
}

/**
 * The agents a new session can start with: those turned on whose harness is
 * installed and whose provider is there and runs on it, grouped by harness in
 * the order of `CODING_TOOL_IDS`, each harness's in the order they were made.
 */
export function usableAgents(
  state: Pick<ProvidersState, 'providers' | 'agents'>,
  installed: (harness: CodingToolId) => boolean,
): Agent[] {
  return CODING_TOOL_IDS.flatMap((harness) =>
    installed(harness)
      ? state.agents.filter((agent) => {
          if (agent.harness !== harness || !agent.enabled) return false
          const provider = findProvider(state.providers, agent.providerId)
          return provider !== undefined && canRun(provider, harness)
        })
      : [],
  )
}

/**
 * The agent a new session starts with: the one asked for while it is usable,
 * else the default agent while it is, else the first usable one; `null` when
 * none is.
 */
export function sessionAgent(
  usable: readonly Agent[],
  defaultAgent: string | null,
  asked: string | null = null,
): Agent | null {
  return (
    usable.find((agent) => agent.id === asked) ??
    usable.find((agent) => agent.id === defaultAgent) ??
    usable[0] ??
    null
  )
}

/**
 * The agent work on an issue starts with, which Claude Code alone is sent:
 * the default agent while it is a usable Claude Code agent, else the first
 * usable Claude Code agent; `null` when there is none.
 */
export function issueAgent(usable: readonly Agent[], defaultAgent: string | null): Agent | null {
  const claude = usable.filter((agent) => agent.harness === 'claude')
  return claude.find((agent) => agent.id === defaultAgent) ?? claude[0] ?? null
}

/**
 * What a harness's own configuration says of its provider: the address and
 * the key, empty where it gives none, how it sends the key, and the model,
 * which is the harness's own setting, not the provider's.
 */
export interface GlobalConfig {
  url: string
  apiKey: string
  keyHeader: KeyHeader
  model: string | null
}

/**
 * Whether a harness's configuration names this provider: one of its addresses
 * and its key, or for its own models, neither. The model does not count.
 */
export function namesProvider(
  provider: Provider,
  harness: CodingToolId,
  config: GlobalConfig,
): boolean {
  if (!canRun(provider, harness)) return false
  if (provider.own !== null) return trimUrl(config.url) === '' && config.apiKey === ''
  const url = trimUrl(config.url)
  return (
    url !== '' &&
    FORMATS_OF[harness].some((format) => trimUrl(provider.urls[format] ?? '') === url) &&
    provider.apiKey === config.apiKey
  )
}

/** The preset one of whose addresses, in one of a harness's formats, an address is. */
export function presetOfUrl(url: string, harness: CodingToolId): ProviderPreset | undefined {
  const wanted = trimUrl(url)
  if (wanted === '') return undefined
  return PROVIDER_PRESETS.find((preset) =>
    FORMATS_OF[harness].some((format) => trimUrl(preset.urls[format] ?? '') === wanted),
  )
}

/** A name no provider has yet: `base`, else `base` with 2, 3, … after it. */
export function freeProviderName(providers: readonly Provider[], base: string): string {
  const taken = new Set(providers.map((provider) => provider.name))
  if (!taken.has(base)) return base
  for (let n = 2; ; n += 1) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`
}

function hostOf(url: string): string | null {
  try {
    return new URL(url.trim()).host || null
  } catch {
    return null
  }
}

/**
 * The provider to make of a harness's configuration that names none of the
 * user's: the preset of its address, with the preset's other addresses and
 * models, and the configuration's model first; otherwise one named after the
 * address's host.
 */
export function providerFromConfig(
  providers: readonly Provider[],
  harness: CodingToolId,
  config: GlobalConfig,
): NewProvider {
  const preset = presetOfUrl(config.url, harness)
  const models = preset ? [...preset.models] : []
  if (config.model !== null && config.model !== '' && !models.includes(config.model)) {
    models.unshift(config.model)
  }
  const format = FORMATS_OF[harness][0] ?? 'anthropic'
  return {
    name: freeProviderName(providers, preset?.name ?? hostOf(config.url) ?? 'Custom'),
    presetId: preset?.id ?? null,
    apiKey: config.apiKey,
    keyHeader: config.keyHeader,
    urls: preset ? { ...preset.urls } : { [format]: config.url.trim() },
    models,
  }
}

/**
 * The provider a harness's configuration names: the global it has already
 * when that is still it, else the first of the user's that it names, else
 * none, and a new one must be made of it.
 */
export function providerNamed(
  providers: readonly Provider[],
  harness: CodingToolId,
  config: GlobalConfig,
  current: string | null,
): Provider | null {
  const candidates = [ownProvider(harness), ...providers]
  const kept = candidates.find((provider) => provider.id === current)
  if (kept !== undefined && namesProvider(kept, harness, config)) return kept
  return candidates.find((provider) => namesProvider(provider, harness, config)) ?? null
}

/**
 * Whether a harness has a global, which a new agent can be made of: a
 * provider of the user's that it can run, or its own models while it is
 * signed in to them where they need it.
 */
export function hasGlobal(
  state: Pick<ProvidersState, 'providers' | 'globals'>,
  harness: CodingToolId,
): boolean {
  const global = state.globals[harness]
  if (global === undefined) return false
  const provider = findProvider(state.providers, global.providerId)
  if (provider === undefined || !canRun(provider, harness)) return false
  return provider.own === null || !ownNeedsSignIn(harness) || global.signedIn
}

/**
 * The agents to make as Hoot opens, or as harnesses get installed: one for
 * each of `harnesses` that is installed, has a global and has no agent, on
 * that global's provider and model, as one made by hand would be.
 */
export function agentsToMake(
  state: Pick<ProvidersState, 'providers' | 'agents' | 'globals'>,
  harnesses: readonly CodingToolId[],
): NewAgent[] {
  return harnesses.flatMap((harness) => {
    if (state.agents.some((agent) => agent.harness === harness)) return []
    if (!hasGlobal(state, harness)) return []
    const global = state.globals[harness]!
    return [{ harness, providerId: global.providerId, model: global.model }]
  })
}

/** The models an agent on a provider offers, besides the harness's default. */
export function providerModels(provider: Provider | undefined): string[] {
  return provider === undefined || provider.own !== null ? [] : provider.models
}

/** The key as the Providers page shows it: its first characters and its last four. */
export function maskKey(key: string): string {
  const trimmed = key.trim()
  if (trimmed === '') return ''
  if (trimmed.length <= 8) return '••••'
  return `${trimmed.slice(0, 3)}••••${trimmed.slice(-4)}`
}

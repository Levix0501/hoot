import type { AgentModelOption, AgentState } from '../../shared/agents'
import {
  catalogModelOf,
  CLAUDE_ROLES,
  claudeDefaultEffort,
  claudeEffortsOf,
  CODEX_PROVIDER_EFFORT,
  modelMapOn,
  namesClaudeModel,
  PROVIDER_EFFORTS,
  type Agent,
  type AgentChange,
  type ClaudeRole,
  type ModelCatalogs,
  type ModelMap,
  type Provider,
} from '../../shared/providers'
import type { CodingToolId } from '../../shared/tools'

/** An agent as the agent panel holds it: one saved, or one being made. */
export type AgentDraft = Pick<
  Agent,
  'harness' | 'providerId' | 'name' | 'enabled' | 'model' | 'effort' | 'extraArgs' | 'modelMap'
>

export function draftOf(agent: Agent): AgentDraft {
  return {
    harness: agent.harness,
    providerId: agent.providerId,
    name: agent.name,
    enabled: agent.enabled,
    model: agent.model,
    effort: agent.effort,
    extraArgs: agent.extraArgs,
    modelMap: agent.modelMap,
  }
}

/**
 * The models an agent on a provider can pick: on its harness's own models,
 * those its configuration offers, as the harness's detection read them; on a
 * provider of the user's, that provider's.
 */
export function modelChoices(
  harness: CodingToolId,
  provider: Provider | undefined,
  state: AgentState | undefined,
  catalogs: ModelCatalogs,
): AgentModelOption[] {
  if (provider === undefined) return []
  if (provider.own !== null) return state?.launchOptions?.models ?? []
  return provider.models.map((model) => ({
    value: model,
    label: model,
    efforts: effortsOf(harness, model, provider, state, catalogs),
  }))
}

/**
 * The effort levels of a model, or of the one an agent made without a model
 * runs, on a provider: on a provider of the user's, for Claude Code, those
 * models.dev lists for the model (see `claudeEffortsOf`), for another agent,
 * those it offers for any; on the harness's own models, those its
 * configuration gives the model.
 */
export function effortsOf(
  harness: CodingToolId,
  model: string | null,
  provider: Provider | undefined,
  state: AgentState | undefined,
  catalogs: ModelCatalogs,
): string[] {
  if (provider?.own === null) {
    if (harness !== 'claude') return [...PROVIDER_EFFORTS[harness]]
    const runs = model ?? provider.models[0]
    return runs === undefined ? [] : claudeEffortsOf(catalogModelOf(catalogs, provider, runs))
  }
  const options = state?.launchOptions
  if (model === null) return options?.defaultEfforts ?? []
  return options?.models.find((option) => option.value === model)?.efforts ?? []
}

/**
 * The effort level an agent's sessions start at while it picks none, where
 * Hoot knows it: for Claude Code on a provider of the user's, the one Hoot
 * starts them at (see `claudeDefaultEffort`), or for one of Claude's models,
 * which Claude Code knows itself, the one its configuration names where the
 * model takes it; for Codex there, the one Hoot gives it
 * (`CODEX_PROVIDER_EFFORT`); on the harness's own models, the one its
 * configuration names where the model takes it. `null` where the harness
 * picks one Hoot does not know, as OpenCode does.
 */
export function defaultEffortOf(
  harness: CodingToolId,
  model: string | null,
  provider: Provider | undefined,
  state: AgentState | undefined,
  catalogs: ModelCatalogs,
): string | null {
  if (provider === undefined) return null
  const efforts = effortsOf(harness, model, provider, state, catalogs)
  const configured = state?.launchOptions?.defaultEffort?.value ?? null
  const configuredTaken = configured !== null && efforts.includes(configured) ? configured : null
  if (provider.own !== null) return configuredTaken
  switch (harness) {
    case 'claude': {
      const runs = model ?? provider.models[0]
      if (runs === undefined) return null
      return namesClaudeModel(runs) ? configuredTaken : claudeDefaultEffort(efforts)
    }
    case 'codex':
      return CODEX_PROVIDER_EFFORT
    case 'opencode':
      return null
  }
}

/**
 * The model an agent runs on a provider while it names none: on a provider
 * of the user's, its first; on the harness's own models, the one the
 * harness's configuration names where it is offered, else for Claude Code
 * Opus, which it starts with, else the first offered. `null` where nothing
 * is offered.
 */
export function impliedModel(
  provider: Provider | undefined,
  state: AgentState | undefined,
): string | null {
  if (provider === undefined) return null
  if (provider.own === null) return provider.models[0] ?? null
  const options = state?.launchOptions
  if (!options) return null
  const offered = (value: string | undefined) =>
    value !== undefined && options.models.some((model) => model.value === value)
  const configured = options.defaultModel?.value
  if (offered(configured)) return configured!
  if (provider.own === 'claude' && offered('opus')) return 'opus'
  return options.models[0]?.value ?? null
}

/** An agent as the panel shows it: naming the model it runs, even one made without a model. */
export function shownDraft(
  draft: AgentDraft,
  provider: Provider | undefined,
  state: AgentState | undefined,
): AgentDraft {
  return draft.model !== null ? draft : { ...draft, model: impliedModel(provider, state) }
}

/** Whether an agent maps Claude Code's roles to models: Claude Code on a provider of the user's. */
export function mapsRoles(harness: CodingToolId, provider: Provider | undefined): boolean {
  return harness === 'claude' && provider !== undefined && provider.own === null
}

/**
 * A model map with one of Claude Code's roles given a model: given the model
 * the agent runs, the role follows that model again, wherever it goes.
 */
export function withRole(
  modelMap: ModelMap,
  role: ClaudeRole,
  model: string,
  runs: string | null,
): ModelMap {
  const next = { ...modelMap }
  if (model === runs) delete next[role]
  else next[role] = model
  return next
}

/**
 * A model map once the agent runs another model: the roles on the model it
 * ran go with it to the new one, as do those on the new one; the others keep
 * their own.
 */
export function followMap(modelMap: ModelMap, from: string | null, to: string | null): ModelMap {
  const next: ModelMap = {}
  for (const role of CLAUDE_ROLES) {
    const model = modelMap[role]
    if (model !== undefined && model !== from && model !== to) next[role] = model
  }
  return next
}

/** The model an agent takes on another provider: its own where that one offers it, else that one's. */
function modelOn(
  model: string | null,
  provider: Provider,
  state: AgentState | undefined,
): string | null {
  const offered =
    provider.own === null
      ? provider.models
      : (state?.launchOptions?.models ?? []).map((option) => option.value)
  return model !== null && offered.includes(model) ? model : impliedModel(provider, state)
}

/**
 * An agent on another provider: its model where that provider offers it,
 * else the one that provider starts with; its roles' models where offered,
 * the others following its model; its effort level back to its model's.
 */
export function draftOnProvider(
  draft: AgentDraft,
  provider: Provider,
  state: AgentState | undefined,
): AgentDraft {
  const model = modelOn(draft.model, provider, state)
  return {
    ...draft,
    providerId: provider.id,
    model,
    effort: null,
    modelMap: followMap(modelMapOn(draft.modelMap, provider), draft.model, model),
  }
}

/**
 * An agent with another model: the roles that followed its model follow it
 * to the new one, and an effort level the new model does not take goes back
 * to the new model's.
 */
export function draftWithModel(
  draft: AgentDraft,
  model: string,
  provider: Provider | undefined,
  state: AgentState | undefined,
  catalogs: ModelCatalogs,
): AgentDraft {
  const efforts = effortsOf(draft.harness, model, provider, state, catalogs)
  const effort = draft.effort !== null && efforts.includes(draft.effort) ? draft.effort : null
  return { ...draft, model, effort, modelMap: followMap(draft.modelMap, draft.model, model) }
}

/** What changed from one draft of an agent to another, for its saved agent to take. */
export function draftChange(before: AgentDraft, after: AgentDraft): AgentChange {
  const change: AgentChange = {}
  if (after.providerId !== before.providerId) change.providerId = after.providerId
  if (after.name !== before.name) change.name = after.name
  if (after.enabled !== before.enabled) change.enabled = after.enabled
  if (after.model !== before.model) change.model = after.model
  if (after.effort !== before.effort) change.effort = after.effort
  if (JSON.stringify(after.extraArgs) !== JSON.stringify(before.extraArgs)) {
    change.extraArgs = after.extraArgs
  }
  if (JSON.stringify(after.modelMap) !== JSON.stringify(before.modelMap)) {
    change.modelMap = after.modelMap
  }
  return change
}

/** A name as an agent keeps it: empty, or the one it would get anyway, is none. */
export function typedName(typed: string, own: string): string | null {
  const name = typed.trim()
  return name === '' || name === own ? null : name
}

import type { AgentModelOption, AgentState } from '../../shared/agents'
import {
  addedModels,
  catalogModelOf,
  CLAUDE_ROLES,
  claudeDefaultEffort,
  claudeEffortsOf,
  codexDefaultEffort,
  codexEffortsOf,
  leavesRolesToClaude,
  modelMapOn,
  namesClaudeModel,
  openCodeDefaultEffort,
  openCodeEffortsOf,
  providerFirstModel,
  providerFormat,
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
 * The models an agent on a provider can pick, in groups: on its harness's own
 * models, those its configuration offers, as the harness's detection read
 * them; on a provider of the user's, that provider's, and on a Custom one,
 * then those of the maker of the format the agent runs it in, Claude's at an
 * Anthropic-compatible address and OpenAI's at a Responses one (see
 * `addedModels`).
 */
export function modelGroups(
  harness: CodingToolId,
  provider: Provider | undefined,
  state: AgentState | undefined,
  catalogs: ModelCatalogs,
): AgentModelOption[][] {
  if (provider === undefined) return []
  const groups: AgentModelOption[][] =
    provider.own !== null
      ? [state?.launchOptions?.models ?? []]
      : [provider.models, addedModels(harness, provider, catalogs)].map((models) =>
          models.map((model) => ({
            value: model,
            label: model,
            efforts: effortsOf(harness, model, provider, state, catalogs),
          })),
        )
  return groups.filter((group) => group.length > 0)
}

/** The models an agent on a provider can pick (see `modelGroups`). */
export function modelChoices(
  harness: CodingToolId,
  provider: Provider | undefined,
  state: AgentState | undefined,
  catalogs: ModelCatalogs,
): AgentModelOption[] {
  return modelGroups(harness, provider, state, catalogs).flat()
}

/**
 * The effort levels of a model, or of the one an agent made without a model
 * runs, on a provider: on a provider of the user's, those models.dev lists
 * for the model, as each harness takes them (see `claudeEffortsOf`,
 * `codexEffortsOf` and `openCodeEffortsOf`); on the harness's own models,
 * those its configuration gives the model.
 */
export function effortsOf(
  harness: CodingToolId,
  model: string | null,
  provider: Provider | undefined,
  state: AgentState | undefined,
  catalogs: ModelCatalogs,
): string[] {
  if (provider?.own === null) {
    const runs = model ?? providerFirstModel(harness, provider, catalogs)
    if (runs === null) return []
    const listed = catalogModelOf(catalogs, harness, provider, runs)
    switch (harness) {
      case 'claude':
        return claudeEffortsOf(listed)
      case 'codex':
        return codexEffortsOf(listed)
      case 'opencode':
        return openCodeEffortsOf(listed, providerFormat(provider, harness) ?? 'anthropic')
      case 'antigravity':
        // It runs no provider of the user's.
        return []
    }
  }
  const options = state?.launchOptions
  if (model === null) return options?.defaultEfforts ?? []
  return options?.models.find((option) => option.value === model)?.efforts ?? []
}

/**
 * The effort level an agent's sessions start at while it picks none, where
 * Hoot knows it: on a provider of the user's, the one Hoot starts them at,
 * for Claude Code (see `claudeDefaultEffort`), unless the model is one of
 * Claude's, which Claude Code knows itself, then the one its configuration
 * names where the model takes it, for Codex (see `codexDefaultEffort`) and
 * for OpenCode (see `openCodeDefaultEffort`); on the harness's own models,
 * the one its configuration names where the model takes it. `null` where
 * the harness picks one Hoot does not know.
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
      const runs = model ?? providerFirstModel(harness, provider, catalogs)
      if (runs === null) return null
      return namesClaudeModel(runs) ? configuredTaken : claudeDefaultEffort(efforts)
    }
    case 'codex':
      return codexDefaultEffort(efforts)
    case 'opencode': {
      const runs = model ?? providerFirstModel(harness, provider, catalogs)
      return runs === null
        ? null
        : openCodeDefaultEffort(catalogModelOf(catalogs, harness, provider, runs))
    }
    case 'antigravity':
      return null
  }
}

/**
 * The model an agent runs on a provider while it names none: on a provider
 * of the user's, its first (see `providerFirstModel`); on the harness's own
 * models, the one the harness's configuration names where it is offered,
 * else for Claude Code Opus, which it starts with, else the first offered.
 * `null` where nothing is offered.
 */
export function impliedModel(
  harness: CodingToolId,
  provider: Provider | undefined,
  state: AgentState | undefined,
  catalogs: ModelCatalogs,
): string | null {
  if (provider === undefined) return null
  if (provider.own === null) return providerFirstModel(harness, provider, catalogs)
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
  catalogs: ModelCatalogs,
): AgentDraft {
  return draft.model !== null
    ? draft
    : { ...draft, model: impliedModel(draft.harness, provider, state, catalogs) }
}

/** Whether an agent maps Claude Code's roles to models: Claude Code on a provider of the user's. */
export function mapsRoles(harness: CodingToolId, provider: Provider | undefined): boolean {
  return harness === 'claude' && provider !== undefined && provider.own === null
}

/**
 * Whether an agent running a model leaves each of Claude Code's roles it
 * does not map to Claude Code, rather than to that model (see
 * `leavesRolesToClaude`).
 */
export function leavesRoles(
  harness: CodingToolId,
  provider: Provider | undefined,
  model: string | null,
  catalogs: ModelCatalogs,
): boolean {
  return mapsRoles(harness, provider) && leavesRolesToClaude(provider!, model, catalogs)
}

/**
 * A model map with one of Claude Code's roles given a model, or none, which
 * leaves the role to Claude Code where the agent leaves roles to it (see
 * `leavesRoles`). Elsewhere, given the model the agent runs, the role follows
 * that model again, wherever it goes.
 */
export function withRole(
  modelMap: ModelMap,
  role: ClaudeRole,
  model: string | null,
  runs: string | null,
  leaves: boolean,
): ModelMap {
  const next = { ...modelMap }
  if (model === null || (!leaves && model === runs)) delete next[role]
  else next[role] = model
  return next
}

/**
 * A model map once the agent runs another model, by whether it left the
 * roles it does not map to Claude Code before and does after (see
 * `leavesRoles`): where they followed the model it ran, the roles on that
 * model go with them, and where they follow the new one, those on that one
 * join them; the others keep their own. Where roles are left to Claude Code,
 * a role is on a model only as the user mapped it, so it keeps it.
 */
export function followMap(
  modelMap: ModelMap,
  from: string | null,
  to: string | null,
  leftBefore: boolean,
  leftAfter: boolean,
): ModelMap {
  const next: ModelMap = {}
  for (const role of CLAUDE_ROLES) {
    const model = modelMap[role]
    if (model === undefined) continue
    if ((!leftBefore && model === from) || (!leftAfter && model === to)) continue
    next[role] = model
  }
  return next
}

/**
 * The model an agent takes on another provider: its own where that one lists
 * it, else the one that one starts with. A provider of the user's lists its
 * own models, and a maker's only while it has none (see
 * `addedModels`), so that one with models of its own starts on its first.
 */
function modelOn(
  harness: CodingToolId,
  model: string | null,
  provider: Provider,
  state: AgentState | undefined,
  catalogs: ModelCatalogs,
): string | null {
  const listed =
    provider.own === null && provider.models.length > 0
      ? provider.models
      : modelChoices(harness, provider, state, catalogs).map((option) => option.value)
  return model !== null && listed.includes(model)
    ? model
    : impliedModel(harness, provider, state, catalogs)
}

/**
 * An agent on another provider, from the one it was on: its model where that
 * provider lists it, else the one that provider starts with (see
 * `modelOn`); its roles' models where offered, the others following its
 * model or left to Claude Code (see `followMap`); its effort level back to
 * its model's.
 */
export function draftOnProvider(
  draft: AgentDraft,
  provider: Provider,
  state: AgentState | undefined,
  catalogs: ModelCatalogs,
  from: Provider | undefined,
): AgentDraft {
  const model = modelOn(draft.harness, draft.model, provider, state, catalogs)
  return {
    ...draft,
    providerId: provider.id,
    model,
    effort: null,
    modelMap: followMap(
      modelMapOn(draft.modelMap, provider, catalogs),
      draft.model,
      model,
      leavesRoles(draft.harness, from, draft.model, catalogs),
      leavesRoles(draft.harness, provider, model, catalogs),
    ),
  }
}

/**
 * An agent with another model: the roles that followed its model follow it
 * to the new one, or are left to Claude Code with it (see `followMap`), and
 * an effort level the new model does not take goes back to the new model's.
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
  const modelMap = followMap(
    draft.modelMap,
    draft.model,
    model,
    leavesRoles(draft.harness, provider, draft.model, catalogs),
    leavesRoles(draft.harness, provider, model, catalogs),
  )
  return { ...draft, model, effort, modelMap }
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

import {
  AZURE_PATH,
  catalogModelIds,
  firstPicks,
  freeProviderName,
  planCatalog,
  planIdOf,
  presetById,
  presetPlan,
  presetPlans,
  providerPlan,
  trimUrl,
  type KeyHeader,
  type ModelCatalogs,
  type NewProvider,
  type Provider,
  type ProviderCloud,
  type ProviderPreset,
  type WireFormat,
} from '../../shared/providers'

/** A provider as the add and edit dialogs keep it until it is saved. */
export interface FormDraft {
  presetId: string | null
  /** The preset's plan or region; `null` for a provider of the user's own. */
  planId: string | null
  name: string
  apiKey: string
  /** Azure's: the user's resource. */
  endpoint: string
  /** Vertex AI's: the Google Cloud project. */
  project: string
  /** A provider of the user's own: its addresses, which a preset's plan fixes for it. */
  urls: Partial<Record<WireFormat, string>>
  /** The models picked, the one a new agent takes first leading. */
  models: string[]
  keyHeader: KeyHeader
}

/** The models.dev provider whose models a draft's plan serves; `null` for one of the user's own. */
export function draftCatalog(draft: Pick<FormDraft, 'presetId' | 'planId'>): string | null {
  const preset = presetById(draft.presetId)
  return preset === undefined ? null : planCatalog(preset, presetPlan(preset, draft.planId))
}

/** A new provider's draft: a preset's first plan, with the models picked of it at first (see `firstPicks`). */
export function draftOf(preset: ProviderPreset | null, catalogs: ModelCatalogs): FormDraft {
  const plan = preset === null ? null : presetPlan(preset, null)
  return {
    presetId: preset?.id ?? null,
    planId: plan?.id ?? null,
    name: preset?.name ?? '',
    apiKey: '',
    endpoint: '',
    project: '',
    urls: {},
    models:
      preset === null || plan === null
        ? []
        : firstPicks(catalogModelIds(catalogs, planCatalog(preset, plan))),
    keyHeader: preset?.keyHeader ?? 'bearer',
  }
}

/** A draft on another of its preset's plans, with that plan's models picked at first. */
export function withPlan(
  draft: FormDraft,
  preset: ProviderPreset,
  planId: string,
  catalogs: ModelCatalogs,
): FormDraft {
  const plan = presetPlans(preset).find((candidate) => candidate.id === planId)
  if (plan === undefined) return draft
  return {
    ...draft,
    planId,
    models: firstPicks(catalogModelIds(catalogs, planCatalog(preset, plan))),
  }
}

/** An Azure resource's endpoint, as the user typed it, without the path Hoot adds to it. */
export function azureResource(endpoint: string): string {
  return trimUrl(endpoint).replace(/\/openai(\/v1)?$/, '')
}

/** A provider of the user's, as the edit dialog starts with it: on the plan its addresses or region are. */
export function draftOfProvider(provider: Provider): FormDraft {
  const preset = presetById(provider.presetId) ?? null
  const plan = providerPlan(provider)?.plan ?? (preset === null ? null : presetPlan(preset, null))
  return {
    presetId: preset?.id ?? null,
    planId: plan?.id ?? null,
    name: provider.name,
    apiKey: provider.apiKey,
    endpoint: preset?.endpoint === undefined ? '' : azureResource(provider.urls.responses ?? ''),
    project: provider.cloud?.kind === 'vertex' ? provider.cloud.project : '',
    urls: { ...provider.urls },
    models: [...provider.models],
    keyHeader: provider.keyHeader,
  }
}

/** Whether a draft can be saved: a model, a key, and what else its preset asks for. */
export function canAdd(draft: FormDraft, preset: ProviderPreset | null): boolean {
  if (draft.models.length === 0) return false
  if (preset === null) {
    const hasUrl = Object.values(draft.urls).some((url) => (url ?? '').trim() !== '')
    return draft.name.trim() !== '' && hasUrl && draft.apiKey.trim() !== ''
  }
  if (preset.cloud === 'vertex') return draft.project.trim() !== ''
  if (preset.endpoint !== undefined && azureResource(draft.endpoint) === '') return false
  return draft.apiKey.trim() !== ''
}

/** The cloud a preset's plan is reached through by Claude Code; `null` for none. */
function cloudOf(preset: ProviderPreset, planId: string, project: string): ProviderCloud | null {
  if (preset.cloud === 'bedrock') return { kind: 'bedrock', region: planId }
  if (preset.cloud === 'vertex') return { kind: 'vertex', region: planId, project: project.trim() }
  return null
}

/**
 * What a draft saves, besides its name: its key, its models, and its
 * addresses, a preset's fixed by its plan (Azure's under the user's
 * resource), with the cloud and region Claude Code reaches it through.
 */
export function providerInputOf(
  draft: FormDraft,
  preset: ProviderPreset | null,
): Omit<NewProvider, 'name' | 'presetId'> {
  const common = { apiKey: draft.apiKey.trim(), keyHeader: draft.keyHeader, models: draft.models }
  if (preset === null) return { ...common, planId: null, urls: draft.urls, cloud: null }
  const plan = presetPlan(preset, draft.planId)
  const urls =
    preset.endpoint === undefined
      ? { ...plan.urls }
      : { responses: `${azureResource(draft.endpoint)}${AZURE_PATH}` }
  return {
    ...common,
    planId: planIdOf(preset, plan),
    urls,
    cloud: cloudOf(preset, plan.id, draft.project),
  }
}

/** The provider a draft adds: a preset's named after it, with a number when that name is taken. */
export function newProviderOf(
  draft: FormDraft,
  preset: ProviderPreset | null,
  providers: readonly Provider[],
): NewProvider {
  return {
    name: preset === null ? draft.name.trim() : freeProviderName(providers, preset.name),
    presetId: preset?.id ?? null,
    ...providerInputOf(draft, preset),
  }
}

/**
 * Vertex AI's address in a region: the global one has no region in its
 * host, the multi-regions `us` and `eu` theirs after it.
 */
export function vertexAddress(region: string): string {
  if (region === 'global') return 'https://aiplatform.googleapis.com/v1'
  if (region === 'us' || region === 'eu')
    return `https://aiplatform.${region}.rep.googleapis.com/v1`
  return `https://${region}-aiplatform.googleapis.com/v1`
}

/**
 * The addresses a preset's draft is reached at, which its plan or region
 * fixes, as the form shows them: Vertex AI's in its region; none for Azure,
 * whose endpoint field shows its own.
 */
export function addressesOf(
  preset: ProviderPreset,
  draft: Pick<FormDraft, 'planId'>,
): Partial<Record<WireFormat, string>> {
  const plan = presetPlan(preset, draft.planId)
  if (preset.cloud === 'vertex') return { anthropic: vertexAddress(plan.id) }
  if (preset.endpoint !== undefined) return {}
  return plan.urls
}

/** Whether a preset is what a search asks for: by its name, its id or another name of it. */
export function presetMatches(preset: ProviderPreset, query: string): boolean {
  const wanted = query.trim().toLowerCase()
  if (wanted === '') return true
  return [preset.name, preset.id, ...(preset.aliases ?? [])].some((name) =>
    name.toLowerCase().includes(wanted),
  )
}

/** Whether a provider of the user's own is what a search asks for. */
export function customMatches(query: string): boolean {
  const wanted = query.trim().toLowerCase()
  return wanted === '' || 'custom'.includes(wanted) || '自定义'.includes(wanted)
}

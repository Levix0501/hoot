import {
  AZURE_PATH,
  catalogModelIds,
  firstPicks,
  freeProviderName,
  hostOf,
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
  type ProviderChange,
  type ProviderCloud,
  type ProviderPreset,
  type WireFormat,
} from '../../shared/providers'

/** A provider as its panel keeps it until it is added or saved. */
export interface FormDraft {
  presetId: string | null
  /** The preset's plan or region; `null` for a provider of the user's own. */
  planId: string | null
  /** The name typed: blank for a new provider's own (see `newProviderName`). */
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

/**
 * A new provider's draft: a preset's first plan, with the models picked of
 * it at first (see `firstPicks`), and no name typed.
 */
export function draftOf(preset: ProviderPreset | null, catalogs: ModelCatalogs): FormDraft {
  const plan = preset === null ? null : presetPlan(preset, null)
  return {
    presetId: preset?.id ?? null,
    planId: plan?.id ?? null,
    name: '',
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

/** A provider of the user's, as the edit panel starts with it: on the plan its addresses or region are. */
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

/**
 * Whether a draft can be added: a key, what else its preset asks for, and a
 * model, which one of the user's own can do without, its agents offering the
 * models of its address's maker, Claude's at an Anthropic-compatible address
 * and OpenAI's at a Responses one (see `addedModels`). One left unnamed gets
 * a name (see `newProviderName`).
 */
export function canAdd(draft: FormDraft, preset: ProviderPreset | null): boolean {
  if (preset === null) {
    const hasUrl = Object.values(draft.urls).some((url) => (url ?? '').trim() !== '')
    return hasUrl && draft.apiKey.trim() !== ''
  }
  if (draft.models.length === 0) return false
  if (preset.cloud === 'vertex') return draft.project.trim() !== ''
  if (preset.endpoint !== undefined && azureResource(draft.endpoint) === '') return false
  return draft.apiKey.trim() !== ''
}

/** Whether an edited provider's draft can be saved: as one added can (see `canAdd`), and named. */
export function canSave(draft: FormDraft, preset: ProviderPreset | null): boolean {
  return canAdd(draft, preset) && draft.name.trim() !== ''
}

const blank = (text: string | undefined) => (text ?? '').trim() === ''

/** Whether two sets of addresses are the same, as a provider keeps them: trimmed, blank ones none. */
function sameAddresses(
  a: Partial<Record<WireFormat, string>>,
  b: Partial<Record<WireFormat, string>>,
): boolean {
  const formats = new Set([...Object.keys(a), ...Object.keys(b)] as WireFormat[])
  return [...formats].every((format) => (a[format] ?? '').trim() === (b[format] ?? '').trim())
}

/**
 * An edited provider's draft with what keeps it from being saved (see
 * `canSave`) put back as the provider has it: a blank name, key, endpoint or
 * project; for one of the user's own, addresses that leave it none; for a
 * preset's, its models, where none is left. The draft itself where nothing
 * is put back.
 */
export function savableDraft(
  draft: FormDraft,
  provider: Provider,
  preset: ProviderPreset | null,
): FormDraft {
  const saved = draftOfProvider(provider)
  const next = { ...draft }
  if (blank(next.name)) next.name = saved.name
  if (blank(next.apiKey) && preset?.cloud !== 'vertex') next.apiKey = saved.apiKey
  if (preset?.endpoint !== undefined && azureResource(next.endpoint) === '') {
    next.endpoint = saved.endpoint
  }
  if (preset?.cloud === 'vertex' && blank(next.project)) next.project = saved.project
  if (preset === null) {
    if (Object.values(next.urls).every((url) => blank(url))) next.urls = saved.urls
  } else if (next.models.length === 0) {
    next.models = saved.models
  }
  const changed = (Object.keys(next) as Array<keyof FormDraft>).some(
    (field) => next[field] !== draft[field],
  )
  return changed ? next : draft
}

/** A provider's cloud, as compared: its kind, region and project, trimmed. */
function cloudKey(cloud: ProviderCloud | null): string {
  if (cloud === null) return ''
  const project = cloud.kind === 'vertex' ? cloud.project.trim() : ''
  return [cloud.kind, cloud.region.trim(), project].join('\n')
}

/**
 * What an edited provider's draft changes of it: each field it saves (see
 * `providerInputOf`) that differs from the provider's, as the provider keeps
 * it, trimmed, blank addresses none. Empty where the draft changes nothing.
 */
export function providerChange(
  provider: Provider,
  draft: FormDraft,
  preset: ProviderPreset | null,
): ProviderChange {
  const input = { name: draft.name.trim(), ...providerInputOf(draft, preset) }
  const change: ProviderChange = {}
  if (input.name !== provider.name) change.name = input.name
  if (input.planId !== provider.planId) change.planId = input.planId
  if (input.apiKey !== provider.apiKey) change.apiKey = input.apiKey
  if (input.keyHeader !== provider.keyHeader) change.keyHeader = input.keyHeader
  if (!sameAddresses(input.urls, provider.urls)) change.urls = input.urls
  if (input.models.join('\n') !== provider.models.join('\n')) change.models = input.models
  if (cloudKey(input.cloud) !== cloudKey(provider.cloud)) change.cloud = input.cloud
  return change
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

/**
 * The name a new provider gets where none is typed: its preset's; for one
 * of the user's own, its first address's host, else Custom; with a number
 * when that name is taken.
 */
export function newProviderName(
  draft: Pick<FormDraft, 'urls'>,
  preset: ProviderPreset | null,
  providers: readonly Provider[],
): string {
  const address = [draft.urls.anthropic, draft.urls.responses].find((url) => !blank(url))
  const host = address === undefined ? null : hostOf(address)
  return freeProviderName(providers, preset?.name ?? host ?? 'Custom')
}

/** The provider a draft adds, named as typed, else as `newProviderName` names it. */
export function newProviderOf(
  draft: FormDraft,
  preset: ProviderPreset | null,
  providers: readonly Provider[],
): NewProvider {
  return {
    name: draft.name.trim() || newProviderName(draft, preset, providers),
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

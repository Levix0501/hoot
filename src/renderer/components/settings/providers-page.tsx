import { ChevronRightIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { cn } from 'cn'
import { useState } from 'react'
import { toast } from '../../lib/toast'
import type { AgentState } from '../../../shared/agents'
import {
  agentName,
  canRun,
  FORMATS_OF,
  harnessesOf,
  maskKey,
  ownNeedsSignIn,
  ownProvider,
  presetById,
  providerMark,
  type Provider,
  type ProvidersState,
} from '../../../shared/providers'
import { getCodingTool, type CodingToolId } from '../../../shared/tools'
import { canAdd, draftOfProvider, providerInputOf, type FormDraft } from '../../lib/provider-draft'
import { useAppStore } from '../../store/app-store'
import { AgentIcon, ProviderMarkIcon } from '../provider-icon'
import { ToolIcon } from '../tool-icon'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { CATALOG_SEARCH, ProviderCatalog, useInstalled } from './provider-catalog'
import { Field, ProviderFields } from './provider-fields'

/** The installed harnesses whose global a provider is. */
function useGlobalOf(providerId: string): CodingToolId[] {
  const installed = useInstalled()
  const globals = useAppStore((state) => state.providers?.globals)
  return installed.filter((harness) => globals?.[harness]?.providerId === providerId)
}

/** Global, with the marks of the harnesses whose global the provider is. */
function GlobalBadge({ providerId }: { providerId: string }) {
  const harnesses = useGlobalOf(providerId)
  if (harnesses.length === 0) return null
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge variant="secondary" className="gap-1 pl-1.5" data-testid="provider-global-badge" />
        }
      >
        {harnesses.map((harness) => (
          <ToolIcon key={harness} toolId={harness} />
        ))}
        Global
      </TooltipTrigger>
      <TooltipContent>
        {harnesses.map((harness) => getCodingTool(harness).label).join(' and ')} run
        {harnesses.length === 1 ? 's' : ''} on it outside Hoot too
      </TooltipContent>
    </Tooltip>
  )
}

/** Says a subscription is not signed in, which then gives its harness no global. */
function SignedOut({ provider }: { provider: Provider }) {
  const signedOut = useAppStore((state) => {
    const harness = provider.own
    if (harness === null || !ownNeedsSignIn(harness)) return false
    const global = state.providers?.globals[harness]
    return global?.providerId === provider.id && !global.signedIn
  })
  if (!signedOut) return null
  return (
    <span className="shrink-0 text-xs text-muted-foreground" data-testid="provider-signed-out">
      Not signed in
    </span>
  )
}

/** The installed harnesses that can run a provider, as small marks. */
function HarnessMarks({ provider }: { provider: Provider }) {
  const installed = useInstalled()
  const harnesses = harnessesOf(provider).filter((harness) => installed.includes(harness))
  return (
    <span className="flex shrink-0 items-center gap-1" data-testid="provider-harness-marks">
      {harnesses.map((harness) => (
        <Tooltip key={harness}>
          <TooltipTrigger render={<span className="flex" />}>
            <ToolIcon toolId={harness} className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent>{getCodingTool(harness).label} can run it</TooltipContent>
        </Tooltip>
      ))}
    </span>
  )
}

/**
 * The models a harness's global can pick on a provider: on the harness's own
 * models, those its configuration offers; on a provider of the user's, its
 * own; and the one the configuration names, when neither has it.
 */
function globalModels(
  provider: Provider | undefined,
  state: AgentState | undefined,
  current: string | null,
): string[] {
  const models =
    provider === undefined
      ? []
      : provider.own === null
        ? provider.models
        : (state?.launchOptions?.models ?? []).map((model) => model.value)
  return current !== null && !models.includes(current) ? [current, ...models] : models
}

/** Default, in a select of models. */
const DEFAULT_MODEL = '\u0000default'

/** One harness's global: the provider and model its own configuration names. */
function GlobalRow({ harness, providers }: { harness: CodingToolId; providers: ProvidersState }) {
  const global = providers.globals[harness]
  const agentStates = useAppStore((state) => state.agents)
  const setGlobalProvider = useAppStore((state) => state.setGlobalProvider)
  const setGlobalModel = useAppStore((state) => state.setGlobalModel)
  const [saving, setSaving] = useState(false)
  if (global === undefined) return null
  const choices = [ownProvider(harness), ...providers.providers.filter((p) => canRun(p, harness))]
  const provider = choices.find((p) => p.id === global.providerId)
  const state = agentStates?.agents.find((entry) => entry.id === harness)
  const models = globalModels(provider, state, global.model)
  // Hoot writes only the configurations of the harnesses it runs providers with.
  const writable = FORMATS_OF[harness].length > 0
  const tell = (result: { ok: true } | { ok: false; message: string }) => {
    setSaving(false)
    if (!result.ok) toast.error('Could not change the global.', { description: result.message })
  }
  const providerItems = choices.map((choice) => ({
    value: choice.id,
    label: (
      <span className="flex items-center gap-2">
        <ProviderMarkIcon mark={providerMark(choice)} className="size-4" />
        {choice.name}
      </span>
    ),
  }))
  const modelItems = [
    { value: DEFAULT_MODEL, label: 'Default' },
    ...models.map((model) => ({
      value: model,
      label: <span className="font-mono text-xs">{model}</span>,
    })),
  ]
  return (
    <div className="flex items-center gap-3 px-4 py-2.5" data-testid={`global-row-${harness}`}>
      <ToolIcon toolId={harness} className="size-5 shrink-0" />
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="text-sm font-medium">{getCodingTool(harness).label}</span>
        {provider !== undefined && <SignedOut provider={provider} />}
      </span>
      <Select
        items={providerItems}
        value={global.providerId}
        onValueChange={(id) => {
          if (typeof id !== 'string' || id === global.providerId) return
          setSaving(true)
          void setGlobalProvider(harness, id).then(tell)
        }}
        disabled={!writable || saving}
      >
        <SelectTrigger
          className="w-56"
          aria-label={`${getCodingTool(harness).label} global provider`}
          data-testid={`global-provider-${harness}`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false} align="end">
          {providerItems.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        items={modelItems}
        value={global.model ?? DEFAULT_MODEL}
        onValueChange={(value) => {
          if (typeof value !== 'string') return
          const model = value === DEFAULT_MODEL ? null : value
          if (model === global.model) return
          setSaving(true)
          void setGlobalModel(harness, model).then(tell)
        }}
        disabled={!writable || saving}
      >
        <SelectTrigger
          className="w-44"
          aria-label={`${getCodingTool(harness).label} global model`}
          data-testid={`global-model-${harness}`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false} align="end">
          {modelItems.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/**
 * What each installed harness runs on wherever no agent of Hoot's picks a
 * provider: outside Hoot, as its own configuration names it, which a change
 * here writes.
 */
function GlobalCard({ providers }: { providers: ProvidersState }) {
  const installed = useInstalled().filter((harness) => providers.globals[harness] !== undefined)
  if (installed.length === 0) return null
  return (
    <div className="flex flex-col rounded-xl border" data-testid="global-card">
      <div className="flex flex-col gap-0.5 px-4 pt-3 pb-1">
        <span className="text-sm font-medium">Global</span>
        <span className="text-xs text-muted-foreground">
          Each harness uses its own, also outside Hoot.
        </span>
      </div>
      {installed.map((harness) => (
        <GlobalRow key={harness} harness={harness} providers={providers} />
      ))}
    </div>
  )
}

/** The agents that run on a provider, each of which opens the Agents page. */
function UsedBy({ provider }: { provider: Provider }) {
  const providers = useAppStore((state) => state.providers)
  const selectSection = useAppStore((state) => state.selectSettingsSection)
  const agents = (providers?.agents ?? []).filter((agent) => agent.providerId === provider.id)
  if (providers === null || agents.length === 0) return null
  return (
    <Field label="Agents">
      <div className="flex flex-wrap items-center gap-1">
        {agents.map((agent) => (
          <button
            key={agent.id}
            type="button"
            onClick={() => selectSection('agents')}
            className="inline-flex h-6 items-center gap-1.5 rounded-md bg-muted px-1.5 text-xs hover:bg-muted/70"
          >
            <AgentIcon toolId={agent.harness} providerId={agent.providerId} className="size-3.5" />
            {agentName(agent, providers)}
          </button>
        ))}
      </div>
    </Field>
  )
}

/** Delete, which a provider that is a global, or that agents run on, cannot be. */
function DeleteProviderButton({
  provider,
  onDeleted,
}: {
  provider: Provider
  onDeleted: () => void
}) {
  const used = useAppStore(
    (state) => (state.providers?.agents ?? []).filter((a) => a.providerId === provider.id).length,
  )
  const globalOf = useGlobalOf(provider.id)
  const removeProvider = useAppStore((state) => state.removeProvider)
  const blocked =
    globalOf.length > 0
      ? `${globalOf.map((harness) => getCodingTool(harness).label).join(' and ')} use${
          globalOf.length === 1 ? 's' : ''
        } it globally: pick another first`
      : used > 0
        ? `${used === 1 ? 'An agent runs' : `${used} agents run`} on it: delete them first`
        : null
  const button = (
    <Button
      variant="ghost"
      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
      disabled={blocked !== null}
      onClick={() =>
        void removeProvider(provider.id).then((result) => {
          if (result.ok) onDeleted()
          else toast.error('Could not delete the provider.', { description: result.message })
        })
      }
      data-testid="provider-delete"
    >
      <Trash2Icon />
      Delete
    </Button>
  )
  if (blocked === null) return button
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>{button}</TooltipTrigger>
      <TooltipContent>{blocked}</TooltipContent>
    </Tooltip>
  )
}

/**
 * The dialog that edits a provider of the user's: the add form's fields, its
 * name too, a preset's addresses fixed by its plan.
 */
function EditProviderDialog({ provider, onClose }: { provider: Provider; onClose: () => void }) {
  const updateProvider = useAppStore((state) => state.updateProvider)
  const preset = presetById(provider.presetId) ?? null
  const [draft, setDraft] = useState<FormDraft>(() => draftOfProvider(provider))
  const [saving, setSaving] = useState(false)
  const valid = canAdd(draft, preset) && draft.name.trim() !== ''
  const save = async () => {
    if (!valid || saving) return
    setSaving(true)
    const result = await updateProvider(provider.id, {
      name: draft.name.trim(),
      ...providerInputOf(draft, preset),
    })
    setSaving(false)
    if (!result.ok) {
      toast.error('Could not save the provider.', { description: result.message })
      return
    }
    onClose()
  }
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg" data-testid="edit-provider-dialog">
        <DialogHeader className="flex-row items-center gap-2">
          <ProviderMarkIcon mark={providerMark(provider)} className="size-5" />
          <DialogTitle>{provider.name}</DialogTitle>
          <GlobalBadge providerId={provider.id} />
        </DialogHeader>
        <ProviderFields
          preset={preset}
          draft={draft}
          onChange={setDraft}
          onSubmit={() => void save()}
          autoFocusKey={false}
          editing
        />
        <UsedBy provider={provider} />
        <DialogFooter className="sm:justify-between">
          <DeleteProviderButton provider={provider} onDeleted={onClose} />
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={!valid || saving}
              onClick={() => void save()}
              data-testid="edit-provider-save"
            >
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** A provider's row: its mark, name and models, the harnesses that can run it, its key. */
function ProviderRow({ provider, onOpen }: { provider: Provider; onOpen: () => void }) {
  const own = provider.own !== null
  return (
    <div
      role={own ? undefined : 'button'}
      tabIndex={own ? undefined : 0}
      onClick={own ? undefined : onOpen}
      onKeyDown={(event) => {
        if (own) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
      className={cn(
        'flex w-full items-center gap-3 px-4 py-3 text-left outline-none',
        !own && 'cursor-default hover:bg-muted/40 focus-visible:bg-muted/40',
      )}
      data-testid="provider-row"
      data-provider={provider.id}
    >
      <ProviderMarkIcon mark={providerMark(provider)} className="size-5 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium" data-testid="provider-row-name">
            {provider.name}
          </span>
          <GlobalBadge providerId={provider.id} />
          <SignedOut provider={provider} />
        </span>
        {provider.models.length > 0 && (
          <span className="truncate font-mono text-xs text-muted-foreground">
            {provider.models.join(' · ')}
          </span>
        )}
      </span>
      <HarnessMarks provider={provider} />
      <span className="w-24 shrink-0 text-right font-mono text-xs text-muted-foreground">
        {own ? '' : maskKey(provider.apiKey)}
      </span>
      <ChevronRightIcon
        className={cn('size-4 shrink-0 text-muted-foreground', own && 'invisible')}
      />
    </div>
  )
}

/**
 * The settings' Providers page: each installed harness's global, then the
 * providers, the installed harnesses' own models first, each of the user's
 * opening a dialog that edits it, then every preset to add one of, or one of
 * the user's own, which Add provider goes to.
 */
export function ProvidersPage() {
  const providers = useAppStore((state) => state.providers)
  const installed = useInstalled()
  const [editing, setEditing] = useState<string | null>(null)
  const listed = [
    ...installed.map((harness) => ownProvider(harness)),
    ...(providers?.providers ?? []),
  ]
  const edited = providers?.providers.find((provider) => provider.id === editing)
  return (
    <div className="flex min-w-0 flex-1 flex-col bg-background" data-testid="providers-page">
      {/* The page's part of the window's top row, which drags the window. */}
      <div className="h-11.5 shrink-0 [app-region:drag]" />
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 pt-2 pb-10">
          <div className="flex min-h-7 items-center justify-between gap-4">
            <h1 className="text-2xl font-semibold tracking-tight">Providers</h1>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const search = document.getElementById(CATALOG_SEARCH)
                search?.scrollIntoView({ block: 'center', behavior: 'smooth' })
                search?.focus({ preventScroll: true })
              }}
              data-testid="add-provider"
            >
              <PlusIcon />
              Add provider
            </Button>
          </div>
          {providers !== null && <GlobalCard providers={providers} />}
          {listed.length > 0 && (
            <div
              className="flex flex-col divide-y overflow-hidden rounded-xl border"
              data-testid="providers-list"
            >
              {listed.map((provider) => (
                <ProviderRow
                  key={provider.id}
                  provider={provider}
                  onOpen={() => setEditing(provider.id)}
                />
              ))}
            </div>
          )}
          <ProviderCatalog />
        </div>
      </div>
      {edited && (
        <EditProviderDialog key={edited.id} provider={edited} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}

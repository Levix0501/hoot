import {
  ArrowUpRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EyeIcon,
  EyeOffIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react'
import { cn } from 'cn'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
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
  PROVIDER_PRESETS,
  type NewProvider,
  type Provider,
  type ProviderPreset,
  type ProvidersState,
  type WireFormat,
} from '../../../shared/providers'
import { toolStatus } from '../../../shared/tool-status'
import { CODING_TOOL_IDS, getCodingTool, getTool, type CodingToolId } from '../../../shared/tools'
import { api } from '../../lib/api'
import { useAppStore } from '../../store/app-store'
import { AgentIcon, ProviderMarkIcon } from '../provider-icon'
import { ToolIcon } from '../tool-icon'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '../ui/input-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

/** A provider as the add and edit dialogs keep it until it is saved. */
type Draft = NewProvider

/** The harnesses installed, as the last detection found them, in their order. */
function useInstalled(): CodingToolId[] {
  const tools = useAppStore((state) => state.tools)
  return CODING_TOOL_IDS.filter((id) => toolStatus(tools, getTool(id)) === 'available')
}

/** The address of each format, named by the harness that takes it first. */
const URL_ROWS: ReadonlyArray<{ format: WireFormat; harness: CodingToolId; placeholder: string }> =
  [
    { format: 'anthropic', harness: 'claude', placeholder: 'https://…/anthropic' },
    { format: 'responses', harness: 'codex', placeholder: 'https://…/v1' },
  ].filter(({ harness }) => FORMATS_OF[harness as CodingToolId].length > 0) as ReadonlyArray<{
    format: WireFormat
    harness: CodingToolId
    placeholder: string
  }>

function draftFrom(preset: ProviderPreset | null): Draft {
  return preset === null
    ? { name: '', presetId: null, apiKey: '', keyHeader: 'bearer', urls: {}, models: [] }
    : {
        name: preset.name,
        presetId: preset.id,
        apiKey: '',
        keyHeader: preset.keyHeader,
        urls: { ...preset.urls },
        models: [...preset.models],
      }
}

/** Whether a draft can be saved: it has a name, an address and a key. */
function draftValid(draft: Draft): boolean {
  const hasUrl = Object.values(draft.urls).some((url) => (url ?? '').trim() !== '')
  return draft.name.trim() !== '' && hasUrl && draft.apiKey.trim() !== ''
}

/** A field with its label above it. */
function Field({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  )
}

/** The key, hidden until the eye shows it, with a link to where the provider gives keys out. */
function KeyField({
  value,
  onChange,
  keyUrl,
  autoFocus,
}: {
  value: string
  onChange: (value: string) => void
  keyUrl: string | null
  autoFocus?: boolean
}) {
  const [shown, setShown] = useState(false)
  return (
    <InputGroup>
      <InputGroupInput
        id="provider-key"
        type={shown ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoFocus={autoFocus}
        spellCheck={false}
        autoComplete="off"
        placeholder="sk-…"
        className="font-mono text-xs md:text-xs"
        data-testid="provider-key"
      />
      <InputGroupAddon align="inline-end">
        <Tooltip>
          <TooltipTrigger
            render={
              <InputGroupButton
                size="icon-xs"
                aria-label={shown ? 'Hide key' : 'Show key'}
                onClick={() => setShown(!shown)}
              />
            }
          >
            {shown ? <EyeOffIcon /> : <EyeIcon />}
          </TooltipTrigger>
          <TooltipContent>{shown ? 'Hide key' : 'Show key'}</TooltipContent>
        </Tooltip>
        {keyUrl !== null && (
          <Tooltip>
            <TooltipTrigger
              render={
                <InputGroupButton
                  size="icon-xs"
                  aria-label="Get a key"
                  onClick={() => api.openExternalLink(keyUrl)}
                />
              }
            >
              <ArrowUpRightIcon />
            </TooltipTrigger>
            <TooltipContent>Get a key</TooltipContent>
          </Tooltip>
        )}
      </InputGroupAddon>
    </InputGroup>
  )
}

/** One address for each format an agent takes, named by that agent. */
function UrlsField({
  urls,
  onChange,
}: {
  urls: Partial<Record<WireFormat, string>>
  onChange: (urls: Partial<Record<WireFormat, string>>) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {URL_ROWS.map(({ format, harness, placeholder }) => (
        <InputGroup key={format}>
          <InputGroupAddon className="w-28 justify-start text-xs text-muted-foreground">
            <ToolIcon toolId={harness} className="size-4" />
            {getCodingTool(harness).label}
          </InputGroupAddon>
          <InputGroupInput
            value={urls[format] ?? ''}
            onChange={(event) => onChange({ ...urls, [format]: event.target.value })}
            spellCheck={false}
            aria-label={`${getCodingTool(harness).label} URL`}
            placeholder={placeholder}
            className="font-mono text-xs md:text-xs"
            data-testid={`provider-url-${format}`}
          />
        </InputGroup>
      ))}
    </div>
  )
}

/** The models, as chips, with a field that adds one. */
function ModelsField({
  models,
  onChange,
}: {
  models: string[]
  onChange: (models: string[]) => void
}) {
  const [draft, setDraft] = useState('')
  const commit = () => {
    const model = draft.trim()
    if (model === '') return
    if (!models.includes(model)) onChange([...models, model])
    setDraft('')
  }
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1 rounded-lg border border-input px-1.5 py-1 has-[input:focus]:border-ring has-[input:focus]:ring-3 has-[input:focus]:ring-ring/50 dark:bg-input/30">
      {models.map((model) => (
        <span
          key={model}
          className="inline-flex h-6 max-w-full items-center gap-1 rounded-md bg-muted pr-0.5 pl-1.5 font-mono text-xs"
        >
          <span className="truncate">{model}</span>
          <button
            type="button"
            aria-label={`Remove ${model}`}
            className="flex size-4 items-center justify-center rounded-sm text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
            onClick={() => onChange(models.filter((m) => m !== model))}
          >
            <XIcon className="size-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          } else if (event.key === 'Backspace' && draft === '' && models.length > 0) {
            onChange(models.slice(0, -1))
          }
        }}
        onBlur={commit}
        spellCheck={false}
        placeholder="Add model…"
        aria-label="Add model"
        className="h-6 min-w-28 flex-1 bg-transparent px-1 font-mono text-xs outline-none placeholder:text-muted-foreground"
        data-testid="provider-models-input"
      />
    </div>
  )
}

/** The fields of a provider: its name, for one Hoot does not know or one being edited, key, addresses and models. */
function DraftFields({
  draft,
  onChange,
  showName,
  adding = false,
}: {
  draft: Draft
  onChange: (draft: Draft) => void
  showName: boolean
  adding?: boolean
}) {
  return (
    <div className="flex flex-col gap-4">
      {showName && (
        <Field label="Name" htmlFor="provider-name">
          <Input
            id="provider-name"
            value={draft.name}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
            autoFocus={adding && draft.presetId === null}
            data-testid="provider-name"
          />
        </Field>
      )}
      <Field label="API key" htmlFor="provider-key">
        <KeyField
          value={draft.apiKey}
          onChange={(apiKey) => onChange({ ...draft, apiKey })}
          keyUrl={presetById(draft.presetId)?.keyUrl ?? null}
          autoFocus={adding && draft.presetId !== null}
        />
      </Field>
      <Field label="Base URLs">
        <UrlsField urls={draft.urls} onChange={(urls) => onChange({ ...draft, urls })} />
      </Field>
      <Field label="Models">
        <ModelsField models={draft.models} onChange={(models) => onChange({ ...draft, models })} />
      </Field>
    </div>
  )
}

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

/** A preset to pick, as a tile. */
function PresetTile({ preset, onPick }: { preset: ProviderPreset | null; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="flex h-11 min-w-0 items-center gap-2.5 rounded-lg border px-3 text-left text-sm outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50"
      data-testid={`provider-preset-${preset?.id ?? 'custom'}`}
    >
      {preset === null ? (
        <PlusIcon className="size-4 shrink-0 text-muted-foreground" />
      ) : (
        <ProviderMarkIcon mark={preset.mark} className="size-5 shrink-0" />
      )}
      <span className="truncate">{preset === null ? 'Custom' : preset.name}</span>
    </button>
  )
}

/** The presets an agent of Hoot's can run: those with an address in a format one takes. */
const OFFERED_PRESETS = PROVIDER_PRESETS.filter((preset) =>
  CODING_TOOL_IDS.some((harness) =>
    FORMATS_OF[harness].some((format) => (preset.urls[format] ?? '') !== ''),
  ),
)

function AddProviderDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const addProvider = useAppStore((state) => state.addProvider)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const close = () => {
    onClose()
    window.setTimeout(() => setDraft(null), 150)
  }
  const save = async (adding: Draft) => {
    setSaving(true)
    const result = await addProvider({ ...adding, name: adding.name.trim() })
    setSaving(false)
    if (!result.ok) {
      toast.error('Could not add the provider.', { description: result.message })
      return
    }
    close()
  }
  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-xl" data-testid="add-provider-dialog">
        {draft === null ? (
          <>
            <DialogHeader>
              <DialogTitle>Add provider</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-3 gap-2">
              {OFFERED_PRESETS.map((preset) => (
                <PresetTile
                  key={preset.id}
                  preset={preset}
                  onPick={() => setDraft(draftFrom(preset))}
                />
              ))}
              <PresetTile preset={null} onPick={() => setDraft(draftFrom(null))} />
            </div>
          </>
        ) : (
          <>
            <DialogHeader className="flex-row items-center gap-2">
              <Button
                variant="ghost"
                size="icon-sm"
                className="-my-1 -ml-1.5"
                aria-label="Back"
                onClick={() => setDraft(null)}
              >
                <ChevronLeftIcon />
              </Button>
              <ProviderMarkIcon mark={providerMark({ ...draft, own: null })} className="size-5" />
              <DialogTitle>{draft.presetId === null ? 'Custom provider' : draft.name}</DialogTitle>
            </DialogHeader>
            <DraftFields
              draft={draft}
              onChange={setDraft}
              showName={draft.presetId === null}
              adding
            />
            <DialogFooter>
              <Button variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button
                disabled={!draftValid(draft) || saving}
                onClick={() => void save(draft)}
                data-testid="add-provider-save"
              >
                Add provider
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
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

function EditProviderDialog({ provider, onClose }: { provider: Provider; onClose: () => void }) {
  const updateProvider = useAppStore((state) => state.updateProvider)
  const [draft, setDraft] = useState<Draft>(provider)
  const [saving, setSaving] = useState(false)
  const save = async () => {
    setSaving(true)
    const result = await updateProvider(provider.id, { ...draft, name: draft.name.trim() })
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
        <DraftFields draft={draft} onChange={setDraft} showName />
        <UsedBy provider={provider} />
        <DialogFooter className="sm:justify-between">
          <DeleteProviderButton provider={provider} onDeleted={onClose} />
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={!draftValid(draft) || saving}
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
 * opening a dialog that edits it, and Add provider, which adds one from a
 * preset or of the user's own.
 */
export function ProvidersPage() {
  const providers = useAppStore((state) => state.providers)
  const addingProvider = useAppStore((state) => state.addingProvider)
  const tookAddingProvider = useAppStore((state) => state.tookAddingProvider)
  const installed = useInstalled()
  const [adding, setAdding] = useState(false)
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
              onClick={() => setAdding(true)}
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
        </div>
      </div>
      {/* Also when another page asked to add one, as an agent's Add provider… does. */}
      <AddProviderDialog
        open={adding || addingProvider}
        onClose={() => {
          setAdding(false)
          tookAddingProvider()
        }}
      />
      {edited && (
        <EditProviderDialog key={edited.id} provider={edited} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}

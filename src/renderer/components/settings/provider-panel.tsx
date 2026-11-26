import { Trash2Icon } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from '../../lib/toast'
import type { AgentModelOption } from '../../../shared/agents'
import {
  agentName,
  CLAUDE_ROLE_NAMES,
  CLAUDE_ROLES,
  ownNeedsSignIn,
  ownProvider,
  presetById,
  providerMark,
  type Provider,
} from '../../../shared/providers'
import { getCodingTool, type CodingToolId } from '../../../shared/tools'
import {
  canSave,
  draftOfProvider,
  providerChange,
  savableDraft,
  type FormDraft,
} from '../../lib/provider-draft'
import { useAppStore } from '../../store/app-store'
import { AgentIcon, ProviderMarkIcon } from '../provider-icon'
import { ToolIcon } from '../tool-icon'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Sheet, SheetContent, SheetTitle } from '../ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { TitleName } from './agent-panel'
import { useInstalled } from './provider-catalog'
import { Field, ProviderFields } from './provider-fields'

/** The installed harnesses whose global a provider is. */
function useGlobalOf(providerId: string): CodingToolId[] {
  const installed = useInstalled()
  const globals = useAppStore((state) => state.providers?.globals)
  return installed.filter((harness) => globals?.[harness]?.providerId === providerId)
}

/** Global, with the marks of the harnesses whose global the provider is. */
export function GlobalBadge({ providerId }: { providerId: string }) {
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
export function SignedOut({ provider }: { provider: Provider }) {
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
      size="sm"
      className="text-destructive hover:text-destructive"
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

/** The panel's header: the provider's mark, its name, and what else it says of it. */
function Header({ provider, children }: { provider: Provider; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b px-5 pt-5 pb-4">
      <ProviderMarkIcon mark={providerMark(provider)} className="size-5 shrink-0" />
      {children}
      <SignedOut provider={provider} />
      <GlobalBadge providerId={provider.id} />
    </div>
  )
}

/**
 * A provider of the user's in the panel, each change saved as it is made:
 * one typed as its field is left, or with Enter, and as the panel closes;
 * one picked at once. What would keep it from being saved, as a blank key,
 * is put back as it was instead (see `savableDraft`).
 */
function EditProvider({ provider, onClose }: { provider: Provider; onClose: () => void }) {
  const updateProvider = useAppStore((state) => state.updateProvider)
  const preset = presetById(provider.presetId) ?? null
  const [draft, setDraft] = useState<FormDraft>(() => draftOfProvider(provider))
  const commit = (current: FormDraft) => {
    // Nothing is saved of a provider deleted meanwhile.
    const providers = useAppStore.getState().providers?.providers ?? []
    if (!providers.some((candidate) => candidate.id === provider.id)) return
    const next = savableDraft(current, provider, preset)
    if (next !== current) setDraft(next)
    const change = providerChange(provider, next, preset)
    if (Object.keys(change).length === 0 || !canSave(next, preset)) return
    void updateProvider(provider.id, change).then((result) => {
      if (!result.ok) toast.error('Could not save the provider.', { description: result.message })
    })
  }
  const latest = useRef<() => void>(() => {})
  useEffect(() => {
    latest.current = () => commit(draft)
  })
  useEffect(() => () => latest.current(), [])
  const change = (next: FormDraft) => {
    setDraft(next)
    if (next.planId !== draft.planId || next.models !== draft.models) commit(next)
  }
  return (
    <div
      className="flex h-full flex-col"
      // A field typed in is saved as it is left.
      onBlur={(event) => {
        if (event.target instanceof HTMLInputElement) commit(draft)
      }}
      data-testid={`provider-panel-${provider.id}`}
    >
      <Header provider={provider}>
        <SheetTitle render={<div className="flex min-w-0 flex-1" />}>
          <TitleName
            value={draft.name}
            own={provider.name}
            onChange={(name) => setDraft({ ...draft, name })}
            onRevert={
              draft.name === provider.name
                ? null
                : () => setDraft({ ...draft, name: provider.name })
            }
            testId="provider-panel-name"
          />
        </SheetTitle>
      </Header>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
        <ProviderFields
          preset={preset}
          draft={draft}
          onChange={change}
          onSubmit={() => commit(draft)}
          autoFocusKey={false}
          editing
        />
        <UsedBy provider={provider} />
      </div>
      <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
        <DeleteProviderButton provider={provider} onDeleted={onClose} />
      </div>
    </div>
  )
}

/**
 * The name a harness's own model goes by: Claude Code's aliases as the
 * Agents page names its roles, any other by the name its harness gives it.
 */
function ownModelName(harness: CodingToolId, model: AgentModelOption): string {
  const role = CLAUDE_ROLES.find((candidate) => candidate === model.value)
  return harness === 'claude' && role !== undefined && model.label === model.value
    ? CLAUDE_ROLE_NAMES[role]
    : model.label
}

/**
 * The models a harness's own configuration offers, to be seen, not picked:
 * each by its name, with the id its sessions are started with where that
 * differs.
 */
function OwnModels({
  harness,
  models,
}: {
  harness: CodingToolId
  models: readonly AgentModelOption[]
}) {
  return (
    <Field label="Models">
      <div
        className="flex min-w-0 flex-col divide-y rounded-lg border"
        data-testid="provider-own-models"
      >
        {models.map((model) => {
          const name = ownModelName(harness, model)
          return (
            <div
              key={model.value}
              className="flex h-9 min-w-0 items-center justify-between gap-3 px-3"
            >
              <span className="truncate text-sm">{name}</span>
              {name !== model.value && (
                <span className="truncate font-mono text-xs text-muted-foreground select-text">
                  {model.value}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </Field>
  )
}

/**
 * A harness's own models in the panel, which are not the user's to change:
 * those its configuration offers, as its detection read them, and the agents
 * that run on them.
 */
function OwnProvider({ provider, harness }: { provider: Provider; harness: CodingToolId }) {
  const models = useAppStore(
    (state) => state.agents?.agents.find((entry) => entry.id === harness)?.launchOptions?.models,
  )
  return (
    <div className="flex h-full flex-col" data-testid={`provider-panel-${provider.id}`}>
      <Header provider={provider}>
        <SheetTitle className="min-w-0 flex-1 truncate text-base leading-8 font-semibold">
          {provider.name}
        </SheetTitle>
      </Header>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
        {models !== undefined && models.length > 0 && (
          <OwnModels harness={harness} models={models} />
        )}
        <UsedBy provider={provider} />
      </div>
    </div>
  )
}

/**
 * The panel at the window's right that shows a provider, by its id: one of
 * the user's, each change saved as it is made, with Delete; a harness's own
 * models, to be seen. It closes with Esc or a click beside it.
 */
export function ProviderPanel({
  target,
  onTargetChange,
}: {
  target: string | null
  onTargetChange: (target: string | null) => void
}) {
  // What it showed last, which it keeps showing as it closes.
  const [last, setLast] = useState(target)
  if (target !== null && target !== last) setLast(target)
  const shown = target ?? last
  const installed = useInstalled()
  const providers = useAppStore((state) => state.providers?.providers)
  const own = installed.find((harness) => ownProvider(harness).id === shown)
  const provider = providers?.find((candidate) => candidate.id === shown)
  const close = () => onTargetChange(null)
  return (
    <Sheet open={target !== null} onOpenChange={(open) => !open && close()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        initialFocus={false}
        // Wider than an agent's, for the addresses on one line each.
        className="gap-0 p-0 data-[side=right]:sm:max-w-[30rem]"
        data-testid="provider-panel"
      >
        {own !== undefined ? (
          <OwnProvider provider={ownProvider(own)} harness={own} />
        ) : provider !== undefined ? (
          <EditProvider key={provider.id} provider={provider} onClose={close} />
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

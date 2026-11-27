import { CheckIcon, CircleAlertIcon, CopyIcon, PlusIcon, Trash2Icon, XIcon } from 'lucide-react'
import { cn } from 'cn'
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from '../../lib/toast'
import type { AgentState } from '../../../shared/agents'
import { chatAgent } from '../../../shared/chats'
import {
  commandSegments,
  displayArgument,
  displayCommand,
  splitArguments,
} from '../../../shared/launch-command'
import {
  agentName,
  canDeleteAgent,
  canRun,
  CLAUDE_ROLE_DEFAULTS,
  CLAUDE_ROLE_NAMES,
  CLAUDE_ROLES,
  findProvider,
  providerMark,
  type Agent,
  type ClaudeRole,
  type Provider,
} from '../../../shared/providers'
import { getCodingTool, type CodingToolId } from '../../../shared/tools'
import {
  defaultEffortOf,
  draftChange,
  draftOf,
  draftOnProvider,
  draftWithModel,
  effortsOf,
  leavesRoles,
  mapsRoles,
  modelChoices,
  modelGroups,
  shownDraft,
  typedName,
  withRole,
  type AgentDraft,
} from '../../lib/agent-draft'
import { api } from '../../lib/api'
import { useAppStore } from '../../store/app-store'
import { AgentIcon, ProviderMarkIcon } from '../provider-icon'
import { Button } from '../ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
} from '../ui/select'
import { Sheet, SheetContent, SheetTitle } from '../ui/sheet'
import { Switch } from '../ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { AddProviderPanel } from './provider-panel'
import { SIDE_PANEL, TitleName } from './side-panel'

/** The choice of a provider picker that adds a provider. */
const ADD_PROVIDER = '\u0000add-provider'

/** A picker of the panel: no frame until pointed at, as wide as the panel. */
const GHOST =
  'h-8 w-full min-w-0 justify-start border-transparent px-2 hover:bg-muted dark:bg-transparent dark:hover:bg-muted/60'

/** Whether something was copied a moment ago, and a way to say that it just was. */
export function useCopied(): [copied: boolean, markCopied: () => void] {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1200)
    return () => window.clearTimeout(timer)
  }, [copied])
  return [copied, () => setCopied(true)]
}

/**
 * The providers an agent of a harness can be given: the user's it can run.
 * Its own models are none of them: Hoot gives them their one agent itself.
 */
function useProvidersFor(harness: CodingToolId): Provider[] {
  const providers = useAppStore((state) => state.providers?.providers)
  return (providers ?? []).filter((provider) => canRun(provider, harness))
}

/** The provider an agent runs on, while its harness can run it: one of the user's, or its own models. */
export function useAgentProvider(
  agent: Pick<AgentDraft, 'harness' | 'providerId'>,
): Provider | undefined {
  const providers = useAppStore((state) => state.providers?.providers)
  const provider = findProvider(providers ?? [], agent.providerId)
  return provider !== undefined && canRun(provider, agent.harness) ? provider : undefined
}

/** Whether an agent is the one a new chat starts with, which its row marks Default. */
export function useIsDefault(agentId: string): boolean {
  return useAppStore(
    (state) => chatAgent(state.tools, state.providers, state.launchSettings)?.id === agentId,
  )
}

/**
 * The name of an agent, saved or being made (`id` `null`), as it shows it,
 * and the one it gets without one of its own.
 */
function useDraftName(draft: AgentDraft, id: string | null): { name: string; own: string } {
  const providers = useAppStore((state) => state.providers)
  if (providers === null) return { name: '', own: '' }
  const agent: Agent = { ...draft, id: id ?? '\u0000new', createdAt: 0 }
  const agents =
    id === null
      ? [...providers.agents, agent]
      : providers.agents.map((other) => (other.id === id ? agent : other))
  const state = { providers: providers.providers, agents }
  return { name: agentName(agent, state), own: agentName({ ...agent, name: null }, state) }
}

/**
 * The model and effort level of an agent, as its row writes them after its
 * name, where its name does not say them: the model it runs, and the level
 * its sessions start at.
 */
export function useAgentSummary(agent: Agent, state: AgentState | undefined, name: string): string {
  const catalogs = useAppStore((app) => app.modelCatalogs)
  const provider = useAgentProvider(agent)
  const shown = shownDraft(draftOf(agent), provider, state, catalogs)
  const level =
    shown.effort ?? defaultEffortOf(shown.harness, shown.model, provider, state, catalogs)
  const parts: string[] = []
  if (shown.model !== null && !name.endsWith(shown.model)) parts.push(shown.model)
  if (level !== null) parts.push(level)
  return parts.join(' · ')
}

/**
 * The providers of a provider picker, each with its mark, and Add provider…
 * last, which opens the panel that adds one over this one, the provider
 * added becoming the one picked.
 */
function ProviderSelect({
  harness,
  value,
  onChange,
}: {
  harness: CodingToolId
  value: string
  onChange: (provider: Provider) => void
}) {
  const providers = useProvidersFor(harness)
  const [adding, setAdding] = useState(false)
  const provider = providers.find((candidate) => candidate.id === value)
  return (
    <>
      <Select
        value={provider === undefined ? null : value}
        onValueChange={(id) => {
          if (typeof id !== 'string') return
          if (id === ADD_PROVIDER) return setAdding(true)
          const picked = providers.find((candidate) => candidate.id === id)
          if (picked !== undefined) onChange(picked)
        }}
      >
        <SelectTrigger
          size="sm"
          aria-label="Provider"
          className={GHOST}
          data-testid="agent-panel-provider"
        >
          {provider ? (
            <>
              <ProviderMarkIcon mark={providerMark(provider)} className="size-4" />
              <span className="truncate">{provider.name}</span>
            </>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
          <span className="flex-1" />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false} align="start" className="w-auto min-w-52">
          {providers.length > 0 && (
            <>
              <SelectGroup>
                {providers.map((candidate) => (
                  <SelectItem
                    key={candidate.id}
                    value={candidate.id}
                    data-testid={`agent-provider-option-${candidate.id}`}
                  >
                    <span className="flex items-center gap-2">
                      <ProviderMarkIcon mark={providerMark(candidate)} className="size-4" />
                      {candidate.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectSeparator />
            </>
          )}
          <SelectItem value={ADD_PROVIDER} data-testid="agent-provider-add">
            <span className="flex items-center gap-2 text-muted-foreground">
              <PlusIcon className="size-4" />
              Add provider…
            </span>
          </SelectItem>
        </SelectContent>
      </Select>
      <AddProviderPanel
        harness={harness}
        open={adding}
        onOpenChange={setAdding}
        onAdded={onChange}
      />
    </>
  )
}

/**
 * The provider of the agent of its harness's own models, which keeps it: a
 * value in the place of a picker.
 */
function ProviderValue({ provider }: { provider: Provider }) {
  return (
    <div
      className="flex h-8 min-w-0 items-center gap-1.5 border border-transparent px-2 text-sm"
      data-testid="agent-panel-provider"
    >
      <ProviderMarkIcon mark={providerMark(provider)} className="size-4" />
      <span className="truncate">{provider.name}</span>
    </div>
  )
}

/**
 * The models of a model picker, a group at a time, after the picked one
 * where its provider no longer offers it.
 */
function ModelItems({
  groups,
  missing,
}: {
  groups: { value: string; label: string }[][]
  missing: string | null
}) {
  return (
    <>
      {missing !== null && (
        <>
          <SelectGroup>
            <SelectLabel>Not offered any more</SelectLabel>
            <SelectItem value={missing}>
              <span className="font-mono text-xs">{missing}</span>
            </SelectItem>
          </SelectGroup>
          <SelectSeparator />
        </>
      )}
      {groups.map((models, index) => (
        <Fragment key={index}>
          {index > 0 && <SelectSeparator />}
          <SelectGroup>
            {models.map((model) => (
              <SelectItem
                key={model.value}
                value={model.value}
                data-testid={`agent-model-option-${model.value}`}
              >
                <span className="font-mono text-xs">{model.value}</span>
                {model.label !== model.value && (
                  <span className="text-xs text-muted-foreground">{model.label}</span>
                )}
              </SelectItem>
            ))}
          </SelectGroup>
        </Fragment>
      ))}
    </>
  )
}

/** The model picker: the models of the agent's provider, one of which it runs. */
function ModelSelect({
  draft,
  provider,
  state,
  onChange,
}: {
  draft: AgentDraft
  provider: Provider | undefined
  state: AgentState | undefined
  onChange: (model: string) => void
}) {
  const catalogs = useAppStore((app) => app.modelCatalogs)
  const groups = modelGroups(draft.harness, provider, state, catalogs)
  const models = groups.flat()
  const current = draft.model
  const known = provider?.own === null || state?.launchOptions != null
  const missing = current !== null && known && !models.some((model) => model.value === current)
  return (
    <Select
      value={current}
      onValueChange={(value) => {
        if (typeof value === 'string') onChange(value)
      }}
      disabled={models.length === 0 && !missing}
    >
      <SelectTrigger
        size="sm"
        aria-label="Model"
        className={cn(GHOST, missing && 'text-destructive')}
        data-testid="agent-panel-model"
      >
        {missing && <CircleAlertIcon className="size-3.5" />}
        {current !== null ? (
          <span className="truncate font-mono text-xs">{current}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
        <span className="flex-1" />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="start" className="w-auto min-w-64">
        <ModelItems groups={groups} missing={missing ? current : null} />
      </SelectContent>
    </Select>
  )
}

/**
 * The effort picker: the levels the agent's model takes, lowest first, the
 * one its sessions start at while it picks none marked Default. Picking that
 * one picks none, so that the level follows the model's when the model
 * changes. A level picked before its model stopped taking it stays listed,
 * dim.
 */
function EffortSelect({
  draft,
  provider,
  state,
  onChange,
}: {
  draft: AgentDraft
  provider: Provider | undefined
  state: AgentState | undefined
  onChange: (effort: string | null) => void
}) {
  const catalogs = useAppStore((app) => app.modelCatalogs)
  const levels = effortsOf(draft.harness, draft.model, provider, state, catalogs)
  const defaultLevel = defaultEffortOf(draft.harness, draft.model, provider, state, catalogs)
  const current = draft.effort ?? defaultLevel
  const stale = draft.effort !== null && !levels.includes(draft.effort) ? draft.effort : null
  return (
    <Select
      value={current}
      onValueChange={(value) => {
        if (typeof value === 'string') onChange(value === defaultLevel ? null : value)
      }}
      disabled={levels.length === 0 && stale === null}
    >
      <SelectTrigger
        size="sm"
        aria-label="Effort"
        className={GHOST}
        data-testid="agent-panel-effort"
      >
        {current !== null ? (
          <span
            className={cn('truncate font-mono text-xs', stale !== null && 'text-muted-foreground')}
          >
            {current}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
        <span className="flex-1" />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="start" className="w-auto min-w-44">
        <SelectGroup>
          {levels.map((level) => (
            <SelectItem key={level} value={level} data-testid={`agent-effort-option-${level}`}>
              <span className="font-mono text-xs">{level}</span>
              {level === defaultLevel && (
                <span className="ml-auto pl-6 text-xs text-muted-foreground">Default</span>
              )}
            </SelectItem>
          ))}
          {stale !== null && (
            <SelectItem value={stale}>
              <Tooltip>
                <TooltipTrigger
                  render={<span className="font-mono text-xs text-muted-foreground" />}
                >
                  {stale}
                </TooltipTrigger>
                <TooltipContent>Not listed for {draft.model ?? 'this model'}</TooltipContent>
              </Tooltip>
            </SelectItem>
          )}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

/** The choice of a role's picker that leaves the role to Claude Code. */
const CLAUDE_OWN = '\u0000claude-own'

/**
 * The model one of Claude Code's roles runs: the agent's own, or where the
 * agent leaves the roles it does not map to Claude Code, Claude Code's own,
 * which the picker names greyed out and offers first; unless another is
 * picked.
 */
function RoleSelect({
  role,
  groups,
  runs,
  leaves,
  value,
  onChange,
}: {
  role: ClaudeRole
  /** The models the agent's provider offers it, a group at a time. */
  groups: { value: string; label: string }[][]
  /** The model the agent runs, which the role follows while it has none of its own. */
  runs: string | null
  /** Whether the role is left to Claude Code while it has none of its own (see `leavesRoles`). */
  leaves: boolean
  value: string | undefined
  /** Given `null` where the role is left to Claude Code. */
  onChange: (model: string | null) => void
}) {
  const shown = value ?? (leaves ? null : runs)
  const missing = shown !== null && !groups.some((models) => models.some((m) => m.value === shown))
  return (
    <Select
      value={shown ?? (leaves ? CLAUDE_OWN : null)}
      onValueChange={(picked) => {
        if (typeof picked === 'string') onChange(picked === CLAUDE_OWN ? null : picked)
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label={`${CLAUDE_ROLE_NAMES[role]} model`}
        className={cn(GHOST, missing && 'text-destructive')}
        data-testid={`agent-panel-role-${role}`}
      >
        {missing && <CircleAlertIcon className="size-3.5" />}
        {shown === null && leaves ? (
          <span className="truncate font-mono text-xs text-muted-foreground">
            {CLAUDE_ROLE_DEFAULTS[role]}
          </span>
        ) : (
          <span className="truncate font-mono text-xs">{shown}</span>
        )}
        <span className="flex-1" />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="start" className="w-auto min-w-64">
        {leaves && (
          <>
            <SelectGroup>
              <SelectItem value={CLAUDE_OWN} data-testid={`agent-role-own-${role}`}>
                <span className="font-mono text-xs text-muted-foreground">
                  {CLAUDE_ROLE_DEFAULTS[role]}
                </span>
              </SelectItem>
            </SelectGroup>
            <SelectSeparator />
          </>
        )}
        <ModelItems groups={groups} missing={missing ? shown : null} />
      </SelectContent>
    </Select>
  )
}

/** The extra arguments of an agent as chips, removed with their ×, and a field that adds more. */
function ArgsField({ args, onChange }: { args: string[]; onChange: (args: string[]) => void }) {
  const [typed, setTyped] = useState('')
  const commit = () => {
    const parts = splitArguments(typed)
    if (parts.length === 0) return
    onChange([...args, ...parts])
    setTyped('')
  }
  return (
    <div className="flex min-h-8 min-w-0 flex-wrap items-center gap-1 rounded-lg border border-input px-1.5 py-1 has-[input:focus]:border-ring has-[input:focus]:ring-3 has-[input:focus]:ring-ring/50 dark:bg-input/30">
      {args.map((argument, index) => (
        <span
          // Extra arguments are positional: their texts may repeat.
          key={`${argument}-${index}`}
          className="inline-flex h-6 max-w-full items-center gap-1 rounded-md bg-muted pr-0.5 pl-1.5 font-mono text-xs"
        >
          <span className="truncate">{displayArgument(argument)}</span>
          <button
            type="button"
            aria-label={`Remove ${argument}`}
            className="flex size-4 items-center justify-center rounded-sm text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
            onClick={() => onChange(args.filter((_, at) => at !== index))}
          >
            <XIcon className="size-3" />
          </button>
        </span>
      ))}
      <input
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          } else if (event.key === 'Backspace' && typed === '' && args.length > 0) {
            onChange(args.slice(0, -1))
          }
        }}
        onBlur={commit}
        placeholder={args.length === 0 ? 'Add arguments…' : ''}
        spellCheck={false}
        aria-label="Add arguments"
        className="h-6 min-w-24 flex-1 bg-transparent px-1 font-mono text-xs outline-none placeholder:font-sans placeholder:text-muted-foreground"
        data-testid="agent-panel-args"
      />
    </div>
  )
}

/** The button that copies a command, and says for a moment that it did. */
function CopyCommandButton({ command }: { command: string }) {
  const [copied, markCopied] = useCopied()
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            aria-label="Copy command"
            onClick={() => {
              api.writeClipboardText(command)
              markCopied()
            }}
            data-testid="agent-panel-copy"
          />
        }
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </TooltipTrigger>
      <TooltipContent>{copied ? 'Copied' : 'Copy command'}</TooltipContent>
    </Tooltip>
  )
}

/** The command an agent's new sessions run, in small type, with a button that copies it. */
function CommandLine({
  draft,
  provider,
  state,
}: {
  draft: AgentDraft
  provider: Provider | undefined
  state: AgentState | undefined
}) {
  const yoloMode = useAppStore((app) => app.launchSettings?.yoloMode ?? true)
  const catalogs = useAppStore((app) => app.modelCatalogs)
  const segments = commandSegments({
    tool: draft.harness,
    program: getCodingTool(draft.harness).command,
    yoloMode,
    settings: {
      enabled: draft.enabled,
      model: draft.model,
      effort: draft.effort,
      extraArgs: draft.extraArgs,
    },
    modelEfforts:
      draft.model === null ? [] : effortsOf(draft.harness, draft.model, provider, state, catalogs),
    defaultEfforts: effortsOf(draft.harness, null, provider, state, catalogs),
  })
  const command = displayCommand(segments)
  const args = segments.flatMap((segment) => segment.args.map(displayArgument))
  return (
    <div className="flex min-w-0 items-start gap-1 rounded-lg bg-muted/60 py-1.5 pr-1 pl-2.5">
      <code
        className="min-w-0 flex-1 py-0.5 font-mono text-xs text-muted-foreground select-text"
        data-testid="agent-panel-command"
      >
        {args.map((argument, index) => (
          // Positional: the same argument may come twice.
          <Fragment key={index}>
            {index > 0 && ' '}
            {/* A line breaks between arguments, and within one only where it is wider than a line. */}
            <span className="inline-block max-w-full break-all">{argument}</span>
          </Fragment>
        ))}
      </code>
      <CopyCommandButton command={command} />
    </div>
  )
}

/** A property of the panel: its name, and the picker that sets it. */
function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-1">
      <span className="pl-2 text-sm text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** A group of the panel, under a small heading. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="px-2 pb-1 text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

/**
 * The fields of the panel: the provider, model and effort level, the models
 * of Claude Code's roles, the arguments, and the command they make, which
 * `command` gives where it differs from what the fields show.
 */
function PanelFields({
  draft,
  command,
  state,
  onChange,
}: {
  draft: AgentDraft
  command: AgentDraft
  state: AgentState | undefined
  onChange: (draft: AgentDraft) => void
}) {
  const catalogs = useAppStore((app) => app.modelCatalogs)
  const provider = useAgentProvider(draft)
  const leaves = leavesRoles(draft.harness, provider, draft.model, catalogs)
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-0.5">
        <Property label="Provider">
          {provider?.own != null ? (
            <ProviderValue provider={provider} />
          ) : (
            <ProviderSelect
              harness={draft.harness}
              value={draft.providerId}
              onChange={(picked) =>
                onChange(draftOnProvider(draft, picked, state, catalogs, provider))
              }
            />
          )}
        </Property>
        <Property label="Model">
          <ModelSelect
            draft={draft}
            provider={provider}
            state={state}
            onChange={(model) => onChange(draftWithModel(draft, model, provider, state, catalogs))}
          />
        </Property>
        <Property label="Effort">
          <EffortSelect
            draft={draft}
            provider={provider}
            state={state}
            onChange={(effort) => onChange({ ...draft, effort })}
          />
        </Property>
      </div>
      {provider !== undefined && mapsRoles(draft.harness, provider) && (
        <Section title="Model mapping">
          {CLAUDE_ROLES.map((role) => (
            <Property key={role} label={CLAUDE_ROLE_NAMES[role]}>
              <RoleSelect
                role={role}
                groups={modelGroups(draft.harness, provider, state, catalogs)}
                runs={draft.model}
                leaves={leaves}
                value={draft.modelMap[role]}
                onChange={(model) =>
                  onChange({
                    ...draft,
                    modelMap: withRole(draft.modelMap, role, model, draft.model, leaves),
                  })
                }
              />
            </Property>
          ))}
        </Section>
      )}
      <Section title="Arguments">
        <div className="px-2">
          <ArgsField
            args={draft.extraArgs}
            onChange={(extraArgs) => onChange({ ...draft, extraArgs })}
          />
        </div>
      </Section>
      <Section title="Command">
        <div className="px-2">
          <CommandLine draft={command} provider={provider} state={state} />
        </div>
      </Section>
    </div>
  )
}

/** The switch that turns an agent on and off, which shows it in the new session menus. */
export function AgentSwitch({ agent }: { agent: Agent }) {
  const changeAgent = useAppStore((app) => app.changeAgent)
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        <Switch
          checked={agent.enabled}
          onCheckedChange={(checked) => changeAgent(agent.id, { enabled: checked })}
          aria-label="Use this agent"
          data-testid={`agent-enabled-${agent.id}`}
        />
      </TooltipTrigger>
      <TooltipContent>
        {agent.enabled ? 'Shown in the new session menu' : 'Hidden from the new session menu'}
      </TooltipContent>
    </Tooltip>
  )
}

/** An agent in the panel: each change is saved as it is made. */
function EditPanel({
  agent,
  state,
  onClose,
}: {
  agent: Agent
  state: AgentState | undefined
  onClose: () => void
}) {
  const changeAgent = useAppStore((app) => app.changeAgent)
  const deleteAgent = useAppStore((app) => app.deleteAgent)
  const catalogs = useAppStore((app) => app.modelCatalogs)
  const deletable = useAppStore((app) => canDeleteAgent(agent, app.providers?.agents ?? []))
  const provider = useAgentProvider(agent)
  const saved = draftOf(agent)
  // One made without a model shows the model it runs, and names none until
  // a change to its model or provider.
  const shown = shownDraft(saved, provider, state, catalogs)
  const { own } = useDraftName(saved, agent.id)
  // The name being typed; `null` while it is not changed.
  const [typed, setTyped] = useState<string | null>(null)
  const commitName = () => {
    if (typed === null) return
    setTyped(null)
    const name = typedName(typed, own)
    if (name !== agent.name) changeAgent(agent.id, { name })
  }
  // A name still being typed as the panel closes is kept too.
  const latest = useRef<{ commit: () => void } | null>(null)
  useEffect(() => {
    latest.current = { commit: commitName }
  })
  useEffect(() => () => latest.current?.commit(), [])
  return (
    <div className="flex h-full flex-col" data-testid={`agent-panel-${agent.id}`}>
      <div className="flex items-center gap-3 border-b px-5 pt-5 pb-4">
        <AgentIcon
          toolId={agent.harness}
          providerId={agent.providerId}
          className="size-5 shrink-0"
        />
        <SheetTitle render={<div className="flex min-w-0 flex-1" />}>
          <TitleName
            value={typed ?? agent.name ?? ''}
            own={own}
            onChange={setTyped}
            onCommit={commitName}
            onRevert={typed === null ? null : () => setTyped(null)}
          />
        </SheetTitle>
        <AgentSwitch agent={agent} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <PanelFields
          draft={shown}
          command={saved}
          state={state}
          onChange={(next) => {
            const change = draftChange(shown, next)
            if (Object.keys(change).length > 0) changeAgent(agent.id, change)
          }}
        />
      </div>
      {deletable && (
        <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => {
              latest.current = null
              deleteAgent(agent.id)
              onClose()
            }}
            data-testid="agent-panel-delete"
          >
            <Trash2Icon />
            Delete
          </Button>
        </div>
      )}
    </div>
  )
}

/** A new agent of a harness: on the first of the user's providers it can run, while there is one. */
function newDraft(harness: CodingToolId, providers: Provider[]): AgentDraft {
  return {
    harness,
    providerId: providers[0]?.id ?? '',
    name: null,
    enabled: true,
    model: null,
    effort: null,
    extraArgs: [],
    modelMap: {},
  }
}

/** A new agent in the panel, made with Create. */
function NewPanel({
  harness,
  state,
  onMade,
  onClose,
}: {
  harness: CodingToolId
  state: AgentState | undefined
  onMade: (agent: Agent) => void
  onClose: () => void
}) {
  const makeAgent = useAppStore((app) => app.makeAgent)
  const catalogs = useAppStore((app) => app.modelCatalogs)
  const providers = useProvidersFor(harness)
  const [draft, setDraft] = useState(() => newDraft(harness, providers))
  const provider = useAgentProvider(draft)
  // On the model its provider starts with until another is picked, once
  // its harness's detection says which that is.
  const shown = shownDraft(draft, provider, state, catalogs)
  const [nameText, setNameText] = useState('')
  const { own } = useDraftName(shown, null)
  const [busy, setBusy] = useState(false)
  const offersModels = modelChoices(harness, provider, state, catalogs).length > 0
  const ready = provider !== undefined && (shown.model !== null || !offersModels) && !busy
  const make = async () => {
    if (!ready) return
    setBusy(true)
    const result = await makeAgent({
      harness,
      providerId: shown.providerId,
      model: shown.model,
      name: typedName(nameText, own),
      effort: shown.effort,
      extraArgs: shown.extraArgs,
      modelMap: shown.modelMap,
    })
    setBusy(false)
    if (result.ok) onMade(result.agent)
    else toast.error('Could not make the agent.', { description: result.message })
  }
  return (
    <div className="flex h-full flex-col" data-testid={`new-agent-panel-${harness}`}>
      <div className="flex items-center gap-3 border-b px-5 pt-5 pb-4">
        <AgentIcon toolId={harness} providerId={provider?.id ?? null} className="size-5 shrink-0" />
        <SheetTitle render={<div className="flex min-w-0 flex-1" />}>
          <TitleName
            value={nameText}
            own={(provider === undefined ? '' : own) || `New ${getCodingTool(harness).label} agent`}
            onChange={setNameText}
            autoFocus
          />
        </SheetTitle>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <PanelFields draft={shown} command={shown} state={state} onChange={setDraft} />
      </div>
      <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={!ready}
          onClick={() => void make()}
          data-testid={`new-agent-create-${harness}`}
        >
          Create
        </Button>
      </div>
    </div>
  )
}

/** What the panel shows: an agent of the harness, by its id, or a new one (`id` `null`). */
export type PanelTarget = { id: string | null } | null

/**
 * The panel at the window's right that edits an agent of a harness, each
 * change saved as it is made, or makes one with Create; it closes with Esc
 * or a click beside it.
 */
export function AgentPanel({
  harness,
  state,
  target,
  onTargetChange,
}: {
  harness: CodingToolId
  state: AgentState | undefined
  target: PanelTarget
  onTargetChange: (target: PanelTarget) => void
}) {
  // What it showed last, which it keeps showing as it closes.
  const [last, setLast] = useState(target)
  if (target !== null && target !== last) setLast(target)
  const shown = target ?? last
  const agent = useAppStore((app) =>
    shown?.id == null
      ? undefined
      : app.providers?.agents.find((candidate) => candidate.id === shown.id),
  )
  const close = () => onTargetChange(null)
  return (
    <Sheet open={target !== null} onOpenChange={(open) => !open && close()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        initialFocus={shown?.id === null}
        className={cn(SIDE_PANEL, 'w-[26rem] sm:max-w-md')}
        data-testid="agent-panel"
      >
        {shown !== null &&
          (shown.id === null ? (
            <NewPanel
              harness={harness}
              state={state}
              onMade={(made) => onTargetChange({ id: made.id })}
              onClose={close}
            />
          ) : agent !== undefined ? (
            <EditPanel key={agent.id} agent={agent} state={state} onClose={close} />
          ) : null)}
      </SheetContent>
    </Sheet>
  )
}

import {
  CheckIcon,
  CircleAlertIcon,
  CopyIcon,
  LockIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react'
import { cn } from 'cn'
import { useEffect, useState } from 'react'
import type { AgentState } from '../../../shared/agents'
import { chatAgent, usableChatAgents } from '../../../shared/chats'
import {
  commandSegments,
  displayArgument,
  displayCommand,
  splitArguments,
  type CommandSegment,
} from '../../../shared/launch-command'
import {
  agentName,
  canRun,
  ownProvider,
  PROVIDER_EFFORTS,
  providerMark,
  type Agent,
  type AgentChange,
  type Provider,
} from '../../../shared/providers'
import { getCodingTool, type CodingToolId } from '../../../shared/tools'
import { api } from '../../lib/api'
import { useAppStore } from '../../store/app-store'
import { AgentIcon, ProviderMarkIcon } from '../provider-icon'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import { Switch } from '../ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

/** A chip of the command editor. */
const CHIP = 'inline-flex h-6 max-w-full items-center gap-1 rounded-md px-1.5 font-mono text-xs'

/** A chip that is a picker: filled once something is picked, dashed while it is not. */
const PICKER_CHIP =
  'h-6 gap-1 rounded-md py-0 pr-1 pl-1.5 font-mono text-xs data-[size=sm]:h-6 dark:bg-transparent'
const PICKED =
  'border-transparent bg-chart-1/10 text-chart-1 hover:bg-chart-1/15 dark:bg-chart-1/15'
const NOT_PICKED = 'border-dashed text-muted-foreground'
/** A picked model that its provider no longer offers. */
const PICKED_MISSING =
  'border-transparent bg-destructive/10 text-destructive hover:bg-destructive/15 dark:bg-destructive/15'

/** The choice of a picker that leaves it to the harness's own configuration, or its provider. */
const DEFAULT_CHOICE = '\u0000default'

/** The choice of a provider picker that goes to the Providers page to add one. */
const ADD_PROVIDER = '\u0000add-provider'

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

/** The providers an agent of a harness can run on: its own models first, then the user's it can run. */
function useProvidersFor(harness: CodingToolId): Provider[] {
  const providers = useAppStore((state) => state.providers?.providers)
  return [ownProvider(harness), ...(providers ?? []).filter((p) => canRun(p, harness))]
}

/** A model an agent can pick, and the effort levels it takes. */
interface ModelChoice {
  value: string
  label: string
  efforts: string[]
}

/**
 * The models an agent on a provider can pick: on its harness's own models,
 * those its configuration offers, as the harness's detection read them; on a
 * provider of the user's, that provider's.
 */
function modelChoices(
  provider: Provider | undefined,
  state: AgentState | undefined,
): ModelChoice[] {
  if (provider === undefined) return []
  if (provider.own !== null) return state?.launchOptions?.models ?? []
  return provider.models.map((model) => ({ value: model, label: model, efforts: [] }))
}

/** The effort levels of a model, or of the default model, on a provider. */
function effortsOf(
  model: string | null,
  provider: Provider | undefined,
  state: AgentState | undefined,
): string[] {
  if (provider?.own === null) return state === undefined ? [] : [...PROVIDER_EFFORTS[state.id]]
  const options = state?.launchOptions
  if (model === null) return options?.defaultEfforts ?? []
  return options?.models.find((option) => option.value === model)?.efforts ?? []
}

/**
 * What Default picks on a provider: on the harness's own models, what its
 * configuration names, if anything; on a provider of the user's, its first
 * model, which Hoot maps the harness's tiers to.
 */
function defaultModelOf(
  provider: Provider | undefined,
  state: AgentState | undefined,
): { value: string; source: string } | null {
  if (provider === undefined) return null
  if (provider.own !== null) return state?.launchOptions?.defaultModel ?? null
  const first = provider.models[0]
  return first === undefined ? null : { value: first, source: provider.name }
}

/** The model an agent takes on another provider: its own while that provider has it, else its first. */
function modelOn(model: string | null, provider: Provider | undefined): string | null {
  if (provider === undefined || provider.own !== null) return null
  if (model !== null && provider.models.includes(model)) return model
  return provider.models[0] ?? null
}

/** Whether a segment's setting is picked: its arguments are in the command, or it says so. */
function isPicked(segment: CommandSegment): boolean {
  return segment.args.length > 0 || segment.picked === true
}

/** What a picker shows: what it puts in the command, or what it would pick. */
function PickerText({ segment, placeholder }: { segment: CommandSegment; placeholder: string }) {
  if (isPicked(segment)) return <span className="truncate">{segment.text}</span>
  return (
    <span className="flex items-center gap-1">
      <PlusIcon className="size-3" />
      {placeholder}
    </span>
  )
}

/** The providers a provider picker lists, each with its mark, and Add provider… last. */
function ProviderItems({ providers }: { providers: Provider[] }) {
  return (
    <>
      <SelectGroup>
        {providers.map((provider) => (
          <SelectItem
            key={provider.id}
            value={provider.id}
            data-testid={`agent-provider-option-${provider.id}`}
          >
            <span className="flex items-center gap-2 font-sans">
              <ProviderMarkIcon mark={providerMark(provider)} className="size-4" />
              {provider.name}
            </span>
          </SelectItem>
        ))}
      </SelectGroup>
      <SelectSeparator />
      <SelectItem value={ADD_PROVIDER} data-testid="agent-provider-add">
        <span className="flex items-center gap-2 font-sans text-muted-foreground">
          <PlusIcon className="size-4" />
          Add provider…
        </span>
      </SelectItem>
    </>
  )
}

/** The provider chip of an agent, or of one being made, which picks another provider. */
function ProviderPicker({
  harness,
  value,
  onChange,
  testId,
  className,
}: {
  harness: CodingToolId
  value: string
  onChange: (provider: Provider) => void
  testId: string
  className?: string
}) {
  const providers = useProvidersFor(harness)
  const startAddingProvider = useAppStore((state) => state.startAddingProvider)
  const provider = providers.find((candidate) => candidate.id === value)
  return (
    <Select
      value={value}
      onValueChange={(id) => {
        if (typeof id !== 'string') return
        if (id === ADD_PROVIDER) return startAddingProvider()
        const picked = providers.find((candidate) => candidate.id === id)
        if (picked !== undefined) onChange(picked)
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label="Provider"
        className={cn(PICKER_CHIP, 'font-sans', provider ? PICKED : NOT_PICKED, className)}
        data-testid={testId}
      >
        {provider ? (
          <>
            <ProviderMarkIcon mark={providerMark(provider)} className="size-3.5" />
            <span className="truncate">{provider.name}</span>
          </>
        ) : (
          <span className="flex items-center gap-1">
            <PlusIcon className="size-3" />
            provider
          </span>
        )}
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="start" className="w-auto min-w-52">
        <ProviderItems providers={providers} />
      </SelectContent>
    </Select>
  )
}

/** The Default choice of a picker, with what it picks, where that is known. */
function DefaultChoice({
  harness,
  configured,
}: {
  harness: CodingToolId
  configured: { value: string; source: string } | null
}) {
  return (
    <SelectItem value={DEFAULT_CHOICE}>
      <span>{configured === null ? 'Default' : `Default · ${configured.value}`}</span>
      <span className="text-muted-foreground">
        {configured === null ? `${getCodingTool(harness).label}'s own setting` : configured.source}
      </span>
    </SelectItem>
  )
}

/** The model chip, which picks one of the provider's models, or Default. */
function ModelPicker({
  agent,
  provider,
  state,
  segment,
  onChange,
}: {
  agent: Agent
  provider: Provider | undefined
  state: AgentState | undefined
  segment: CommandSegment
  onChange: (change: AgentChange) => void
}) {
  const models = modelChoices(provider, state)
  const current = agent.model
  const known = provider?.own === null || state?.launchOptions != null
  const missing = current !== null && known && !models.some((m) => m.value === current)
  const pick = (value: string) => {
    const model = value === DEFAULT_CHOICE ? null : value
    // An effort level the new model does not take goes back to Default.
    const efforts = effortsOf(model, provider, state)
    const effort = agent.effort !== null && efforts.includes(agent.effort) ? agent.effort : null
    onChange({ model, effort })
  }
  return (
    <Select
      value={current ?? DEFAULT_CHOICE}
      onValueChange={(value) => {
        if (typeof value === 'string') pick(value)
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label="Model"
        className={cn(
          PICKER_CHIP,
          current === null ? NOT_PICKED : missing ? PICKED_MISSING : PICKED,
        )}
        data-testid={`agent-model-${agent.id}`}
      >
        {missing && <CircleAlertIcon className="size-3" />}
        <PickerText segment={segment} placeholder="model" />
      </SelectTrigger>
      {/* As wide as its longest choice, so that the check never covers one. */}
      <SelectContent alignItemWithTrigger={false} align="start" className="w-auto min-w-64">
        <SelectGroup>
          <DefaultChoice harness={agent.harness} configured={defaultModelOf(provider, state)} />
        </SelectGroup>
        {missing && (
          <SelectGroup>
            <SelectLabel>Not offered any more</SelectLabel>
            <SelectItem value={current}>
              <span className="font-mono text-xs">{current}</span>
            </SelectItem>
          </SelectGroup>
        )}
        {models.length > 0 && (
          <SelectGroup>
            <SelectLabel>
              {provider?.own === null ? provider.name : 'From your configuration'}
            </SelectLabel>
            {models.map((model) => (
              <SelectItem
                key={model.value}
                value={model.value}
                data-testid={`agent-model-${agent.id}-option-${model.value}`}
              >
                <span className="font-mono text-xs">{model.value}</span>
                {model.label !== model.value && (
                  <span className="text-xs text-muted-foreground">{model.label}</span>
                )}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  )
}

/** The effort chip, which picks one of the levels the selected model takes. */
function EffortPicker({
  agent,
  provider,
  state,
  segment,
  onChange,
}: {
  agent: Agent
  provider: Provider | undefined
  state: AgentState | undefined
  segment: CommandSegment
  onChange: (change: AgentChange) => void
}) {
  const efforts = effortsOf(agent.model, provider, state)
  return (
    <Select
      value={agent.effort ?? DEFAULT_CHOICE}
      onValueChange={(value) => {
        if (typeof value === 'string') onChange({ effort: value === DEFAULT_CHOICE ? null : value })
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label="Effort"
        className={cn(PICKER_CHIP, agent.effort === null ? NOT_PICKED : PICKED)}
        data-testid={`agent-effort-${agent.id}`}
      >
        <PickerText segment={segment} placeholder="effort" />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="start" className="w-auto min-w-48">
        <DefaultChoice
          harness={agent.harness}
          configured={provider?.own === null ? null : (state?.launchOptions?.defaultEffort ?? null)}
        />
        {efforts.map((effort) => (
          <SelectItem key={effort} value={effort}>
            <span className="font-mono text-xs">{effort}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** The button that copies a command, and says for a moment that it did. */
function CopyCommandButton({ command, testId }: { command: string; testId: string }) {
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
            data-testid={testId}
          />
        }
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </TooltipTrigger>
      <TooltipContent>{copied ? 'Copied' : 'Copy command'}</TooltipContent>
    </Tooltip>
  )
}

/**
 * The command an agent's new sessions run, as chips: the program, the
 * permission flag that YOLO mode adds, the model and effort, which open their
 * pickers, and the extra arguments, typed at the end and removed with their ×.
 */
function AgentCommand({ agent, state }: { agent: Agent; state: AgentState | undefined }) {
  const changeAgent = useAppStore((app) => app.changeAgent)
  const yoloMode = useAppStore((app) => app.launchSettings?.yoloMode ?? true)
  const providers = useProvidersFor(agent.harness)
  const provider = providers.find((candidate) => candidate.id === agent.providerId)
  const [draft, setDraft] = useState('')
  const tool = getCodingTool(agent.harness)
  const settings = {
    enabled: agent.enabled,
    model: agent.model,
    effort: agent.effort,
    extraArgs: agent.extraArgs,
  }
  const segments = commandSegments({
    tool: agent.harness,
    program: tool.command,
    yoloMode,
    settings,
    modelEfforts: agent.model === null ? [] : effortsOf(agent.model, provider, state),
    defaultEfforts: effortsOf(null, provider, state),
  })
  const command = displayCommand(segments)
  const change = (update: AgentChange) => changeAgent(agent.id, update)
  const commit = () => {
    const parts = splitArguments(draft)
    if (parts.length === 0) return
    change({ extraArgs: [...agent.extraArgs, ...parts] })
    setDraft('')
  }

  const program = segments.find((segment) => segment.kind === 'program')
  const permission = segments.find((segment) => segment.kind === 'permission')
  const model = segments.find((segment) => segment.kind === 'model')
  const effort = segments.find((segment) => segment.kind === 'effort')
  // A picked model or effort stands where its arguments are; one not picked
  // waits at the end, before the field that adds arguments.
  const modelPicker = model && (
    <ModelPicker
      agent={agent}
      provider={provider}
      state={state}
      segment={model}
      onChange={change}
    />
  )
  const effortPicker = effort && (
    <EffortPicker
      agent={agent}
      provider={provider}
      state={state}
      segment={effort}
      onChange={change}
    />
  )

  return (
    <div className="flex items-start gap-1">
      {/* Lit while its field has focus, not while a chip keeps it after its picker closed. */}
      <div
        className="flex min-w-0 flex-1 flex-wrap items-center gap-1 rounded-lg border border-input px-1.5 py-1 has-[input:focus]:border-ring has-[input:focus]:ring-3 has-[input:focus]:ring-ring/50 dark:bg-input/30"
        role="group"
        aria-label={`Command: ${command}`}
        data-command={command}
        data-testid={`agent-command-${agent.id}`}
      >
        {program && <span className={cn(CHIP, 'px-1 font-semibold')}>{program.text}</span>}
        {permission && (
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex max-w-full" />}>
              <span className={cn(CHIP, 'bg-chart-3/10 text-chart-3 dark:bg-chart-3/15')}>
                <LockIcon className="size-3 shrink-0" />
                <span className="truncate">{permission.text}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent>{permission.note}</TooltipContent>
          </Tooltip>
        )}
        {model && isPicked(model) && modelPicker}
        {effort && isPicked(effort) && effortPicker}
        {agent.extraArgs.map((argument, index) => (
          <span
            // Extra arguments are positional: their texts may repeat.
            key={`${argument}-${index}`}
            className={cn(CHIP, 'bg-muted pr-0.5 text-foreground')}
          >
            <span className="truncate">{displayArgument(argument)}</span>
            <button
              type="button"
              aria-label={`Remove ${argument}`}
              className="flex size-4 items-center justify-center rounded-sm text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
              onClick={() => change({ extraArgs: agent.extraArgs.filter((_, at) => at !== index) })}
            >
              <XIcon className="size-3" />
            </button>
          </span>
        ))}
        {model && !isPicked(model) && modelPicker}
        {effort && !isPicked(effort) && effortPicker}
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            } else if (event.key === 'Backspace' && draft === '' && agent.extraArgs.length > 0) {
              change({ extraArgs: agent.extraArgs.slice(0, -1) })
            }
          }}
          onBlur={commit}
          placeholder="Add arguments…"
          spellCheck={false}
          aria-label="Add arguments"
          className="h-6 min-w-28 flex-1 bg-transparent px-1 font-mono text-xs outline-none placeholder:text-muted-foreground"
          data-testid={`agent-extra-input-${agent.id}`}
        />
      </div>
      <span className="pt-1">
        <CopyCommandButton command={command} testId={`agent-copy-${agent.id}`} />
      </span>
    </div>
  )
}

/** An agent's name, which a double click or Rename turns into a field; empty gives back its own. */
function AgentName({
  agent,
  editing,
  onEditingChange,
}: {
  agent: Agent
  editing: boolean
  onEditingChange: (editing: boolean) => void
}) {
  const providers = useAppStore((state) => state.providers)
  const name = providers === null ? '' : agentName(agent, providers)
  const own = providers === null ? '' : agentName({ ...agent, name: null }, providers)
  if (editing) {
    return <AgentNameField agent={agent} own={own} onDone={() => onEditingChange(false)} />
  }
  return (
    <span
      className={cn('truncate text-sm font-medium', !agent.enabled && 'text-muted-foreground')}
      onDoubleClick={() => onEditingChange(true)}
      data-testid={`agent-item-name-${agent.id}`}
    >
      {name}
    </span>
  )
}

/** The field that renames an agent, from its name as it is, the one of its own as its placeholder. */
function AgentNameField({ agent, own, onDone }: { agent: Agent; own: string; onDone: () => void }) {
  const changeAgent = useAppStore((state) => state.changeAgent)
  const [draft, setDraft] = useState(agent.name ?? '')
  const done = () => {
    const typed = draft.trim()
    changeAgent(agent.id, { name: typed === '' || typed === own ? null : typed })
    onDone()
  }
  return (
    <input
      autoFocus
      value={draft}
      placeholder={own}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={done}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Enter') done()
        if (event.key === 'Escape') {
          event.stopPropagation()
          onDone()
        }
      }}
      aria-label="Name"
      className="-my-1 -ml-1.5 h-7 min-w-0 flex-1 rounded-md border border-input bg-transparent px-1.5 text-sm font-medium outline-none focus:border-ring focus:ring-3 focus:ring-ring/50"
      data-testid={`agent-name-input-${agent.id}`}
    />
  )
}

/** The ⋯ of an agent's row: rename it, make it the default agent, delete it. */
function AgentMenu({
  agent,
  isDefault,
  onRename,
}: {
  agent: Agent
  isDefault: boolean
  onRename: () => void
}) {
  const deleteAgent = useAppStore((state) => state.deleteAgent)
  const setDefaultAgent = useAppStore((state) => state.setDefaultAgent)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            aria-label="More"
            data-testid={`agent-menu-${agent.id}`}
          />
        }
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-44">
        <DropdownMenuItem onClick={onRename}>
          <PencilIcon />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={isDefault || !agent.enabled}
          onClick={() => setDefaultAgent(agent.id)}
        >
          <CheckIcon />
          Make default
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => deleteAgent(agent.id)}
          data-testid={`agent-delete-${agent.id}`}
        >
          <Trash2Icon />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Whether an agent is the one a new chat starts with, which its row marks Default. */
function useIsDefault(agentId: string): boolean {
  return useAppStore(
    (state) => chatAgent(state.tools, state.providers, state.launchSettings)?.id === agentId,
  )
}

/**
 * An agent's row, below its harness's: its icon and name, Default, its ⋯ and
 * switch, and while it is on, its provider before the ⋯ and its command below.
 * One of a harness that is not installed shows only its name and ⋯.
 */
export function AgentItem({
  agent,
  state,
  dormant = false,
}: {
  agent: Agent
  /** Its harness's installation and the models its configuration offers. */
  state: AgentState | undefined
  dormant?: boolean
}) {
  const changeAgent = useAppStore((app) => app.changeAgent)
  const isDefault = useIsDefault(agent.id)
  const [renaming, setRenaming] = useState(false)
  if (dormant) {
    return (
      <div
        className="flex min-h-7 items-center gap-3 py-2 pr-4 pl-4 sm:pl-12"
        data-testid={`agent-item-${agent.id}`}
        data-dormant=""
      >
        <AgentIcon
          toolId={agent.harness}
          providerId={agent.providerId}
          className="size-4 opacity-50"
        />
        <span className="flex min-w-0 flex-1 items-center gap-2 text-muted-foreground">
          <AgentName agent={agent} editing={renaming} onEditingChange={setRenaming} />
        </span>
        <AgentMenu agent={agent} isDefault={false} onRename={() => setRenaming(true)} />
      </div>
    )
  }
  return (
    <div
      className="flex flex-col gap-2.5 py-3 pr-4 pl-4 sm:pl-12"
      data-testid={`agent-item-${agent.id}`}
      data-enabled={agent.enabled}
    >
      <div className="flex min-h-7 items-center gap-3">
        <AgentIcon
          toolId={agent.harness}
          providerId={agent.providerId}
          className={cn('size-4', !agent.enabled && 'opacity-50')}
        />
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <AgentName agent={agent} editing={renaming} onEditingChange={setRenaming} />
          {isDefault && !renaming && (
            <Badge variant="secondary" data-testid={`agent-default-${agent.id}`}>
              Default
            </Badge>
          )}
          {!agent.enabled && !renaming && (
            <span className="text-xs text-muted-foreground">Off</span>
          )}
        </span>
        {agent.enabled && (
          <ProviderPicker
            harness={agent.harness}
            value={agent.providerId}
            onChange={(picked) =>
              changeAgent(agent.id, {
                providerId: picked.id,
                model: modelOn(agent.model, picked),
                effort: null,
              })
            }
            testId={`agent-provider-${agent.id}`}
            // A long provider name gives way to the agent's own.
            className="max-w-[40%]"
          />
        )}
        <AgentMenu agent={agent} isDefault={isDefault} onRename={() => setRenaming(true)} />
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
      </div>
      {agent.enabled && (
        <div className="min-w-0 sm:pl-7">
          <AgentCommand agent={agent} state={state} />
        </div>
      )}
    </div>
  )
}

/** The provider a new agent starts with: one of the user's before the harness's own models. */
function firstProvider(providers: Provider[]): Provider | undefined {
  return providers.find((provider) => provider.own === null) ?? providers[0]
}

/** A row that makes an agent in place: its name, provider and model, and Create. */
function NewAgentRow({
  harness,
  state,
  onDone,
}: {
  harness: CodingToolId
  state: AgentState | undefined
  onDone: () => void
}) {
  const makeAgent = useAppStore((app) => app.makeAgent)
  const providersState = useAppStore((app) => app.providers)
  const providers = useProvidersFor(harness)
  const [providerId, setProviderId] = useState(() => firstProvider(providers)?.id ?? '')
  const provider = providers.find((candidate) => candidate.id === providerId)
  const [model, setModel] = useState<string | null>(() => modelOn(null, provider))
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const models = modelChoices(provider, state)
  // The name it gets without one of its own, as its field shows it.
  const draft: Agent = {
    id: '\u0000new',
    harness,
    providerId,
    name: null,
    enabled: true,
    model,
    effort: null,
    extraArgs: [],
    createdAt: 0,
  }
  const own =
    providersState === null || provider === undefined
      ? ''
      : agentName(draft, {
          providers: providersState.providers,
          agents: [...providersState.agents, draft],
        })
  const create = async () => {
    if (provider === undefined || creating) return
    setCreating(true)
    const typed = name.trim()
    const result = await makeAgent({
      harness,
      providerId,
      model,
      name: typed === '' || typed === own ? null : typed,
    })
    setCreating(false)
    if (result.ok) onDone()
  }
  return (
    <div
      className="flex flex-col gap-2.5 py-3 pr-4 pl-4 sm:pl-12"
      data-testid={`new-agent-row-${harness}`}
    >
      <div className="flex min-h-7 items-center gap-3">
        <AgentIcon toolId={harness} providerId={provider?.id ?? null} className="size-4" />
        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Enter') void create()
            if (event.key === 'Escape') {
              event.stopPropagation()
              onDone()
            }
          }}
          placeholder={own || 'Name'}
          aria-label="Name"
          className="-my-1 -ml-1.5 h-7 min-w-0 flex-1 rounded-md border border-input bg-transparent px-1.5 text-sm font-medium outline-none placeholder:font-normal focus:border-ring focus:ring-3 focus:ring-ring/50"
          data-testid={`new-agent-name-${harness}`}
        />
        <Button variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={provider === undefined || creating}
          onClick={() => void create()}
          data-testid={`new-agent-create-${harness}`}
        >
          Create
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1 sm:pl-7">
        <ProviderPicker
          harness={harness}
          value={providerId}
          onChange={(picked) => {
            setProviderId(picked.id)
            setModel(modelOn(model, picked))
          }}
          testId={`new-agent-provider-${harness}`}
        />
        <Select
          value={model ?? DEFAULT_CHOICE}
          onValueChange={(value) => {
            if (typeof value === 'string') setModel(value === DEFAULT_CHOICE ? null : value)
          }}
          disabled={provider === undefined}
        >
          <SelectTrigger
            size="sm"
            aria-label="Model"
            className={cn(PICKER_CHIP, model === null ? NOT_PICKED : PICKED)}
            data-testid={`new-agent-model-${harness}`}
          >
            {model === null ? (
              <span className="flex items-center gap-1">
                <PlusIcon className="size-3" />
                model
              </span>
            ) : (
              <span className="truncate">{model}</span>
            )}
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false} align="start" className="w-auto min-w-56">
            <DefaultChoice harness={harness} configured={defaultModelOf(provider, state)} />
            {models.map((choice) => (
              <SelectItem key={choice.value} value={choice.value}>
                <span className="font-mono text-xs">{choice.value}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

/**
 * A harness's agents, below its row: each with its command, and New agent,
 * which makes one there.
 */
export function HarnessAgents({
  harness,
  state,
}: {
  harness: CodingToolId
  state: AgentState | undefined
}) {
  const all = useAppStore((app) => app.providers?.agents)
  const agents = (all ?? []).filter((agent) => agent.harness === harness)
  const [making, setMaking] = useState(false)
  return (
    <div className="-mt-1 flex flex-col pb-1" data-testid={`harness-agents-${harness}`}>
      {agents.map((agent) => (
        <AgentItem key={agent.id} agent={agent} state={state} />
      ))}
      {making ? (
        <NewAgentRow harness={harness} state={state} onDone={() => setMaking(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setMaking(true)}
          className="flex h-10 items-center gap-3 pr-4 pl-4 text-left text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground sm:pl-12"
          data-testid={`new-agent-${harness}`}
        >
          <PlusIcon className="size-4" />
          New agent
        </button>
      )}
    </div>
  )
}

/** The picker of the default agent: the usable agents, the one new chats start with picked. */
export function DefaultAgentPicker() {
  const tools = useAppStore((state) => state.tools)
  const providers = useAppStore((state) => state.providers)
  const launchSettings = useAppStore((state) => state.launchSettings)
  const setDefaultAgent = useAppStore((state) => state.setDefaultAgent)
  const usable = usableChatAgents(tools, providers)
  const current = chatAgent(tools, providers, launchSettings)
  const choices = usable.map((agent) => ({
    value: agent.id,
    label: (
      <span className="flex items-center gap-2">
        <AgentIcon toolId={agent.harness} providerId={agent.providerId} className="size-4" />
        {providers === null ? '' : agentName(agent, providers)}
      </span>
    ),
  }))
  return (
    <Select
      items={choices}
      value={current?.id ?? null}
      onValueChange={(id) => {
        if (typeof id === 'string') setDefaultAgent(id)
      }}
      disabled={choices.length === 0}
    >
      <SelectTrigger
        className="min-w-40"
        aria-labelledby="default-agent-label"
        data-testid="default-agent"
      >
        <SelectValue placeholder="None" />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="end">
        {choices.map((choice) => (
          <SelectItem
            key={choice.value}
            value={choice.value}
            data-testid={`default-agent-option-${choice.value}`}
          >
            {choice.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

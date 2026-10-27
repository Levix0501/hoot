import {
  ArrowDownToLineIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CopyIcon,
  LockIcon,
  PlusIcon,
  RefreshCwIcon,
  XIcon,
} from 'lucide-react'
import { cn } from 'cn'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  FOLDER_NOT_WRITABLE_MESSAGE,
  INSTALL_NEEDS_NODE_MESSAGE,
  INSTALL_NEEDS_WRITE_ACCESS_MESSAGE,
  installMethodLabel,
  installNeedsNodeVersionMessage,
  nodeRequirementMessage,
  type AgentState,
  type InstallTarget,
} from '../../../shared/agents'
import {
  commandSegments,
  displayArgument,
  displayCommand,
  splitArguments,
  type CommandSegment,
} from '../../../shared/launch-command'
import type {
  AgentLaunchSettings,
  AgentLaunchSettingsChange,
} from '../../../shared/launch-settings'
import { CODING_TOOLS, type CodingToolDefinition, type CodingToolId } from '../../../shared/tools'
import { api } from '../../lib/api'
import { agentRowStatus, updateAllIncludes, type AgentRowStatus } from '../../lib/agent-status'
import { useAppStore } from '../../store/app-store'
import { ToolIcon } from '../tool-icon'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import { Spinner } from '../ui/spinner'
import { Switch } from '../ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

/** An agent before Hoot has looked for it. */
function unknownAgent(id: CodingToolDefinition['id']): AgentState {
  return {
    id,
    checking: true,
    detected: false,
    installation: null,
    latest: null,
    latestFailed: false,
    installCommand: null,
    nodeRequirement: null,
    operation: null,
    launchOptions: null,
  }
}

/** Where a path is cut when it does not fit: before its last two segments, or its last. */
function splitForTruncation(text: string): [head: string, tail: string] {
  const slashes = [...text.matchAll(/[\\/]/g)].map((match) => match.index)
  const cut = slashes.length >= 3 ? slashes.at(-2) : slashes.at(-1)
  if (cut === undefined || cut <= 0) return ['', text]
  return [text.slice(0, cut), text.slice(cut)]
}

/**
 * A path, with `~` for the home folder. When it does not fit, it is cut in
 * its middle, keeping its end; pointing at it shows it in full.
 */
function PathText({ shown, full, testId }: { shown: string; full: string; testId: string }) {
  const [head, tail] = splitForTruncation(shown)
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex max-w-full min-w-0 align-bottom" data-testid={testId} />
        }
      >
        <span className="truncate">{head}</span>
        <span className="shrink-0 whitespace-pre">{tail}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[min(36rem,90vw)] break-all">
        {full}
      </TooltipContent>
    </Tooltip>
  )
}

/** Parts of a line, with a middle dot between each two. */
function joined(parts: ReactNode[]): ReactNode[] {
  return parts.flatMap((part, index) => (index === 0 ? [part] : [' · ', part]))
}

/** Where a not-installed agent goes, or why it cannot be installed; `null` before detection. */
function notInstalledDescription(
  agent: AgentState,
  target: InstallTarget | null,
): ReactNode[] | null {
  const id = agent.id
  if (!agent.detected) return null
  if (agent.installation !== null) return null
  if (agent.nodeRequirement && target?.kind === 'npm') {
    return [installNeedsNodeVersionMessage(agent.nodeRequirement)]
  }
  switch (target?.kind) {
    case 'npm':
      return [
        'Install uses npm, into ',
        <PathText
          key="path"
          shown={target.displayPrefix}
          full={target.prefix}
          testId={`agent-install-target-${id}`}
        />,
      ]
    case 'npm-not-writable':
      return [
        "Install needs write access to npm's global folder, ",
        <PathText
          key="path"
          shown={target.displayPrefix}
          full={target.prefix}
          testId={`agent-install-target-${id}`}
        />,
      ]
    case 'node-required':
      return [INSTALL_NEEDS_NODE_MESSAGE]
    default:
      return null
  }
}

/** A chevron that points down while what it opens is open. */
function Chevron({ open, className }: { open: boolean; className?: string }) {
  return (
    <ChevronRightIcon
      className={cn(
        'size-4 shrink-0 text-muted-foreground transition-transform duration-150',
        open && 'rotate-90',
        className,
      )}
    />
  )
}

/** The text on a row's right, where there is no button. */
function StatusText({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground" data-testid={testId}>
      {children}
    </span>
  )
}

/** A button that runs a command, which pointing at it shows. */
function RunsTooltip({ command, children }: { command: string | null; children: ReactNode }) {
  if (command === null) return children
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>{children}</TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[min(36rem,90vw)] font-mono break-all">
        Runs {command}
      </TooltipContent>
    </Tooltip>
  )
}

/** Whether something was copied a moment ago, and a way to say that it just was. */
function useCopied(): [copied: boolean, markCopied: () => void] {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1200)
    return () => window.clearTimeout(timer)
  }, [copied])
  return [copied, () => setCopied(true)]
}

/** A chip of the command editor. */
const CHIP = 'inline-flex h-6 max-w-full items-center gap-1 rounded-md px-1.5 font-mono text-xs'

/** A chip that is a picker: filled once something is picked, dashed while it is not. */
const PICKER_CHIP =
  'h-6 gap-1 rounded-md py-0 pr-1 pl-1.5 font-mono text-xs data-[size=sm]:h-6 dark:bg-transparent'
const PICKED =
  'border-transparent bg-chart-1/10 text-chart-1 hover:bg-chart-1/15 dark:bg-chart-1/15'
const NOT_PICKED = 'border-dashed text-muted-foreground'
/** A picked model that the agent's configuration no longer offers. */
const PICKED_MISSING =
  'border-transparent bg-destructive/10 text-destructive hover:bg-destructive/15 dark:bg-destructive/15'

/** The choice of a picker that leaves it to the agent's own configuration. */
const DEFAULT_CHOICE = '\u0000default'

/** What a picker shows: what it puts in the command, or what it would pick. */
function PickerText({ segment, placeholder }: { segment: CommandSegment; placeholder: string }) {
  if (segment.args.length > 0) return <span className="truncate">{segment.text}</span>
  return (
    <span className="flex items-center gap-1">
      <PlusIcon className="size-3" />
      {placeholder}
    </span>
  )
}

/** The Default choice of a picker, with what the agent's configuration sets, if it names it. */
function DefaultChoice({
  tool,
  configured,
}: {
  tool: CodingToolDefinition
  configured: { value: string; source: string } | null
}) {
  return (
    <SelectItem value={DEFAULT_CHOICE}>
      <span>{configured === null ? 'Default' : `Default · ${configured.value}`}</span>
      <span className="text-muted-foreground">
        {configured === null ? `${tool.label}'s own setting` : configured.source}
      </span>
    </SelectItem>
  )
}

/** The model chip, which picks a model from the agent's configuration. */
function ModelPicker({
  tool,
  agent,
  settings,
  segment,
  onChange,
}: {
  tool: CodingToolDefinition
  agent: AgentState
  settings: AgentLaunchSettings
  segment: CommandSegment
  onChange: (change: AgentLaunchSettingsChange) => void
}) {
  const options = agent.launchOptions
  const models = options?.models ?? []
  const current = settings.model
  const missing = current !== null && options !== null && !models.some((m) => m.value === current)
  const pick = (value: string) => {
    const model = value === DEFAULT_CHOICE ? null : value
    const efforts =
      model === null
        ? (options?.defaultEfforts ?? [])
        : (models.find((option) => option.value === model)?.efforts ?? [])
    // An effort level the new model does not take goes back to Default.
    const effort =
      settings.effort !== null && efforts.includes(settings.effort) ? settings.effort : null
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
        data-testid={`agent-model-${tool.id}`}
      >
        {missing && <CircleAlertIcon className="size-3" />}
        <PickerText segment={segment} placeholder="model" />
      </SelectTrigger>
      {/* As wide as its longest choice, so that the check never covers one. */}
      <SelectContent alignItemWithTrigger={false} align="start" className="w-auto min-w-64">
        <SelectGroup>
          <DefaultChoice tool={tool} configured={options?.defaultModel ?? null} />
        </SelectGroup>
        {missing && (
          <SelectGroup>
            <SelectLabel>Not in the current configuration</SelectLabel>
            <SelectItem value={current}>
              <span className="font-mono text-xs">{current}</span>
            </SelectItem>
          </SelectGroup>
        )}
        {models.length > 0 && (
          <SelectGroup>
            <SelectLabel>From your configuration</SelectLabel>
            {models.map((model) => (
              <SelectItem
                key={model.value}
                value={model.value}
                data-testid={`agent-model-${tool.id}-option-${model.value}`}
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
  tool,
  agent,
  settings,
  segment,
  onChange,
}: {
  tool: CodingToolDefinition
  agent: AgentState
  settings: AgentLaunchSettings
  segment: CommandSegment
  onChange: (change: AgentLaunchSettingsChange) => void
}) {
  const options = agent.launchOptions
  const efforts =
    settings.model === null
      ? (options?.defaultEfforts ?? [])
      : (options?.models.find((option) => option.value === settings.model)?.efforts ?? [])
  return (
    <Select
      value={settings.effort ?? DEFAULT_CHOICE}
      onValueChange={(value) => {
        if (typeof value === 'string') onChange({ effort: value === DEFAULT_CHOICE ? null : value })
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label="Effort"
        className={cn(PICKER_CHIP, settings.effort === null ? NOT_PICKED : PICKED)}
        data-testid={`agent-effort-${tool.id}`}
      >
        <PickerText segment={segment} placeholder="effort" />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="start" className="w-auto min-w-48">
        <DefaultChoice tool={tool} configured={options?.defaultEffort ?? null} />
        {efforts.map((effort) => (
          <SelectItem
            key={effort}
            value={effort}
            data-testid={`agent-effort-${tool.id}-option-${effort}`}
          >
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
 * The command a new session runs, as chips: the program, the permission flag
 * that YOLO mode adds, the model and effort, which open their pickers, and the
 * extra arguments, typed at the end and removed with their ×.
 */
function CommandEditor({
  tool,
  agent,
  settings,
  yoloMode,
}: {
  tool: CodingToolDefinition
  agent: AgentState
  settings: AgentLaunchSettings
  yoloMode: boolean
}) {
  const changeAgentLaunchSettings = useAppStore((state) => state.changeAgentLaunchSettings)
  const [draft, setDraft] = useState('')
  const options = agent.launchOptions
  const modelEfforts =
    settings.model === null
      ? []
      : (options?.models.find((option) => option.value === settings.model)?.efforts ?? [])
  const segments = commandSegments({
    tool: tool.id,
    program: tool.command,
    yoloMode,
    settings,
    modelEfforts,
    defaultEfforts: options?.defaultEfforts ?? [],
  })
  const command = displayCommand(segments)
  const change = (update: AgentLaunchSettingsChange) => changeAgentLaunchSettings(tool.id, update)
  const commit = () => {
    const parts = splitArguments(draft)
    if (parts.length === 0) return
    change({ extraArgs: [...settings.extraArgs, ...parts] })
    setDraft('')
  }

  const program = segments.find((segment) => segment.kind === 'program')
  const permission = segments.find((segment) => segment.kind === 'permission')
  const model = segments.find((segment) => segment.kind === 'model')
  const effort = segments.find((segment) => segment.kind === 'effort')
  // A picked model or effort stands where its arguments are; one not picked
  // waits at the end, before the field that adds arguments.
  const modelPicker = model && (
    <ModelPicker tool={tool} agent={agent} settings={settings} segment={model} onChange={change} />
  )
  const effortPicker = effort && (
    <EffortPicker
      tool={tool}
      agent={agent}
      settings={settings}
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
        aria-label={`Command for ${tool.label}: ${command}`}
        data-command={command}
        data-testid={`agent-command-${tool.id}`}
      >
        {program && (
          <span
            className={cn(CHIP, 'px-1 font-semibold')}
            data-testid={`agent-command-program-${tool.id}`}
          >
            {program.text}
          </span>
        )}
        {permission && (
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex max-w-full" />}>
              <span
                className={cn(CHIP, 'bg-chart-3/10 text-chart-3 dark:bg-chart-3/15')}
                data-testid={`agent-permission-${tool.id}`}
              >
                <LockIcon className="size-3 shrink-0" />
                <span className="truncate">{permission.text}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent>{permission.note}</TooltipContent>
          </Tooltip>
        )}
        {model && model.args.length > 0 && modelPicker}
        {effort && effort.args.length > 0 && effortPicker}
        {settings.extraArgs.map((argument, index) => (
          <span
            // Extra arguments are positional: their texts may repeat.
            key={`${argument}-${index}`}
            className={cn(CHIP, 'bg-muted pr-0.5 text-foreground')}
            data-testid={`agent-extra-${tool.id}-${index}`}
          >
            <span className="truncate">{displayArgument(argument)}</span>
            <button
              type="button"
              aria-label={`Remove ${argument}`}
              className="flex size-4 items-center justify-center rounded-sm text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
              onClick={() =>
                change({ extraArgs: settings.extraArgs.filter((_, at) => at !== index) })
              }
              data-testid={`agent-extra-remove-${tool.id}-${index}`}
            >
              <XIcon className="size-3" />
            </button>
          </span>
        ))}
        {model && model.args.length === 0 && modelPicker}
        {effort && effort.args.length === 0 && effortPicker}
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            } else if (event.key === 'Backspace' && draft === '' && settings.extraArgs.length > 0) {
              change({ extraArgs: settings.extraArgs.slice(0, -1) })
            }
          }}
          onBlur={commit}
          placeholder="Add arguments…"
          spellCheck={false}
          aria-label={`Add arguments for ${tool.label}`}
          className="h-6 min-w-28 flex-1 bg-transparent px-1 font-mono text-xs outline-none placeholder:text-muted-foreground"
          data-testid={`agent-extra-input-${tool.id}`}
        />
      </div>
      <span className="pt-1">
        <CopyCommandButton command={command} testId={`agent-copy-${tool.id}`} />
      </span>
    </div>
  )
}

/** A failure of an operation, or a version that could not be read, which a dialog tells in full. */
type AgentFailure =
  | { kind: 'operation'; agent: AgentState }
  | { kind: 'version'; agent: AgentState }

/** A reason as a sentence of its own: npm keeps its lowercase name. */
function asSentence(reason: string): string {
  const text = reason.startsWith('npm') ? reason : reason.charAt(0).toUpperCase() + reason.slice(1)
  return /[.!?]$/.test(text) ? text : `${text}.`
}

/** The details of a failed install or update, or of a version that could not be read. */
function FailureDialog({ failure, onClose }: { failure: AgentFailure; onClose: () => void }) {
  const installAgent = useAppStore((state) => state.installAgent)
  const updateAgent = useAppStore((state) => state.updateAgent)
  const [copied, markCopied] = useCopied()
  const { agent } = failure
  const label = CODING_TOOLS.find((tool) => tool.id === agent.id)?.label ?? agent.id
  const operation = agent.operation
  const failed = failure.kind === 'operation' && operation?.status === 'failed' ? operation : null
  const installation = agent.installation
  const lookUp = 'Copy the details to look it up, or to ask an agent about it.'

  let title: string
  let description: string
  let command: string | null
  let output: string
  let details: string[]
  if (failed === null) {
    title = `${label} doesn't run`
    description = `Its version command printed no version. ${lookUp}`
    command = installation?.versionCommand ?? null
    output = installation?.versionOutput ?? ''
    details = []
  } else {
    title = `Couldn't ${failed.kind} ${label}`
    const exited = failed.exitCode !== null && failed.exitCode !== 0
    description = exited
      ? `The command exited with code ${failed.exitCode}${
          failed.seconds === null ? '' : ` after ${failed.seconds} seconds`
        }. ${lookUp}`
      : `${asSentence(failed.reason)} ${lookUp}`
    command = failed.command
    output = failed.output
    details = exited
      ? [
          `Exited with code ${failed.exitCode}${
            failed.seconds === null ? '' : ` after ${failed.seconds} s`
          }`,
        ]
      : [asSentence(failed.reason)]
  }
  const copyText = [
    ...(command === null ? [] : [`$ ${command}`]),
    ...details,
    ...(output === '' ? [] : ['', output]),
  ].join('\n')

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl" data-testid="agent-failure-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 flex-col gap-2">
          {command !== null && (
            <code
              className="block rounded-md bg-muted px-2.5 py-2 font-mono text-xs break-all"
              data-testid="agent-failure-command"
            >
              $ {command}
            </code>
          )}
          {output !== '' && (
            <pre
              className="max-h-64 overflow-y-auto rounded-md bg-muted px-2.5 py-2 font-mono text-xs break-all whitespace-pre-wrap text-foreground select-text"
              data-testid="agent-failure-output"
            >
              {output}
            </pre>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              api.writeClipboardText(copyText)
              markCopied()
            }}
            data-testid="agent-failure-copy"
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? 'Copied' : 'Copy details'}
          </Button>
          {failed !== null && (
            <Button
              onClick={() => {
                if (failed.kind === 'install') installAgent(agent.id)
                else updateAgent(agent.id)
                onClose()
              }}
              data-testid="agent-failure-retry"
            >
              <RefreshCwIcon />
              Try again
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** A red button that opens the details of what went wrong. */
function FailureButton({
  children,
  onClick,
  testId,
}: {
  children: ReactNode
  onClick: () => void
  testId: string
}) {
  return (
    <Button
      variant="ghost"
      size="xs"
      className="shrink-0 text-destructive hover:text-destructive"
      onClick={onClick}
      data-testid={testId}
    >
      <CircleAlertIcon />
      {children}
      <ChevronRightIcon className="-ml-0.5 opacity-60" />
    </Button>
  )
}

/**
 * What an agent's installation is doing, or what can be done with it: Cancel
 * while it waits its turn, a spinner while it runs, a red link to the details
 * once it has failed, Install or Update, or why there is neither; nothing
 * when it is up to date.
 */
function AgentActions({
  agent,
  status,
  onFailure,
}: {
  agent: AgentState
  status: AgentRowStatus
  onFailure: (failure: AgentFailure) => void
}) {
  const installAgent = useAppStore((state) => state.installAgent)
  const updateAgent = useAppStore((state) => state.updateAgent)
  const cancel = useAppStore((state) => state.cancelAgentOperation)
  const id = agent.id
  const failed = agent.operation?.status === 'failed' ? agent.operation : null
  if (failed !== null) {
    return (
      <FailureButton
        onClick={() => onFailure({ kind: 'operation', agent })}
        testId={`agent-failure-${id}`}
      >
        {failed.kind === 'install' ? 'Install failed' : 'Update failed'}
      </FailureButton>
    )
  }
  switch (status.kind) {
    case 'waiting':
      return (
        <span className="flex shrink-0 items-center gap-2">
          <span
            className="text-xs whitespace-nowrap text-muted-foreground"
            data-testid={`agent-status-${id}`}
          >
            Waiting…
          </span>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => cancel(id)}
            data-testid={`agent-cancel-${id}`}
          >
            Cancel
          </Button>
        </span>
      )
    case 'running':
      return (
        <span className="flex shrink-0 items-center gap-2">
          <Spinner className="size-3.5 text-muted-foreground" />
          <span
            className="text-xs whitespace-nowrap text-muted-foreground"
            data-testid={`agent-status-${id}`}
          >
            {status.operation === 'install' ? 'Installing…' : 'Updating…'}
          </span>
        </span>
      )
    case 'checking':
      return <StatusText testId={`agent-status-${id}`}>Checking…</StatusText>
    case 'does-not-run':
      return (
        <FailureButton
          onClick={() => onFailure({ kind: 'version', agent })}
          testId={`agent-does-not-run-${id}`}
        >
          Doesn't run
        </FailureButton>
      )
    case 'install':
      return (
        <RunsTooltip command={agent.installCommand}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => installAgent(id)}
            data-testid={`agent-install-${id}`}
          >
            Install
          </Button>
        </RunsTooltip>
      )
    case 'needs-node':
      return <StatusText testId={`agent-status-${id}`}>{INSTALL_NEEDS_NODE_MESSAGE}</StatusText>
    case 'needs-write-access':
      return (
        <StatusText testId={`agent-status-${id}`}>{INSTALL_NEEDS_WRITE_ACCESS_MESSAGE}</StatusText>
      )
    case 'needs-newer-node':
      return (
        <StatusText testId={`agent-status-${id}`}>
          {installNeedsNodeVersionMessage(status.requirement)}
        </StatusText>
      )
    case 'cannot-check':
      return <StatusText testId={`agent-status-${id}`}>Couldn't check for updates</StatusText>
    case 'up-to-date':
      return null
    case 'update-elsewhere':
      return (
        <StatusText testId={`agent-status-${id}`}>Update it the way you installed it</StatusText>
      )
    case 'update':
      return (
        <RunsTooltip command={agent.installation?.updateCommand ?? null}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => updateAgent(id)}
            data-testid={`agent-update-${id}`}
          >
            Update to {status.version}
          </Button>
        </RunsTooltip>
      )
    case 'update-blocked':
      return <StatusText testId={`agent-status-${id}`}>{status.version} is out</StatusText>
  }
}

/** An installed agent's version, how it was installed and where, and its latest version. */
function InstallationDetails({ agent }: { agent: AgentState }) {
  const installation = agent.installation
  if (installation === null) return null
  const method = installMethodLabel(installation.method)
  const latest = [
    ...(agent.latest === null ? [] : [`Latest ${agent.latest}`]),
    ...(installation.updateCommand === null ? [] : [`updates with ${installation.updateCommand}`]),
  ].join(' · ')
  return (
    <div
      className="flex min-w-0 flex-col gap-1 rounded-lg bg-muted/60 px-3 py-2 sm:ml-8"
      data-testid={`agent-details-${agent.id}`}
    >
      <span className="flex min-w-0 text-xs text-muted-foreground">
        <span className="shrink-0 whitespace-pre">
          {[installation.version ?? "Doesn't run", ...(method === null ? [] : [method])].join(
            ' · ',
          )}
          {' · '}
        </span>
        <span className="truncate" title={installation.path} data-testid={`agent-path-${agent.id}`}>
          {installation.displayPath}
        </span>
      </span>
      {latest !== '' && (
        <span className="truncate font-mono text-xs text-muted-foreground">{latest}</span>
      )}
    </div>
  )
}

/** The mark beside the name of the default agent. */
function DefaultBadge({ id }: { id: CodingToolId }) {
  return (
    <Badge variant="secondary" data-testid={`agent-default-${id}`}>
      Default
    </Badge>
  )
}

/** An installed agent's row, with its command editor below it while it is enabled. */
function AgentRow({
  tool,
  agent,
  target,
  launchSettings,
  isDefault,
  yoloMode,
  onFailure,
}: {
  tool: CodingToolDefinition
  agent: AgentState
  target: InstallTarget | null
  launchSettings: AgentLaunchSettings
  isDefault: boolean
  yoloMode: boolean
  onFailure: (failure: AgentFailure) => void
}) {
  const changeAgentLaunchSettings = useAppStore((state) => state.changeAgentLaunchSettings)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const status = agentRowStatus(agent, target)
  const id = tool.id
  const enabled = launchSettings.enabled
  const version = agent.installation?.version ?? null
  return (
    <Collapsible
      open={detailsOpen}
      onOpenChange={setDetailsOpen}
      className="flex flex-col gap-2.5 px-4 py-3"
      data-testid={`agent-row-${id}`}
      data-status={agent.operation?.status === 'failed' ? 'failed' : status.kind}
      data-enabled={enabled}
    >
      {/* As tall as a button, so that rows line up whether they have one or not. */}
      <div className="flex min-h-7 items-center gap-3">
        <ToolIcon toolId={id} className={cn('size-5 shrink-0', !enabled && 'opacity-50')} />
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className={cn('text-sm font-medium', !enabled && 'text-muted-foreground')}
            data-testid={`agent-name-${id}`}
          >
            {tool.label}
          </span>
          {isDefault && <DefaultBadge id={id} />}
          {!enabled && (
            <span className="text-xs text-muted-foreground" data-testid={`agent-disabled-${id}`}>
              Off
            </span>
          )}
        </span>
        <AgentActions agent={agent} status={status} onFailure={onFailure} />
        {version !== null && (
          <CollapsibleTrigger
            render={
              <Button
                variant="ghost"
                size="xs"
                className="shrink-0 font-normal text-muted-foreground"
                data-testid={`agent-version-${id}`}
              />
            }
          >
            {version}
            <Chevron open={detailsOpen} className="size-3" />
          </CollapsibleTrigger>
        )}
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex" />}>
            <Switch
              checked={enabled}
              onCheckedChange={(checked) => changeAgentLaunchSettings(id, { enabled: checked })}
              aria-label={`Use ${tool.label}`}
              data-testid={`agent-enabled-${id}`}
            />
          </TooltipTrigger>
          <TooltipContent>
            {enabled ? 'Shown in the new session menu' : 'Hidden from the new session menu'}
          </TooltipContent>
        </Tooltip>
      </div>
      <CollapsibleContent>
        <InstallationDetails agent={agent} />
      </CollapsibleContent>
      {status.kind === 'update-blocked' && (
        <p className="text-xs text-muted-foreground sm:pl-8">
          {joined([
            ...(status.node ? [nodeRequirementMessage(status.version, status.node)] : []),
            ...(status.writable ? [] : [FOLDER_NOT_WRITABLE_MESSAGE]),
          ])}
        </p>
      )}
      {enabled && (
        <div className="min-w-0 sm:pl-8">
          <CommandEditor tool={tool} agent={agent} settings={launchSettings} yoloMode={yoloMode} />
        </div>
      )}
    </Collapsible>
  )
}

/** The agents that are not installed, in a group that ends the list and opens to show them. */
function NotInstalledGroup({
  tools,
  states,
  target,
  defaultAgent,
  onFailure,
}: {
  tools: CodingToolDefinition[]
  states: Map<string, AgentState>
  target: InstallTarget | null
  defaultAgent: CodingToolId
  onFailure: (failure: AgentFailure) => void
}) {
  const [open, setOpen] = useState(false)
  if (tools.length === 0) return null
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        data-testid="not-installed-group"
      >
        <Chevron open={open} />
        Not installed · {tools.length}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col divide-y border-t" data-testid="not-installed-list">
          {tools.map((tool) => {
            const agent = states.get(tool.id) ?? unknownAgent(tool.id)
            const description = notInstalledDescription(agent, target)
            return (
              <div
                key={tool.id}
                className="flex items-center gap-3 px-4 py-3"
                data-testid={`agent-row-${tool.id}`}
                data-status={
                  agent.operation?.status === 'failed'
                    ? 'failed'
                    : agentRowStatus(agent, target).kind
                }
              >
                <ToolIcon toolId={tool.id} className="size-5 shrink-0" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-medium" data-testid={`agent-name-${tool.id}`}>
                      {tool.label}
                    </span>
                    {tool.id === defaultAgent && <DefaultBadge id={tool.id} />}
                  </span>
                  <span
                    className="text-xs text-muted-foreground"
                    data-testid={`agent-description-${tool.id}`}
                  >
                    {description ?? 'Not installed'}
                  </span>
                </span>
                <AgentActions
                  agent={agent}
                  status={agentRowStatus(agent, target)}
                  onFailure={onFailure}
                />
              </div>
            )
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** The agents as the default agent picker lists them, each with its icon. */
const AGENT_CHOICES = CODING_TOOLS.map((tool) => ({
  value: tool.id,
  // A row of its own, which keeps the icon centered on the name in the list too.
  label: (
    <span className="flex items-center gap-2">
      <ToolIcon toolId={tool.id} className="size-4" />
      {tool.label}
    </span>
  ),
}))

/** The picker of the default agent, which marks the agent's row Default. */
function DefaultAgentPicker({ value, disabled }: { value: CodingToolId; disabled: boolean }) {
  const setDefaultAgent = useAppStore((state) => state.setDefaultAgent)
  return (
    <Select
      items={AGENT_CHOICES}
      value={value}
      onValueChange={(id) => {
        if (id !== null) setDefaultAgent(id)
      }}
      disabled={disabled}
    >
      <SelectTrigger
        className="min-w-40"
        aria-labelledby="default-agent-label"
        data-testid="default-agent"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="end">
        {AGENT_CHOICES.map((choice) => (
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

/**
 * The settings' Agents page: the default agent, the YOLO mode switch and the
 * switch for asking before a running session is closed, the installed agents
 * with the command each new session runs and the settings in it, Update all
 * and Re-detect, and below a group of the agents that are not installed.
 */
export function AgentsPage() {
  const agents = useAppStore((state) => state.agents)
  const launchSettings = useAppStore((state) => state.launchSettings)
  const enterAgentsPage = useAppStore((state) => state.enterAgentsPage)
  const detectAgents = useAppStore((state) => state.detectAgents)
  const updateAllAgents = useAppStore((state) => state.updateAllAgents)
  const setYoloMode = useAppStore((state) => state.setYoloMode)
  const setConfirmClose = useAppStore((state) => state.setConfirmClose)
  const [failure, setFailure] = useState<AgentFailure | null>(null)
  const [updatingAll, setUpdatingAll] = useState(false)
  // Whether the Update all run seen last has had an operation pending: it ends
  // once none is, so that a later operation of one agent is not taken for it.
  const updateAllRan = useRef(false)
  useEffect(() => {
    enterAgentsPage()
  }, [enterAgentsPage])

  const states = new Map(agents?.agents.map((agent) => [agent.id, agent]))
  const installed = CODING_TOOLS.filter((tool) => {
    const agent = states.get(tool.id)
    return agent === undefined || !agent.detected || agent.installation !== null
  })
  const notInstalled = CODING_TOOLS.filter((tool) => {
    const agent = states.get(tool.id)
    return agent !== undefined && agent.detected && agent.installation === null
  })
  const target = agents?.installTarget ?? null
  const updateAllCandidates = (agents?.agents ?? []).filter((agent) =>
    updateAllIncludes(agent, target),
  )
  const pending = (agents?.agents ?? []).some(
    (agent) => agent.operation?.status === 'waiting' || agent.operation?.status === 'running',
  )
  useEffect(() => {
    if (pending) updateAllRan.current = true
    else if (updateAllRan.current) {
      updateAllRan.current = false
      setUpdatingAll(false)
    }
  }, [pending])
  const updating = updatingAll && pending
  const showUpdateAll = updateAllCandidates.length >= 2 || updating
  const detecting = agents?.detecting ?? false
  const defaultAgent = launchSettings?.defaultAgent ?? 'claude'
  const yoloMode = launchSettings?.yoloMode ?? true
  const confirmClose = launchSettings?.confirmClose ?? true
  const updateAllButton = (
    <Button
      variant="outline"
      size="sm"
      disabled={updating}
      onClick={() => {
        setUpdatingAll(true)
        updateAllAgents()
      }}
      data-testid="agents-update-all"
    >
      {updating ? <Spinner /> : <ArrowDownToLineIcon />}
      {updating ? 'Updating all…' : 'Update all'}
    </Button>
  )

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-background" data-testid="agents-page">
      {/* The page's part of the window's top row, which drags the window. */}
      <div className="h-11 shrink-0 [app-region:drag]" />
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 pt-2 pb-10">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
            <div className="flex items-center gap-2">
              {showUpdateAll &&
                (updating ? (
                  updateAllButton
                ) : (
                  <Tooltip>
                    <TooltipTrigger render={<span className="inline-flex" />}>
                      {updateAllButton}
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      {updateAllCandidates
                        .map(
                          (agent) =>
                            `${CODING_TOOLS.find((tool) => tool.id === agent.id)?.label ?? agent.id} ${agent.latest ?? ''}`,
                        )
                        .join(', ')}
                    </TooltipContent>
                  </Tooltip>
                ))}
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Re-detect"
                onClick={detectAgents}
                data-testid="agents-redetect"
              >
                {detecting ? <Spinner /> : <RefreshCwIcon />}
              </Button>
            </div>
          </div>

          <div className="flex flex-col divide-y rounded-xl border">
            <div className="flex items-center gap-4 px-4 py-3">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm font-medium" id="default-agent-label">
                  Default agent
                </span>
                <span className="text-xs text-muted-foreground">New chats use it.</span>
              </span>
              <DefaultAgentPicker value={defaultAgent} disabled={launchSettings === null} />
            </div>
            <label className="flex items-center gap-4 px-4 py-3">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm font-medium" id="yolo-mode-label">
                  YOLO mode
                </span>
                <span className="text-xs text-muted-foreground">
                  Agents act without asking for your approval.
                </span>
              </span>
              <Switch
                checked={yoloMode}
                onCheckedChange={setYoloMode}
                disabled={launchSettings === null}
                aria-labelledby="yolo-mode-label"
                data-testid="yolo-mode"
              />
            </label>
            <label className="flex items-center gap-4 px-4 py-3">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm font-medium" id="confirm-close-label">
                  Confirm before closing
                </span>
                <span className="text-xs text-muted-foreground">
                  Ask before closing a session whose agent is still running.
                </span>
              </span>
              <Switch
                checked={confirmClose}
                onCheckedChange={setConfirmClose}
                disabled={launchSettings === null}
                aria-labelledby="confirm-close-label"
                data-testid="confirm-close"
              />
            </label>
          </div>

          <div className="flex flex-col divide-y rounded-xl border" data-testid="agents-list">
            {installed.map((tool) => {
              const agent = states.get(tool.id) ?? unknownAgent(tool.id)
              const settings = launchSettings?.agents[tool.id]
              if (agents === null || settings === undefined) {
                return (
                  <div
                    className="flex items-center gap-3 px-4 py-3"
                    key={tool.id}
                    data-testid={`agent-row-${tool.id}`}
                    data-status="checking"
                  >
                    <ToolIcon toolId={tool.id} className="size-5 shrink-0" />
                    <span className="min-w-0 flex-1 text-sm font-medium">{tool.label}</span>
                    <StatusText testId={`agent-status-${tool.id}`}>Checking…</StatusText>
                  </div>
                )
              }
              return (
                <AgentRow
                  key={tool.id}
                  tool={tool}
                  agent={agent}
                  target={target}
                  launchSettings={settings}
                  isDefault={tool.id === defaultAgent}
                  yoloMode={yoloMode}
                  onFailure={setFailure}
                />
              )
            })}
            <NotInstalledGroup
              tools={notInstalled}
              states={states}
              target={target}
              defaultAgent={defaultAgent}
              onFailure={setFailure}
            />
          </div>
        </div>
      </div>
      {failure !== null && <FailureDialog failure={failure} onClose={() => setFailure(null)} />}
    </div>
  )
}

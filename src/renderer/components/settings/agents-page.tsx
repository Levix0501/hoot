import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CopyIcon,
  LockIcon,
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
  displayCommand,
  type CommandSegment,
} from '../../../shared/launch-command'
import type { AgentLaunchSettings } from '../../../shared/launch-settings'
import { CODING_TOOLS, type CodingToolDefinition } from '../../../shared/tools'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
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

/** The line below an agent's name: its version, how it was installed and where its command is. */
function InstallationDetails({ agent }: { agent: AgentState }) {
  const installation = agent.installation
  if (installation === null) return null
  const method = installMethodLabel(installation.method) ?? 'Unknown'
  return (
    <dl
      className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground"
      data-testid={`agent-details-${agent.id}`}
    >
      <dt>Version</dt>
      <dd data-testid={`agent-details-version-${agent.id}`}>
        {installation.version ?? "Doesn't run"}
      </dd>
      <dt>Installed with</dt>
      <dd data-testid={`agent-details-method-${agent.id}`}>{method}</dd>
      <dt>Path</dt>
      <dd className="min-w-0">
        <PathText
          shown={installation.displayPath}
          full={installation.path}
          testId={`agent-path-${agent.id}`}
        />
      </dd>
    </dl>
  )
}

/** A chip of the command editor, with a tooltip that says why it is as it is. */
function SegmentChip({
  segment,
  testId,
  children,
}: {
  segment: CommandSegment
  testId: string
  children?: ReactNode
}) {
  const chip = (
    <span
      className={cn(
        'inline-flex min-w-0 max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-xs',
        segment.locked
          ? 'border-border bg-muted text-muted-foreground'
          : 'border-border bg-background text-foreground',
        segment.explanatory && 'border-dashed text-muted-foreground',
      )}
      data-testid={testId}
    >
      {segment.locked && <LockIcon className="size-3 shrink-0" />}
      <span className="min-w-0 truncate">{segment.text}</span>
      {children}
    </span>
  )
  if (!segment.note) return chip
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex min-w-0" />}>{chip}</TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-80">
        {segment.note}
      </TooltipContent>
    </Tooltip>
  )
}

/** The choices of a model or effort segment, which selects one. */
function ModelSegment({
  tool,
  settings,
  segment,
  agent,
  onChange,
}: {
  tool: CodingToolDefinition
  settings: AgentLaunchSettings
  segment: CommandSegment
  agent: AgentState
  onChange: (change: { model: string | null; effort?: string | null }) => void
}) {
  if (segment.locked) return <SegmentChip segment={segment} testId={`agent-model-${tool.id}`} />
  const models = agent.launchOptions?.models ?? []
  const current = settings.model
  const missing =
    current !== null &&
    agent.launchOptions !== null &&
    !models.some((option) => option.value === current)
  const currentOption = models.find((option) => option.value === current)
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className={cn(
                'inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring',
                current === null
                  ? 'border-dashed border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
                  : 'border-border bg-background text-foreground hover:bg-muted',
                missing && 'border-destructive/60 text-destructive',
              )}
              data-testid={`agent-model-${tool.id}`}
            />
          }
        >
          {segment.text}
          {missing && <CircleAlertIcon className="size-3 shrink-0" />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-auto min-w-52">
          <DropdownMenuItem
            onClick={() =>
              onChange({
                model: null,
                effort:
                  settings.effort !== null &&
                  (agent.launchOptions?.defaultEfforts ?? []).includes(settings.effort)
                    ? settings.effort
                    : null,
              })
            }
            data-testid={`agent-model-${tool.id}-default`}
          >
            <span>Default</span>
            {current === null && <CheckIcon className="ml-auto" />}
          </DropdownMenuItem>
          {models.map((option) => (
            <DropdownMenuItem
              key={option.value}
              onClick={() =>
                onChange({
                  model: option.value,
                  effort:
                    settings.effort !== null && option.efforts.includes(settings.effort)
                      ? settings.effort
                      : null,
                })
              }
              data-testid={`agent-model-${tool.id}-option-${option.value}`}
            >
              <span className="truncate">{option.label}</span>
              {option.value === current && <CheckIcon className="ml-auto" />}
            </DropdownMenuItem>
          ))}
          {missing && currentOption === undefined && (
            <p className="px-1.5 py-1 text-xs text-muted-foreground">
              {current} is not in the current configuration.
            </p>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {missing && (
        <span
          className="inline-flex items-center gap-1 text-xs text-destructive"
          data-testid={`agent-model-missing-${tool.id}`}
        >
          Not in the current configuration
        </span>
      )}
    </span>
  )
}

/** The effort segment, whose choices follow the selected model. */
function EffortSegment({
  tool,
  settings,
  segment,
  agent,
  onChange,
}: {
  tool: CodingToolDefinition
  settings: AgentLaunchSettings
  segment: CommandSegment
  agent: AgentState
  onChange: (change: { effort: string | null }) => void
}) {
  if (segment.locked) return <SegmentChip segment={segment} testId={`agent-effort-${tool.id}`} />
  const options = agent.launchOptions
  const currentEfforts =
    settings.model === null
      ? (options?.defaultEfforts ?? [])
      : (options?.models.find((option) => option.value === settings.model)?.efforts ?? [])
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={cn(
              'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring',
              settings.effort === null
                ? 'border-dashed border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
                : 'border-border bg-background text-foreground hover:bg-muted',
            )}
            data-testid={`agent-effort-${tool.id}`}
          />
        }
      >
        {segment.text}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto min-w-40">
        <DropdownMenuItem
          onClick={() => onChange({ effort: null })}
          data-testid={`agent-effort-${tool.id}-default`}
        >
          <span>Default</span>
          {settings.effort === null && <CheckIcon className="ml-auto" />}
        </DropdownMenuItem>
        {currentEfforts.map((effort) => (
          <DropdownMenuItem
            key={effort}
            onClick={() => onChange({ effort })}
            data-testid={`agent-effort-${tool.id}-option-${effort}`}
          >
            <span>{effort}</span>
            {effort === settings.effort && <CheckIcon className="ml-auto" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** One segment of the command editor. */
function CommandSegmentView({
  tool,
  settings,
  agent,
  segment,
  index,
  onChange,
}: {
  tool: CodingToolDefinition
  settings: AgentLaunchSettings
  agent: AgentState
  segment: CommandSegment
  index: number
  onChange: (change: {
    model?: string | null
    effort?: string | null
    extraArgs?: string[]
  }) => void
}) {
  if (segment.kind === 'program') {
    return (
      <span
        className="font-mono text-sm font-medium text-foreground"
        data-testid={`agent-command-program-${tool.id}`}
      >
        {segment.text}
      </span>
    )
  }
  if (segment.kind === 'settings') {
    return (
      <span
        className="min-w-0 max-w-full font-mono text-[11px] break-all whitespace-pre-wrap text-muted-foreground select-text"
        data-testid={`agent-command-settings-${tool.id}`}
      >
        {segment.text}
      </span>
    )
  }
  if (segment.kind === 'model') {
    if (segment.selectable) {
      return (
        <ModelSegment
          tool={tool}
          settings={settings}
          segment={segment}
          agent={agent}
          onChange={(change) => onChange(change)}
        />
      )
    }
    return <SegmentChip segment={segment} testId={`agent-model-${tool.id}`} />
  }
  if (segment.kind === 'effort') {
    if (segment.selectable) {
      return (
        <EffortSegment
          tool={tool}
          settings={settings}
          segment={segment}
          agent={agent}
          onChange={(change) => onChange(change)}
        />
      )
    }
    return <SegmentChip segment={segment} testId={`agent-effort-${tool.id}`} />
  }
  if (segment.kind === 'argument') {
    const extraIndex = segment.extraIndex ?? index
    return (
      <span
        className="inline-flex items-center gap-1 rounded-md border border-border bg-background py-0.5 pr-0.5 pl-1.5 font-mono text-xs text-foreground"
        data-testid={`agent-extra-${tool.id}-${extraIndex}`}
      >
        <span className="max-w-full truncate">{segment.text}</span>
        <button
          type="button"
          aria-label={`Remove ${segment.text}`}
          className="rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() =>
            onChange({ extraArgs: settings.extraArgs.filter((_, at) => at !== extraIndex) })
          }
          data-testid={`agent-extra-remove-${tool.id}-${extraIndex}`}
        >
          <XIcon className="size-3" />
        </button>
      </span>
    )
  }
  return <SegmentChip segment={segment} testId={`agent-permission-${tool.id}`} />
}

/** The command that a new session of an agent runs, which is also its editor. */
function CommandEditor({
  tool,
  agent,
  settings,
  hookSettings,
  yoloMode,
}: {
  tool: CodingToolDefinition
  agent: AgentState
  settings: AgentLaunchSettings
  hookSettings: string
  yoloMode: boolean
}) {
  const changeAgentLaunchSettings = useAppStore((state) => state.changeAgentLaunchSettings)
  const [draft, setDraft] = useState('')
  const options = agent.launchOptions
  const modelEfforts =
    settings.model === null
      ? []
      : (options?.models.find((option) => option.value === settings.model)?.efforts ?? [])
  const defaultEfforts = options?.defaultEfforts ?? []
  const segments = commandSegments({
    tool: tool.id,
    program: tool.command,
    yoloMode,
    settings,
    hookSettings: tool.id === 'claude' ? hookSettings : null,
    modelEfforts,
    defaultEfforts,
  })
  const command = displayCommand(segments)
  const change = (update: {
    model?: string | null
    effort?: string | null
    extraArgs?: string[]
  }) => changeAgentLaunchSettings(tool.id, update)
  const addArguments = () => {
    const parts = draft.trim().split(/\s+/).filter(Boolean)
    if (parts.length === 0) return
    change({ extraArgs: [...settings.extraArgs, ...parts] })
    setDraft('')
  }

  return (
    <div
      className="mt-3 flex items-start gap-2 rounded-lg border bg-muted/30 px-2.5 py-2"
      role="group"
      aria-label={`Command for ${tool.label}: ${command}`}
      data-command={command}
      data-testid={`agent-command-${tool.id}`}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1.5">
        {segments.map((segment, index) => (
          <CommandSegmentView
            // Segments are positional: their texts may repeat, as extra arguments can.
            key={`${segment.kind}-${index}`}
            tool={tool}
            settings={settings}
            agent={agent}
            segment={segment}
            index={index}
            onChange={change}
          />
        ))}
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
            event.preventDefault()
            addArguments()
          }}
          placeholder="Add arguments…"
          aria-label={`Extra arguments for ${tool.label}`}
          className="min-w-24 flex-1 bg-transparent font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground"
          data-testid={`agent-extra-input-${tool.id}`}
        />
      </div>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Copy command"
              onClick={() => api.writeClipboardText(command)}
              data-testid={`agent-copy-${tool.id}`}
            />
          }
        >
          <CopyIcon />
        </TooltipTrigger>
        <TooltipContent side="bottom">Copy command</TooltipContent>
      </Tooltip>
    </div>
  )
}

/** A failure of an operation, or a version that could not be read, which a dialog tells in full. */
type AgentFailure =
  | { kind: 'operation'; agent: AgentState }
  | { kind: 'version'; agent: AgentState }

/** The details of a failed install or update, or of a version that could not be read. */
function FailureDialog({ failure, onClose }: { failure: AgentFailure; onClose: () => void }) {
  const installAgent = useAppStore((state) => state.installAgent)
  const updateAgent = useAppStore((state) => state.updateAgent)
  const { agent } = failure
  const operation = failure.kind === 'operation' ? agent.operation : null
  const installation = agent.installation
  const failed = operation?.status === 'failed' ? operation : null
  const title =
    failure.kind === 'version'
      ? "Doesn't run"
      : failed?.kind === 'install'
        ? 'Install failed'
        : 'Update failed'
  const command =
    failure.kind === 'version' ? (installation?.versionCommand ?? null) : (failed?.command ?? null)
  const exitCode = failure.kind === 'version' ? null : (failed?.exitCode ?? null)
  const output =
    failure.kind === 'version' ? (installation?.versionOutput ?? '') : (failed?.output ?? '')
  const details = [
    ...(command === null ? [] : [`$ ${command}`]),
    ...(exitCode === null ? [] : [`Exit code: ${exitCode}`]),
    ...(output === '' ? [] : ['', output]),
  ].join('\n')
  const retry = () => {
    if (failed?.kind === 'install') installAgent(agent.id)
    else if (failed?.kind === 'update') updateAgent(agent.id)
    onClose()
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {failed !== null && <DialogDescription>{failed.message}</DialogDescription>}
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {command !== null && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Command</span>
              <pre
                className="max-h-32 overflow-auto rounded-md bg-muted px-2.5 py-2 font-mono text-xs break-all whitespace-pre-wrap select-text"
                data-testid="agent-failure-command"
              >
                {command}
              </pre>
            </div>
          )}
          {exitCode !== null && (
            <p className="text-xs text-muted-foreground" data-testid="agent-failure-exit-code">
              Exit code: {exitCode}
            </p>
          )}
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Output</span>
            <pre
              className="max-h-80 overflow-auto rounded-md bg-muted px-2.5 py-2 font-mono text-xs break-all whitespace-pre-wrap select-text"
              data-testid="agent-failure-output"
            >
              {output}
            </pre>
          </div>
        </div>
        <DialogFooter className="flex-row justify-between sm:justify-between">
          <Button
            variant="outline"
            onClick={() => api.writeClipboardText(details)}
            data-testid="agent-failure-copy"
          >
            <CopyIcon />
            Copy details
          </Button>
          <div className="flex gap-2">
            {failure.kind === 'operation' && failed !== null && (
              <Button variant="outline" onClick={retry} data-testid="agent-failure-retry">
                Try again
              </Button>
            )}
            <Button onClick={onClose}>Close</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** What the row says and does on its right, from its state. */
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
  const cancelButton = (
    <Button
      variant="outline"
      size="sm"
      onClick={() => cancel(id)}
      disabled={agent.operation?.status === 'running' && !agent.operation.cancellable}
      data-testid={`agent-cancel-${id}`}
    >
      Cancel
    </Button>
  )
  const failed = agent.operation?.status === 'failed' ? agent.operation : null
  if (failed !== null) {
    return (
      <>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={() => onFailure({ kind: 'operation', agent })}
          data-testid={`agent-failure-${id}`}
        >
          {failed.kind === 'install' ? 'Install failed' : 'Update failed'}
        </Button>
      </>
    )
  }
  switch (status.kind) {
    case 'waiting':
      return (
        <>
          <span
            className="text-xs whitespace-nowrap text-muted-foreground"
            data-testid={`agent-status-${id}`}
          >
            Waiting…
          </span>
          {cancelButton}
        </>
      )
    case 'running':
      return (
        <>
          <Spinner className="size-3.5 text-muted-foreground" />
          <span
            className="text-xs whitespace-nowrap text-muted-foreground"
            data-testid={`agent-status-${id}`}
          >
            {status.operation === 'install' ? 'Installing…' : 'Updating…'}
          </span>
          {cancelButton}
        </>
      )
    case 'checking':
      return (
        <span
          className="text-xs whitespace-nowrap text-muted-foreground"
          data-testid={`agent-status-${id}`}
        >
          Checking…
        </span>
      )
    case 'does-not-run':
      return (
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={() => onFailure({ kind: 'version', agent })}
          data-testid={`agent-does-not-run-${id}`}
        >
          Doesn't run
        </Button>
      )
    case 'install':
      return (
        <Button
          variant="outline"
          size="sm"
          onClick={() => installAgent(id)}
          data-testid={`agent-install-${id}`}
        >
          Install
        </Button>
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
      return <StatusText testId={`agent-status-${id}`}>Up to date</StatusText>
    case 'update-elsewhere':
      return (
        <StatusText testId={`agent-status-${id}`}>Update it the way you installed it</StatusText>
      )
    case 'update':
      return (
        <Button
          variant="outline"
          size="sm"
          onClick={() => updateAgent(id)}
          data-testid={`agent-update-${id}`}
        >
          Update
        </Button>
      )
    case 'update-blocked':
      return <StatusText testId={`agent-status-${id}`}>{status.version} is out</StatusText>
  }
}

/** The text on a row's right, where there is no button. */
function StatusText({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <span className="text-xs whitespace-nowrap text-muted-foreground" data-testid={testId}>
      {children}
    </span>
  )
}

/** An installed agent's row, with its command editor below it while it is enabled. */
function AgentRow({
  tool,
  agent,
  target,
  launchSettings,
  hookSettings,
  yoloMode,
  onFailure,
}: {
  tool: CodingToolDefinition
  agent: AgentState
  target: InstallTarget | null
  launchSettings: AgentLaunchSettings
  hookSettings: string
  yoloMode: boolean
  onFailure: (failure: AgentFailure) => void
}) {
  const changeAgentLaunchSettings = useAppStore((state) => state.changeAgentLaunchSettings)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const status = agentRowStatus(agent, target)
  const id = tool.id
  return (
    <div
      className="flex flex-col px-4 py-3"
      data-testid={`agent-row-${id}`}
      data-status={agent.operation?.status === 'failed' ? 'failed' : status.kind}
      data-enabled={launchSettings.enabled}
    >
      <div className="flex items-start gap-3">
        <ToolIcon toolId={id} className="mt-0.5 size-4 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-sm leading-5 font-medium" data-testid={`agent-name-${id}`}>
              {tool.label}
            </span>
            {agent.installation?.version != null && (
              <button
                type="button"
                className="inline-flex items-center gap-0.5 rounded-sm font-mono text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                aria-expanded={detailsOpen}
                onClick={() => setDetailsOpen(!detailsOpen)}
                data-testid={`agent-version-${id}`}
              >
                {agent.installation.version}
                {detailsOpen ? (
                  <ChevronDownIcon className="size-3" />
                ) : (
                  <ChevronRightIcon className="size-3" />
                )}
              </button>
            )}
            {!launchSettings.enabled && (
              <Badge variant="secondary" data-testid={`agent-disabled-${id}`}>
                Disabled
              </Badge>
            )}
          </div>
          {detailsOpen && <InstallationDetails agent={agent} />}
          {status.kind === 'update-blocked' && (
            <p className="text-xs text-muted-foreground">
              {joined([
                ...(status.node ? [nodeRequirementMessage(status.version, status.node)] : []),
                ...(status.writable ? [] : [FOLDER_NOT_WRITABLE_MESSAGE]),
              ])}
            </p>
          )}
        </div>
        <div className="flex min-h-7 shrink-0 items-center gap-2">
          <AgentActions agent={agent} status={status} onFailure={onFailure} />
          <Switch
            checked={launchSettings.enabled}
            onCheckedChange={(enabled) => changeAgentLaunchSettings(id, { enabled })}
            aria-label={`Enable ${tool.label}`}
            data-testid={`agent-enabled-${id}`}
          />
        </div>
      </div>
      {launchSettings.enabled && (
        <CommandEditor
          tool={tool}
          agent={agent}
          settings={launchSettings}
          hookSettings={hookSettings}
          yoloMode={yoloMode}
        />
      )}
    </div>
  )
}

/** A not-installed agent's row, in the group at the bottom. */
function NotInstalledRow({
  tool,
  agent,
  target,
  onFailure,
}: {
  tool: CodingToolDefinition
  agent: AgentState
  target: InstallTarget | null
  onFailure: (failure: AgentFailure) => void
}) {
  const status = agentRowStatus(agent, target)
  const id = tool.id
  const description = notInstalledDescription(agent, target)
  return (
    <div
      className="flex items-start gap-3 px-4 py-3"
      data-testid={`agent-row-${id}`}
      data-status={agent.operation?.status === 'failed' ? 'failed' : status.kind}
    >
      <ToolIcon toolId={id} className="mt-0.5 size-4 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-sm leading-5 font-medium" data-testid={`agent-name-${id}`}>
          {tool.label}
        </span>
        {description !== null && (
          <p className="text-xs text-muted-foreground" data-testid={`agent-description-${id}`}>
            {description}
          </p>
        )}
      </div>
      <div className="flex min-h-7 shrink-0 items-center gap-2">
        <AgentActions agent={agent} status={status} onFailure={onFailure} />
      </div>
    </div>
  )
}

/**
 * The settings' Agents page: the YOLO mode switch, the installed agents with
 * the command each new session runs and the settings in it, Update all and
 * Re-detect, and below a group of the agents that are not installed.
 */
export function AgentsPage() {
  const agents = useAppStore((state) => state.agents)
  const launchSettings = useAppStore((state) => state.launchSettings)
  const enterAgentsPage = useAppStore((state) => state.enterAgentsPage)
  const detectAgents = useAppStore((state) => state.detectAgents)
  const updateAllAgents = useAppStore((state) => state.updateAllAgents)
  const setYoloMode = useAppStore((state) => state.setYoloMode)
  const [notInstalledOpen, setNotInstalledOpen] = useState(false)
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
  const yoloMode = launchSettings?.yoloMode ?? true

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-background" data-testid="agents-page">
      {/* The page's part of the window's top row, which drags the window. */}
      <div className="h-11 shrink-0 [app-region:drag]" />
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 pt-2 pb-10">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
            <div className="flex items-center gap-1.5">
              {showUpdateAll && (
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
                  {updating ? 'Updating all…' : 'Update all'}
                </Button>
              )}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Re-detect"
                      onClick={detectAgents}
                      data-testid="agents-redetect"
                    />
                  }
                >
                  <RefreshCwIcon className={cn(detecting && 'animate-spin')} />
                </TooltipTrigger>
                <TooltipContent side="bottom">Re-detect</TooltipContent>
              </Tooltip>
            </div>
          </div>

          <div className="flex items-start justify-between gap-6 rounded-xl border px-4 py-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium" id="yolo-mode-label">
                YOLO mode
              </span>
              <span className="text-xs text-muted-foreground">
                Agents act without asking for your approval.
              </span>
            </div>
            <Switch
              checked={yoloMode}
              onCheckedChange={setYoloMode}
              disabled={launchSettings === null}
              aria-labelledby="yolo-mode-label"
              data-testid="yolo-mode"
            />
          </div>

          <div className="flex flex-col divide-y rounded-xl border" data-testid="agents-list">
            {installed.map((tool) => {
              const agent = states.get(tool.id) ?? unknownAgent(tool.id)
              const settings = launchSettings?.agents[tool.id]
              if (agents === null || settings === undefined) {
                return (
                  <div
                    className="flex items-start gap-3 px-4 py-3"
                    key={tool.id}
                    data-testid={`agent-row-${tool.id}`}
                    data-status="checking"
                  >
                    <ToolIcon toolId={tool.id} className="mt-0.5 size-4 shrink-0" />
                    <span className="flex-1 text-sm font-medium">{tool.label}</span>
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
                  hookSettings={agents?.claudeHookSettings ?? ''}
                  yoloMode={yoloMode}
                  onFailure={setFailure}
                />
              )
            })}
          </div>

          {notInstalled.length > 0 && (
            <Collapsible open={notInstalledOpen} onOpenChange={setNotInstalledOpen}>
              <CollapsibleTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start gap-1.5 px-1 text-muted-foreground hover:text-foreground"
                    data-testid="not-installed-group"
                  />
                }
              >
                {notInstalledOpen ? (
                  <ChevronDownIcon className="size-3.5" />
                ) : (
                  <ChevronRightIcon className="size-3.5" />
                )}
                Not installed
                <span className="text-xs">({notInstalled.length})</span>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                <div
                  className="flex flex-col divide-y rounded-xl border"
                  data-testid="not-installed-list"
                >
                  {notInstalled.map((tool) => (
                    <NotInstalledRow
                      key={tool.id}
                      tool={tool}
                      agent={states.get(tool.id) ?? unknownAgent(tool.id)}
                      target={target}
                      onFailure={setFailure}
                    />
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      </div>
      {failure !== null && <FailureDialog failure={failure} onClose={() => setFailure(null)} />}
    </div>
  )
}

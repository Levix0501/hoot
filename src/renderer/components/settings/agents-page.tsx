import {
  ArrowDownToLineIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CopyIcon,
  RefreshCwIcon,
} from 'lucide-react'
import { cn } from 'cn'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  FOLDER_NOT_WRITABLE_MESSAGE,
  INSTALL_NEEDS_NODE_MESSAGE,
  INSTALL_NEEDS_WRITE_ACCESS_MESSAGE,
  installNeedsNodeVersionMessage,
  nodeRequirementMessage,
  operationName,
  type AgentOperationKind,
  type AgentState,
  type InstallTarget,
} from '../../../shared/agents'
import { CODING_TOOLS, type CodingToolDefinition, type CodingToolId } from '../../../shared/tools'
import { api } from '../../lib/api'
import { agentRowStatus, updateAllIncludes, type AgentRowStatus } from '../../lib/agent-status'
import { useAppStore } from '../../store/app-store'
import { ToolIcon } from '../tool-icon'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog'
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
import { DefaultAgentPicker, DormantAgentItem, HarnessAgents } from './agent-items'
import { useCopied } from './agent-panel'
import { Spinner } from '../ui/spinner'
import { Switch } from '../ui/switch'
import { VersionMenu, type UninstallAsk } from './version-menu'

/** An agent before Hoot has looked for it. */
function unknownAgent(id: CodingToolDefinition['id']): AgentState {
  return {
    id,
    checking: true,
    detected: false,
    installation: null,
    latest: null,
    latestFailed: false,
    stable: null,
    releases: null,
    follow: { kind: 'latest' },
    installRoute: 'official',
    copies: [],
    nodeRequirement: null,
    operation: null,
    launchOptions: null,
  }
}

/** Parts of a line, with a middle dot between each two. */
function joined(parts: ReactNode[]): ReactNode[] {
  return parts.flatMap((part, index) => (index === 0 ? [part] : [' · ', part]))
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

/** A failure of an operation, or a version that could not be read, which a dialog tells in full. */
type AgentFailure =
  | { kind: 'operation'; agent: AgentState }
  | { kind: 'version'; agent: AgentState }

/** A reason as a sentence of its own: npm keeps its lowercase name. */
function asSentence(reason: string): string {
  const text = reason.startsWith('npm') ? reason : reason.charAt(0).toUpperCase() + reason.slice(1)
  return /[.!?]$/.test(text) ? text : `${text}.`
}

/** What a failed operation's title says it could not do: install Claude Code, or install 2.1.330 of it… */
function failureTitle(
  kind: AgentOperationKind,
  label: string,
  version: string | null,
  other: boolean,
): string {
  switch (kind) {
    case 'install':
      return `Couldn't install ${label}`
    case 'update':
      return `Couldn't update ${label}`
    case 'switch':
      return version === null ? `Couldn't install ${label}` : `Couldn't install ${label} ${version}`
    case 'uninstall':
      return other && version !== null
        ? `Couldn't uninstall ${label} ${version}`
        : `Couldn't uninstall ${label}`
  }
}

/**
 * The details of a failed operation, or of a version that could not be
 * read. Where the official installer failed, npm can install the agent
 * instead, when the computer has an npm the user can install with.
 */
function FailureDialog({
  failure,
  npmUsable,
  onClose,
}: {
  failure: AgentFailure
  /** Whether Install can use the computer's npm. */
  npmUsable: boolean
  onClose: () => void
}) {
  const installAgent = useAppStore((state) => state.installAgent)
  const retry = useAppStore((state) => state.retryAgentOperation)
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
    title = failureTitle(
      failed.kind,
      label,
      failed.version,
      failed.path !== null && failed.path !== installation?.path,
    )
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
          {failed?.kind === 'install' &&
            failed.route === 'official' &&
            npmUsable &&
            agent.nodeRequirement === null && (
              <Button
                variant="outline"
                onClick={() => {
                  installAgent(agent.id, 'npm')
                  onClose()
                }}
                data-testid="agent-failure-npm"
              >
                Install with npm
              </Button>
            )}
          {failed !== null && (
            <Button
              onClick={() => {
                retry(agent.id)
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

/** What a row says while its operation runs: Installing…, Switching to 2.1.330… */
function runningText(status: Extract<AgentRowStatus, { kind: 'running' }>): string {
  switch (status.operation) {
    case 'install':
      return 'Installing…'
    case 'update':
      return status.version === null ? 'Updating…' : `Updating to ${status.version}…`
    case 'switch':
      return status.version === null ? 'Switching…' : `Switching to ${status.version}…`
    case 'uninstall':
      return status.other && status.version !== null
        ? `Uninstalling ${status.version}…`
        : 'Uninstalling…'
  }
}

/**
 * What an agent's installation is doing, or what can be done with it: Cancel
 * while it waits its turn, a spinner while it runs, a red link to the details
 * once it has failed, Install or Update, Back to the version it stays on
 * where another has taken its place, or why there is none of these; nothing
 * when it is up to date, or stays on its version.
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
  const restoreAgent = useAppStore((state) => state.restoreAgent)
  const cancel = useAppStore((state) => state.cancelAgentOperation)
  const id = agent.id
  const failed = agent.operation?.status === 'failed' ? agent.operation : null
  if (failed !== null) {
    return (
      <FailureButton
        onClick={() => onFailure({ kind: 'operation', agent })}
        testId={`agent-failure-${id}`}
      >
        {operationName(failed.kind)} failed
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
            {runningText(status)}
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
    case 'restore':
      return (
        <Button
          variant="outline"
          size="sm"
          onClick={() => restoreAgent(id)}
          data-testid={`agent-restore-${id}`}
        >
          Back to {status.version}
        </Button>
      )
    case 'cannot-check':
      return <StatusText testId={`agent-status-${id}`}>Couldn't check for updates</StatusText>
    case 'staying':
    case 'up-to-date':
      return null
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
          Update to {status.version}
        </Button>
      )
    case 'update-blocked':
      return <StatusText testId={`agent-status-${id}`}>{status.version} is out</StatusText>
  }
}

/**
 * An installed harness's row: the program alone, what it is doing or can do,
 * and its version, which opens its version menu. Its agents follow it (see
 * `HarnessAgents`).
 */
function AgentRow({
  tool,
  agent,
  target,
  onFailure,
  onUninstall,
}: {
  tool: CodingToolDefinition
  agent: AgentState
  target: InstallTarget | null
  onFailure: (failure: AgentFailure) => void
  onUninstall: (ask: UninstallAsk) => void
}) {
  const status = agentRowStatus(agent, target)
  const id = tool.id
  return (
    <div
      className="flex flex-col gap-2.5 px-4 py-3"
      data-testid={`agent-row-${id}`}
      data-status={agent.operation?.status === 'failed' ? 'failed' : status.kind}
    >
      {/* As tall as a button, so that rows line up whether they have one or not. */}
      <div className="flex min-h-7 items-center gap-3">
        <ToolIcon toolId={id} className="size-5 shrink-0" />
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="text-sm font-medium" data-testid={`agent-name-${id}`}>
            {tool.label}
          </span>
        </span>
        <AgentActions agent={agent} status={status} onFailure={onFailure} />
        <VersionMenu agent={agent} onUninstall={onUninstall} />
      </div>
      {status.kind === 'update-blocked' && (
        <p className="text-xs text-muted-foreground sm:pl-8">
          {joined([
            ...(status.node ? [nodeRequirementMessage(status.version, status.node)] : []),
            ...(status.writable ? [] : [FOLDER_NOT_WRITABLE_MESSAGE]),
          ])}
        </p>
      )}
    </div>
  )
}

/** What the confirmation of an uninstall says: the sessions it closes, the copy used instead. */
function uninstallText(
  agent: AgentState,
  ask: UninstallAsk,
  openSessions: number,
): { title: string; text: string } {
  const label = CODING_TOOLS.find((tool) => tool.id === agent.id)?.label ?? agent.id
  const several = agent.copies.length > 0
  const title =
    several && ask.version !== null ? `Uninstall ${label} ${ask.version}?` : `Uninstall ${label}?`
  const parts: string[] = []
  if (ask.inUse) {
    if (openSessions === 1) parts.push('Its open session will close.')
    if (openSessions > 1) parts.push(`Its ${openSessions} open sessions will close.`)
    const next = agent.copies[0]
    if (next !== undefined) {
      const version = next.version ?? 'Another copy'
      parts.push(
        next.runs
          ? `${version} will be used instead.`
          : `${version} will be used instead, but it doesn't run.`,
      )
    }
  }
  parts.push('Its settings and history stay.')
  return { title, text: parts.join(' ') }
}

/** Asks before a copy of an agent is uninstalled, saying what follows from it. */
function UninstallDialog({
  ask,
  onClose,
}: {
  ask: { id: CodingToolId; copy: UninstallAsk } | null
  onClose: () => void
}) {
  const agents = useAppStore((state) => state.agents)
  const sessions = useAppStore((state) => state.sessions)
  const uninstall = useAppStore((state) => state.uninstallAgent)
  // Kept while the dialog fades out after the answer.
  const [shown, setShown] = useState({ title: '', text: '' })
  const agent = ask === null ? undefined : agents?.agents.find((entry) => entry.id === ask.id)
  const openSessions =
    ask === null
      ? 0
      : sessions.filter((session) => session.toolId === ask.id && session.status !== 'exited')
          .length
  const current =
    ask === null || agent === undefined ? null : uninstallText(agent, ask.copy, openSessions)
  if (current !== null && (current.title !== shown.title || current.text !== shown.text)) {
    setShown(current)
  }
  return (
    <AlertDialog
      open={ask !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <AlertDialogContent data-testid="agent-uninstall-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{shown.title}</AlertDialogTitle>
          <AlertDialogDescription data-testid="agent-uninstall-text">
            {shown.text}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="agent-uninstall-cancel">Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              if (ask !== null) uninstall(ask.id, ask.copy.path)
              onClose()
            }}
            data-testid="agent-uninstall-confirm"
          >
            Uninstall
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * The harnesses that are not installed, each with its agents, which wait for
 * it, in a group that ends the list and opens to show them.
 */
function NotInstalledGroup({
  tools,
  states,
  target,
  onFailure,
}: {
  tools: CodingToolDefinition[]
  states: Map<string, AgentState>
  target: InstallTarget | null
  onFailure: (failure: AgentFailure) => void
}) {
  const [open, setOpen] = useState(false)
  const agents = useAppStore((state) => state.providers?.agents)
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
            const waiting = (agents ?? []).filter((made) => made.harness === tool.id)
            return (
              <div key={tool.id} data-testid={`agent-group-${tool.id}`}>
                <div
                  className="flex items-center gap-3 px-4 py-3"
                  data-testid={`agent-row-${tool.id}`}
                  data-status={
                    agent.operation?.status === 'failed'
                      ? 'failed'
                      : agentRowStatus(agent, target).kind
                  }
                >
                  <ToolIcon toolId={tool.id} className="size-5 shrink-0" />
                  {/* As tall as a button, so that rows line up whether they have one or not. */}
                  <span
                    className="flex min-h-7 min-w-0 flex-1 items-center text-sm font-medium"
                    data-testid={`agent-name-${tool.id}`}
                  >
                    {tool.label}
                  </span>
                  <AgentActions
                    agent={agent}
                    status={agentRowStatus(agent, target)}
                    onFailure={onFailure}
                  />
                </div>
                {waiting.map((made) => (
                  <DormantAgentItem key={made.id} agent={made} />
                ))}
              </div>
            )
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * The settings' Agents page: the default agent and the YOLO mode switch, the
 * installed harnesses, each with its agents and the command each new session
 * of theirs runs, Update all and Re-detect, and below a group of the harnesses
 * that are not installed.
 */
export function AgentsPage() {
  const agents = useAppStore((state) => state.agents)
  const launchSettings = useAppStore((state) => state.launchSettings)
  const enterAgentsPage = useAppStore((state) => state.enterAgentsPage)
  const detectAgents = useAppStore((state) => state.detectAgents)
  const updateAllAgents = useAppStore((state) => state.updateAllAgents)
  const setYoloMode = useAppStore((state) => state.setYoloMode)
  const [failure, setFailure] = useState<AgentFailure | null>(null)
  const [uninstall, setUninstall] = useState<{ id: CodingToolId; copy: UninstallAsk } | null>(null)
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
      <div className="h-11.5 shrink-0 [app-region:drag]" />
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 pt-2 pb-10">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
            <div className="flex items-center gap-2">
              {showUpdateAll && updateAllButton}
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
              <DefaultAgentPicker />
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
          </div>

          <div className="flex flex-col divide-y rounded-xl border" data-testid="agents-list">
            {installed.map((tool) => {
              const agent = states.get(tool.id) ?? unknownAgent(tool.id)
              return (
                // The harness's row, the program alone, and its agents below it.
                <div key={tool.id} data-testid={`agent-group-${tool.id}`}>
                  {agents === null ? (
                    <div
                      className="flex items-center gap-3 px-4 py-3"
                      data-testid={`agent-row-${tool.id}`}
                      data-status="checking"
                    >
                      <ToolIcon toolId={tool.id} className="size-5 shrink-0" />
                      <span className="min-w-0 flex-1 text-sm font-medium">{tool.label}</span>
                      <StatusText testId={`agent-status-${tool.id}`}>Checking…</StatusText>
                    </div>
                  ) : (
                    <AgentRow
                      tool={tool}
                      agent={agent}
                      target={target}
                      onFailure={setFailure}
                      onUninstall={(copy) => setUninstall({ id: tool.id, copy })}
                    />
                  )}
                  <HarnessAgents harness={tool.id} state={states.get(tool.id)} />
                </div>
              )
            })}
            <NotInstalledGroup
              tools={notInstalled}
              states={states}
              target={target}
              onFailure={setFailure}
            />
          </div>
        </div>
      </div>
      {failure !== null && (
        <FailureDialog
          failure={failure}
          npmUsable={target?.kind === 'npm'}
          onClose={() => setFailure(null)}
        />
      )}
      <UninstallDialog ask={uninstall} onClose={() => setUninstall(null)} />
    </div>
  )
}

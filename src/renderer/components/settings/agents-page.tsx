import { ChevronDownIcon, CopyIcon, RefreshCwIcon } from 'lucide-react'
import { cn } from 'cn'
import { useEffect, useState, type ReactNode } from 'react'
import {
  AGENTS_PATH_COMMAND,
  CANCELLED_MESSAGE,
  installMethodLabel,
  type AgentState,
  type InstallTarget,
} from '../../../shared/agents'
import { CODING_TOOLS, type CodingToolDefinition } from '../../../shared/tools'
import { agentRowStatus } from '../../lib/agent-status'
import { useAppStore } from '../../store/app-store'
import { ToolIcon } from '../tool-icon'
import { Button } from '../ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible'
import { Spinner } from '../ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

/** An agent before Hoot has looked for it. */
function unknownAgent(id: CodingToolDefinition['id']): AgentState {
  return {
    id,
    checking: true,
    installation: null,
    latest: null,
    latestFailed: false,
    operation: null,
  }
}

/** Where a path is cut when it does not fit: before its last two segments, or its last. */
function splitForTruncation(text: string): [head: string, tail: string] {
  const slashes = [...text.matchAll(/\//g)].map((match) => match.index)
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

/** Puts the line that adds Hoot's folder of agents to PATH on the clipboard. */
function CopyPathCommandButton({ testId }: { testId: string }) {
  const copy = useAppStore((state) => state.copyAgentsPathCommand)
  const label = 'Copy the command that adds ~/.hoot/agents/bin to PATH'
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            className="-my-1 ml-0.5 align-middle"
            onClick={copy}
            aria-label={label}
            data-testid={testId}
          />
        }
      >
        <CopyIcon />
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[min(36rem,90vw)]">
        <span>
          {label}: <code className="font-mono">{AGENTS_PATH_COMMAND}</code>
        </span>
      </TooltipContent>
    </Tooltip>
  )
}

/** Parts of a line, with a middle dot between each two. */
function joined(parts: ReactNode[]): ReactNode[] {
  return parts.flatMap((part, index) => (index === 0 ? [part] : [' · ', part]))
}

/**
 * The line below an agent's name: its version, how it was installed and where
 * its command is; or, when it is not installed, where Install puts it.
 */
function AgentDescription({ agent, target }: { agent: AgentState; target: InstallTarget | null }) {
  const id = agent.id
  const installation = agent.installation
  let content: ReactNode[]
  if (installation) {
    const method = installMethodLabel(installation.method)
    content = joined([
      ...(installation.version === null ? [] : [installation.version]),
      ...(method === null ? [] : [method]),
      <PathText
        key="path"
        shown={installation.displayPath}
        full={installation.path}
        testId={`agent-path-${id}`}
      />,
    ])
    if (installation.method === 'hoot') {
      content.push(<CopyPathCommandButton key="copy" testId={`agent-copy-path-${id}`} />)
    }
  } else if (target?.kind === 'npm') {
    content = [
      'Not installed · Install uses npm, into ',
      <PathText
        key="path"
        shown={target.displayPrefix}
        full={target.prefix}
        testId={`agent-install-target-${id}`}
      />,
    ]
  } else if (target?.kind === 'hoot') {
    content = ["Not installed · Install puts it in ~/.hoot/agents, only for Hoot's sessions"]
  } else {
    // Not looked for yet.
    content = [' ']
  }
  return (
    <p className="text-xs text-muted-foreground" data-testid={`agent-description-${id}`}>
      {content}
    </p>
  )
}

/** Shows or hides all of a command's output, in a box whose text can be selected. */
function OutputBox({ output, testId }: { output: string; testId: string }) {
  return (
    <pre
      className="max-h-72 overflow-y-auto rounded-md bg-muted px-2.5 py-2 font-mono text-xs break-all whitespace-pre-wrap text-foreground select-text"
      data-testid={testId}
    >
      {output}
    </pre>
  )
}

/**
 * Where an agent's operation is, below its description: the last line its
 * command wrote while it runs, and its result once it has ended, which stays
 * until the agent's next operation starts. A failure also shows the last
 * lines of what its command wrote, and all of it on request.
 */
function OperationLine({ agent }: { agent: AgentState }) {
  const [outputOpen, setOutputOpen] = useState(false)
  const operation = agent.operation
  const id = agent.id
  if (!operation) return null
  switch (operation.status) {
    case 'waiting':
      return null
    case 'running':
      return operation.lastLine === '' ? null : (
        <p
          className="truncate font-mono text-xs text-muted-foreground"
          title={operation.lastLine}
          data-testid={`agent-progress-${id}`}
        >
          {operation.lastLine}
        </p>
      )
    case 'succeeded':
      return (
        <p className="text-xs text-foreground" data-testid={`agent-result-${id}`}>
          {operation.message}
        </p>
      )
    case 'cancelled':
      return (
        <p className="text-xs text-muted-foreground" data-testid={`agent-result-${id}`}>
          {CANCELLED_MESSAGE}
        </p>
      )
    case 'failed':
      return (
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="text-xs text-destructive" data-testid={`agent-result-${id}`}>
            {operation.message}
          </p>
          {operation.tail.length > 0 && (
            <pre
              className="font-mono text-xs break-all whitespace-pre-wrap text-muted-foreground select-text"
              data-testid={`agent-output-tail-${id}`}
            >
              {operation.tail.join('\n')}
            </pre>
          )}
          {operation.output !== '' && (
            <Collapsible open={outputOpen} onOpenChange={setOutputOpen}>
              <CollapsibleTrigger
                render={
                  <Button
                    variant="link"
                    size="xs"
                    className="h-auto px-0 text-xs text-muted-foreground hover:text-foreground"
                    data-testid={`agent-show-output-${id}`}
                  />
                }
              >
                {outputOpen ? 'Hide output' : 'Show output'}
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-1.5">
                <OutputBox output={operation.output} testId={`agent-output-${id}`} />
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      )
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

/**
 * An agent's row: its icon and name, a line about its installation, and on
 * the right what it is doing or what can be done with it.
 */
function AgentRow({
  tool,
  agent,
  target,
}: {
  tool: CodingToolDefinition
  agent: AgentState
  target: InstallTarget | null
}) {
  const installAgent = useAppStore((state) => state.installAgent)
  const updateAgent = useAppStore((state) => state.updateAgent)
  const cancel = useAppStore((state) => state.cancelAgentOperation)
  const [versionOutputOpen, setVersionOutputOpen] = useState(false)
  const status = agentRowStatus(agent)
  const id = tool.id
  const statusId = `agent-status-${id}`
  // Once clicked, it waits for the command to end, which npm does once it has
  // put back what it changed.
  const cancelButton = (
    <Button
      variant="outline"
      size="sm"
      onClick={() => cancel(id)}
      disabled={agent.operation?.status === 'running' && agent.operation.cancelling}
      data-testid={`agent-cancel-${id}`}
    >
      Cancel
    </Button>
  )

  let right: ReactNode
  switch (status.kind) {
    case 'waiting':
      right = (
        <>
          <StatusText testId={statusId}>Waiting…</StatusText>
          {cancelButton}
        </>
      )
      break
    case 'running':
      right = (
        <>
          <Spinner className="size-3.5 text-muted-foreground" />
          <StatusText testId={statusId}>
            {status.operation === 'install' ? 'Installing…' : 'Updating…'}
          </StatusText>
          {cancelButton}
        </>
      )
      break
    case 'checking':
      right = <StatusText testId={statusId}>Checking…</StatusText>
      break
    case 'install':
      right = (
        <Button
          variant="outline"
          size="sm"
          onClick={() => installAgent(id)}
          data-testid={`agent-install-${id}`}
        >
          Install
        </Button>
      )
      break
    case 'does-not-run':
      right = (
        <CollapsibleTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="text-xs font-normal text-muted-foreground"
              data-testid={statusId}
            />
          }
        >
          Installed, but it doesn&apos;t run
          <ChevronDownIcon
            className={cn('transition-transform', versionOutputOpen && 'rotate-180')}
          />
        </CollapsibleTrigger>
      )
      break
    case 'cannot-check':
      right = <StatusText testId={statusId}>Couldn&apos;t check for updates</StatusText>
      break
    case 'up-to-date':
      right = <StatusText testId={statusId}>Up to date</StatusText>
      break
    case 'update-elsewhere':
      right = <StatusText testId={statusId}>Update it the way you installed it</StatusText>
      break
    case 'update':
      right = (
        <Button
          variant="outline"
          size="sm"
          onClick={() => updateAgent(id)}
          data-testid={`agent-update-${id}`}
        >
          Update to {status.version}
        </Button>
      )
      break
  }

  return (
    <Collapsible
      open={status.kind === 'does-not-run' && versionOutputOpen}
      onOpenChange={setVersionOutputOpen}
      className="flex flex-col gap-2 px-4 py-3"
      data-testid={`agent-row-${id}`}
      data-status={status.kind}
    >
      <div className="flex items-start gap-3">
        <ToolIcon toolId={id} className="mt-0.5 size-4 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-sm leading-5 font-medium" data-testid={`agent-name-${id}`}>
            {tool.label}
          </span>
          <AgentDescription agent={agent} target={target} />
          <OperationLine agent={agent} />
        </div>
        <div className="flex min-h-7 shrink-0 items-center gap-2">{right}</div>
      </div>
      {status.kind === 'does-not-run' && (
        <CollapsibleContent>
          <OutputBox
            output={agent.installation?.versionOutput ?? ''}
            testId={`agent-version-output-${id}`}
          />
        </CollapsibleContent>
      )}
    </Collapsible>
  )
}

/**
 * The settings' Agents page: Claude Code, Codex and OpenCode, whether and
 * how each is installed, its version and whether a newer one is out, with
 * Install and Update. Showing the page, and Re-detect, look for them again.
 */
export function AgentsPage() {
  const agents = useAppStore((state) => state.agents)
  const detectAgents = useAppStore((state) => state.detectAgents)
  useEffect(() => {
    detectAgents()
  }, [detectAgents])
  const states = new Map(agents?.agents.map((agent) => [agent.id, agent]))
  const checking = agents === null || agents.agents.some((agent) => agent.checking)

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-background" data-testid="agents-page">
      {/* The page's part of the window's top row, which drags the window. */}
      <div className="h-11 shrink-0 [app-region:drag]" />
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 pt-2 pb-10">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
            <Button
              variant="outline"
              size="sm"
              onClick={detectAgents}
              data-testid="agents-redetect"
            >
              <RefreshCwIcon className={cn(checking && 'animate-spin')} />
              Re-detect
            </Button>
          </div>
          <div className="flex flex-col divide-y rounded-xl border" data-testid="agents-list">
            {CODING_TOOLS.map((tool) => (
              <AgentRow
                key={tool.id}
                tool={tool}
                agent={states.get(tool.id) ?? unknownAgent(tool.id)}
                target={agents?.installTarget ?? null}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

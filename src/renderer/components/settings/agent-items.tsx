import { CheckIcon, MoreHorizontalIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { cn } from 'cn'
import { useState, type ReactNode } from 'react'
import type { AgentState } from '../../../shared/agents'
import { chatAgent, usableChatAgents } from '../../../shared/chats'
import { agentName, canDeleteAgent, FORMATS_OF, type Agent } from '../../../shared/providers'
import type { CodingToolId } from '../../../shared/tools'
import { useAppStore } from '../../store/app-store'
import { AgentIcon } from '../provider-icon'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import {
  AgentPanel,
  AgentSwitch,
  useAgentSummary,
  useIsDefault,
  type PanelTarget,
} from './agent-panel'

/** The name an agent shows (see `agentName`). */
function useAgentName(agent: Agent): string {
  return useAppStore((state) => (state.providers === null ? '' : agentName(agent, state.providers)))
}

/**
 * The ⋯ of an agent's row: make it the default agent, delete it, where it is
 * not the agent of its harness's own models, which Hoot keeps (see
 * `canDeleteAgent`). None for that agent while its harness is not
 * installed, which leaves it nothing to do.
 */
function AgentMenu({ agent, dormant = false }: { agent: Agent; dormant?: boolean }) {
  const isDefault = useIsDefault(agent.id)
  const setDefaultAgent = useAppStore((state) => state.setDefaultAgent)
  const deleteAgent = useAppStore((state) => state.deleteAgent)
  const deletable = useAppStore((state) => canDeleteAgent(agent, state.providers?.agents ?? []))
  if (dormant && !deletable) return null
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
      <DropdownMenuContent align="end" className="w-auto min-w-40">
        <DropdownMenuItem
          disabled={dormant || isDefault || !agent.enabled}
          onClick={() => setDefaultAgent(agent.id)}
        >
          <CheckIcon />
          Make default
        </DropdownMenuItem>
        {deletable && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => deleteAgent(agent.id)}
              data-testid={`agent-delete-${agent.id}`}
            >
              <Trash2Icon />
              Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Keeps a click or a key on a control of a row from opening the row. */
function RowControl({ children }: { children: ReactNode }) {
  return (
    <span
      className="inline-flex"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {children}
    </span>
  )
}

/**
 * An agent's row, below its harness's: its icon and name, Default, the model
 * and effort level it runs where its name does not say them, its ⋯ and its
 * switch. A click opens it in the panel.
 */
export function AgentItem({
  agent,
  state,
  selected,
  onOpen,
}: {
  agent: Agent
  /** Its harness's installation and the models its configuration offers. */
  state: AgentState | undefined
  /** Whether the panel shows it. */
  selected: boolean
  onOpen: () => void
}) {
  const isDefault = useIsDefault(agent.id)
  const name = useAgentName(agent)
  const summary = useAgentSummary(agent, state, name)
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
      className={cn(
        'flex min-h-11 cursor-default items-center gap-3 py-2 pr-4 pl-4 outline-none hover:bg-muted/40 focus-visible:bg-muted/40 sm:pl-12',
        selected && 'bg-muted/60 hover:bg-muted/60',
      )}
      data-testid={`agent-item-${agent.id}`}
      data-enabled={agent.enabled}
    >
      <AgentIcon
        toolId={agent.harness}
        providerId={agent.providerId}
        className={cn('size-4 shrink-0', !agent.enabled && 'opacity-50')}
      />
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span
          className={cn('truncate text-sm font-medium', !agent.enabled && 'text-muted-foreground')}
          data-testid={`agent-item-name-${agent.id}`}
        >
          {name}
        </span>
        {isDefault && (
          <Badge variant="secondary" data-testid={`agent-default-${agent.id}`}>
            Default
          </Badge>
        )}
      </span>
      {summary !== '' && (
        <span
          className={cn(
            'max-w-[45%] shrink truncate font-mono text-xs text-muted-foreground',
            !agent.enabled && 'opacity-60',
          )}
          data-testid={`agent-summary-${agent.id}`}
        >
          {summary}
        </span>
      )}
      <RowControl>
        <AgentMenu agent={agent} />
      </RowControl>
      <RowControl>
        <AgentSwitch agent={agent} />
      </RowControl>
    </div>
  )
}

/** The row of an agent of a harness that is not installed: its name and ⋯ alone. */
export function DormantAgentItem({ agent }: { agent: Agent }) {
  const name = useAgentName(agent)
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
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-muted-foreground">
        {name}
      </span>
      <AgentMenu agent={agent} dormant />
    </div>
  )
}

/**
 * A harness's agents, below its row, each opening in the panel, and New
 * agent, which makes one there on a provider of the user's, for a harness
 * that runs any.
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
  const [target, setTarget] = useState<PanelTarget>(null)
  const offersNew = FORMATS_OF[harness].length > 0
  return (
    <div
      className={cn('flex flex-col', (agents.length > 0 || offersNew) && '-mt-1 pb-1')}
      data-testid={`harness-agents-${harness}`}
    >
      {agents.map((agent) => (
        <AgentItem
          key={agent.id}
          agent={agent}
          state={state}
          selected={target?.id === agent.id}
          onOpen={() => setTarget({ id: agent.id })}
        />
      ))}
      {offersNew && (
        <button
          type="button"
          onClick={() => setTarget({ id: null })}
          className="flex h-10 items-center gap-3 pr-4 pl-4 text-left text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground sm:pl-12"
          data-testid={`new-agent-${harness}`}
        >
          <PlusIcon className="size-4" />
          New agent
        </button>
      )}
      <AgentPanel harness={harness} state={state} target={target} onTargetChange={setTarget} />
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

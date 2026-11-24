import { Fragment, type ComponentType, type ReactNode } from 'react'
import { toast } from 'sonner'
import { agentsChecking, chatAgent, usableChatAgents } from '../../shared/chats'
import { agentName } from '../../shared/providers'
import { useAppStore } from '../store/app-store'
import { AgentIcon } from './provider-icon'
import { Badge } from './ui/badge'

interface ItemProps {
  children?: ReactNode
  disabled?: boolean
  onClick?: () => void
  className?: string
  'data-testid'?: string
}

export interface ChatMenuComponents {
  Item: ComponentType<ItemProps>
  Separator: ComponentType
}

/**
 * The agent choices of the New chat menu: the agents that can start a chat,
 * grouped by harness, each group apart from the next by a line, with the
 * agent a new chat starts with marked Default. Without one, the menu's only
 * item opens the Agents page, where an agent can be set up. Until the first
 * detection has finished, the menu only says that the agents are being
 * checked for.
 */
export function ChatAgentMenuEntries({
  components,
  onSelect,
  /** The prefix of the items' test ids, which tells a chat's menu from a worktree's. */
  testId = 'chat-agent',
  /** What the menu says when no agent can start a session. */
  failure = 'Could not start a chat.',
}: {
  components: ChatMenuComponents
  /** Called with the agent's id. */
  onSelect: (agentId: string) => void
  testId?: string
  failure?: string
}) {
  const tools = useAppStore((state) => state.tools)
  const providers = useAppStore((state) => state.providers)
  const launchSettings = useAppStore((state) => state.launchSettings)
  const showSettings = useAppStore((state) => state.showSettings)
  const { Item, Separator } = components

  if (agentsChecking(tools, providers) || providers === null) {
    return (
      <Item disabled data-testid={`${testId}s-checking`}>
        Checking…
      </Item>
    )
  }

  const usable = usableChatAgents(tools, providers)
  if (usable.length === 0) {
    return (
      <Item
        onClick={() => {
          toast.error(failure, { description: 'Set up an agent in the Agents page first.' })
          showSettings('agents')
        }}
        data-testid={`${testId}s-setup`}
      >
        Set up an Agent…
      </Item>
    )
  }

  const marked = chatAgent(tools, providers, launchSettings)
  return (
    <>
      {usable.map((agent, index) => (
        <Fragment key={agent.id}>
          {index > 0 && usable[index - 1]?.harness !== agent.harness && <Separator />}
          <Item onClick={() => onSelect(agent.id)} data-testid={`${testId}-${agent.id}`}>
            <AgentIcon toolId={agent.harness} providerId={agent.providerId} className="size-4" />
            <span className="truncate">{agentName(agent, providers)}</span>
            {marked?.id === agent.id && (
              <Badge
                variant="secondary"
                className="ml-auto"
                data-testid={`${testId}-default-${agent.id}`}
              >
                Default
              </Badge>
            )}
          </Item>
        </Fragment>
      ))}
    </>
  )
}

import type { ComponentType, ReactNode } from 'react'
import { toast } from 'sonner'
import { defaultAgentUsable, firstDetectionRunning, usableChatAgents } from '../../shared/chats'
import { CODING_TOOL_IDS, getTool, type CodingToolId } from '../../shared/tools'
import { useAppStore } from '../store/app-store'
import { ToolIcon } from './tool-icon'
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
}

/**
 * The agent choices of the New chat menu: the agents that can start a chat,
 * in the order Claude Code, Codex and OpenCode, with the default agent marked
 * Default while it can. Without one, the menu's only item opens the Agents
 * page, where an agent can be installed or turned on. Until the first
 * detection has finished, the menu only says that the agents are being
 * checked for.
 */
export function ChatAgentMenuEntries({
  components,
  onSelect,
}: {
  components: ChatMenuComponents
  onSelect: (toolId: CodingToolId) => void
}) {
  const tools = useAppStore((state) => state.tools)
  const launchSettings = useAppStore((state) => state.launchSettings)
  const showSettings = useAppStore((state) => state.showSettings)
  const { Item } = components

  if (firstDetectionRunning(tools)) {
    return (
      <Item disabled data-testid="chat-agents-checking">
        Checking…
      </Item>
    )
  }

  const usable = usableChatAgents(tools, launchSettings)
  if (usable.length === 0) {
    return (
      <Item
        onClick={() => {
          toast.error('Could not start a chat.', {
            description: 'Install an agent or turn one on in the Agents page first.',
          })
          showSettings('agents')
        }}
        data-testid="chat-agents-setup"
      >
        Set up an Agent…
      </Item>
    )
  }

  const marked = defaultAgentUsable(tools, launchSettings)
  return (
    <>
      {CODING_TOOL_IDS.filter((id) => usable.includes(id)).map((id) => (
        <Item key={id} onClick={() => onSelect(id)} data-testid={`chat-agent-${id}`}>
          <ToolIcon toolId={id} />
          <span>{getTool(id).label}</span>
          {marked && (launchSettings?.defaultAgent ?? 'claude') === id && (
            <Badge variant="secondary" className="ml-auto" data-testid={`chat-agent-default-${id}`}>
              Default
            </Badge>
          )}
        </Item>
      ))}
    </>
  )
}

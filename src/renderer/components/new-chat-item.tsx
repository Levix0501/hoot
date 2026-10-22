import { MessageSquarePlusIcon, MoreHorizontalIcon } from 'lucide-react'
import { ChatAgentMenuEntries } from './chat-agent-menu'
import { contextComponents, dropdownComponents } from './project-item'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from './ui/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from './ui/dropdown-menu'
import { SidebarMenuAction, SidebarMenuButton, SidebarMenuItem } from './ui/sidebar'
import { useAppStore } from '../store/app-store'

/**
 * The sidebar's New chat row, below Issues: clicking it opens a chat with the
 * default agent, and the ⋯ at its right end, or a right click on the row,
 * opens the agents a chat can start with.
 */
export function NewChatItem() {
  const newChat = useAppStore((state) => state.newChat)
  return (
    <ContextMenu>
      <DropdownMenu>
        <ContextMenuTrigger
          render={<SidebarMenuItem data-testid="new-chat" />}
          className="group/menu-item relative"
        >
          <SidebarMenuButton
            onClick={() => void newChat()}
            data-testid="new-chat-button"
            className="group-hover/menu-item:bg-sidebar-accent group-hover/menu-item:text-sidebar-accent-foreground group-has-data-[sidebar=menu-action]/menu-item:pr-8"
          >
            <MessageSquarePlusIcon />
            <span className="min-w-0 flex-1 truncate">New chat</span>
          </SidebarMenuButton>
          <DropdownMenuTrigger
            render={
              <SidebarMenuAction
                showOnHover
                aria-label="Choose an agent"
                title="Choose an Agent"
                data-testid="new-chat-agents"
              />
            }
          >
            <MoreHorizontalIcon />
          </DropdownMenuTrigger>
        </ContextMenuTrigger>
        <DropdownMenuContent align="start" className="w-auto min-w-48">
          <ChatAgentMenuEntries
            components={dropdownComponents}
            onSelect={(toolId) => void newChat(toolId)}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      <ContextMenuContent className="w-auto min-w-48">
        <ChatAgentMenuEntries
          components={contextComponents}
          onSelect={(toolId) => void newChat(toolId)}
        />
      </ContextMenuContent>
    </ContextMenu>
  )
}

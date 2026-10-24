import { PencilIcon, XIcon } from 'lucide-react'
import { chatName, type ChatInfo } from '../../shared/chats'
import { sessionState, stateDescription } from '../lib/session-state'
import { currentSessionId, isSessionRunning, useAppStore } from '../store/app-store'
import { StateLight } from './state-light'
import { ToolIcon } from './tool-icon'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from './ui/context-menu'
import { SidebarMenuButton, SidebarMenuItem } from './ui/sidebar'

/**
 * A chat's row in the sidebar's Chats group: the agent's icon, the chat's
 * name and, while its agent runs, at its right end, the light of the agent's
 * state. Click it to show the chat, and double-click it or use its context
 * menu to rename it; close a running chat's agent from its context menu.
 */
export function ChatItem({ chat }: { chat: ChatInfo }) {
  const running = useAppStore((state) =>
    state.sessions.find((session) => session.chatId === chat.id && isSessionRunning(session)),
  )
  const current = useAppStore((state) => {
    const id = currentSessionId(state)
    return (
      id !== null && state.sessions.some((entry) => entry.id === id && entry.chatId === chat.id)
    )
  })
  const openChat = useAppStore((state) => state.openChat)
  const startRenamingChat = useAppStore((state) => state.startRenamingChat)
  const closeChat = useAppStore((state) => state.closeChat)
  const name = chatName(chat)
  const state = running ? sessionState(running) : null

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={<SidebarMenuItem />}
        data-testid="chat-item"
        data-chat-id={chat.id}
        data-tool={chat.toolId}
        data-running={running !== undefined}
        data-current={current}
      >
        <SidebarMenuButton
          render={<button type="button" />}
          isActive={current}
          className="w-full cursor-default text-left"
          onClick={() => openChat(chat.id)}
          onDoubleClick={() => startRenamingChat(chat.id)}
          data-testid="chat-item-button"
        >
          <ToolIcon toolId={chat.toolId} />
          <span
            className="min-w-0 flex-1 truncate"
            data-session-name=""
            data-testid="chat-item-name"
          >
            {name}
          </span>
          {running && state !== null && (
            <>
              <StateLight state={state} testId="chat-light" />
              <span className="sr-only">{stateDescription(state, running.exit)}</span>
            </>
          )}
        </SidebarMenuButton>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-auto min-w-36">
        <ContextMenuItem
          onClick={() => startRenamingChat(chat.id)}
          data-testid="chat-context-rename"
        >
          <PencilIcon />
          Rename…
        </ContextMenuItem>
        {running && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              disabled={running.closing}
              onClick={() => closeChat(chat.id)}
              data-testid="chat-context-close"
            >
              <XIcon />
              Close
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

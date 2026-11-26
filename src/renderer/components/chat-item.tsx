import { chatName, type ChatInfo } from '../../shared/chats'
import { sessionState, stateDescription } from '../lib/session-state'
import { cn } from '../lib/utils'
import { currentSessionId, isSessionRunning, useAppStore } from '../store/app-store'
import {
  ArchiveButtonRoom,
  LIGHT_UNDER_CLOSE,
  ROW_WITH_CLOSE,
  SessionArchiveButton,
  SessionCloseButton,
} from './session-row-actions'
import { ChatMenu } from './session-menus'
import { StateLight } from './state-light'
import { AgentIcon } from './provider-icon'
import { ContextMenu, ContextMenuTrigger } from './ui/context-menu'
import { SidebarMenuButton, SidebarMenuItem } from './ui/sidebar'

/**
 * A chat's row in the sidebar's Chats group: the agent's icon, the chat's
 * name and, while it is open, as its tab shows, at its right end, the light
 * of the agent's state. While the pointer is on the row, its archive button
 * shows at the end of the name, and the light of an open chat gives way to
 * its close button. Click it to show the chat, continuing its conversation
 * when it is not open, and double-click it or use its context menu to rename
 * it. Its context menu also closes an open chat; its archive button takes the
 * chat out of the sidebar, to the settings' Archive page.
 */
export function ChatItem({ chat }: { chat: ChatInfo }) {
  const open = useAppStore((state) => state.sessions.find((session) => session.chatId === chat.id))
  const current = useAppStore((state) => {
    const id = currentSessionId(state)
    return (
      id !== null && state.sessions.some((entry) => entry.id === id && entry.chatId === chat.id)
    )
  })
  const openChat = useAppStore((state) => state.openChat)
  const startRenamingChat = useAppStore((state) => state.startRenamingChat)
  const name = chatName(chat)
  const state = open ? sessionState(open) : null

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={<SidebarMenuItem />}
        data-testid="chat-item"
        data-chat-id={chat.id}
        data-tool={chat.toolId}
        data-running={open !== undefined && isSessionRunning(open)}
        data-current={current}
      >
        <SidebarMenuButton
          render={<button type="button" />}
          isActive={current}
          className={cn('w-full cursor-default text-left', ROW_WITH_CLOSE)}
          onClick={() => openChat(chat.id)}
          onDoubleClick={() => startRenamingChat(chat.id)}
          data-testid="chat-item-button"
        >
          <AgentIcon toolId={chat.toolId} providerId={chat.providerId} className="size-4" />
          <span
            className="min-w-0 flex-1 truncate"
            data-session-name=""
            data-testid="chat-item-name"
          >
            {name}
          </span>
          <ArchiveButtonRoom open={open !== undefined} />
          {open && state !== null && (
            <>
              <StateLight state={state} className={LIGHT_UNDER_CLOSE} testId="chat-light" />
              <span className="sr-only">{stateDescription(state, open.exit)}</span>
            </>
          )}
        </SidebarMenuButton>
        <SessionArchiveButton
          id={chat.id}
          name={name}
          open={open !== undefined}
          testId="chat-item-archive"
        />
        {open && <SessionCloseButton session={open} name={name} testId="chat-item-close" />}
      </ContextMenuTrigger>
      <ChatMenu chatId={chat.id} testId="chat-context" />
    </ContextMenu>
  )
}

import { PencilIcon, XIcon } from 'lucide-react'
import { chatName, type SavedSessionInfo } from '../../shared/chats'
import { sessionState, stateTooltip } from '../lib/session-state'
import { currentSessionId, isSessionRunning, useAppStore } from '../store/app-store'
import { StateLightWithTooltip } from './state-light'
import { ToolIcon } from './tool-icon'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from './ui/context-menu'
import { SidebarMenuSubButton, SidebarMenuSubItem } from './ui/sidebar'

/**
 * A saved session's row below its worktree: the agent's icon and the
 * session's name, and while its agent runs, the light of its state. Click it
 * to show the session, continuing its conversation when its agent does not
 * run; double-click it or use its context menu to rename it, and close a
 * running one from its context menu.
 */
export function SavedSessionItem({ saved }: { saved: SavedSessionInfo }) {
  const running = useAppStore((state) =>
    state.sessions.find(
      (session) => session.savedSessionId === saved.id && isSessionRunning(session),
    ),
  )
  const current = useAppStore((state) => {
    const id = currentSessionId(state)
    return (
      id !== null &&
      state.sessions.some((entry) => entry.id === id && entry.savedSessionId === saved.id)
    )
  })
  const open = useAppStore((state) => state.openSavedSession)
  const startRenaming = useAppStore((state) => state.startRenamingSavedSession)
  const close = useAppStore((state) => state.closeSavedSession)
  const name = chatName(saved)
  const state = running ? sessionState(running) : null

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={<SidebarMenuSubItem />}
        data-testid="saved-session-item"
        data-saved-session-id={saved.id}
        data-tool={saved.toolId}
        data-running={running !== undefined}
        data-current={current}
      >
        <SidebarMenuSubButton
          render={<button type="button" />}
          isActive={current}
          className="w-full cursor-default text-left"
          onClick={() => open(saved.id)}
          onDoubleClick={() => startRenaming(saved.id)}
          data-testid="saved-session-item-button"
        >
          {running && state !== null && (
            <StateLightWithTooltip
              state={state}
              tooltip={stateTooltip(state, running.exit)}
              testId="saved-session-light"
            />
          )}
          <ToolIcon toolId={saved.toolId} />
          <span
            className="min-w-0 flex-1 truncate"
            title={name}
            data-session-name=""
            data-testid="saved-session-item-name"
          >
            {name}
          </span>
        </SidebarMenuSubButton>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-auto min-w-36">
        <ContextMenuItem
          onClick={() => startRenaming(saved.id)}
          data-testid="saved-session-context-rename"
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
              onClick={() => close(saved.id)}
              data-testid="saved-session-context-close"
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

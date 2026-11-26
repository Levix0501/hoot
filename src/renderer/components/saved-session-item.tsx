import { chatName, type SavedSessionInfo } from '../../shared/chats'
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
import { SavedSessionMenu } from './session-menus'
import { StateLight } from './state-light'
import { AgentIcon } from './provider-icon'
import { ContextMenu, ContextMenuTrigger } from './ui/context-menu'
import { SidebarMenuButton, SidebarMenuItem } from './ui/sidebar'

/**
 * A saved session's row below its worktree's, or below its project's Local
 * row: the agent's icon, 12px further in than that row's chevron; the
 * session's name; both smaller than that row's, and the name, unless the row
 * is pointed at or selected, lighter; and while it is open, as its tab shows,
 * at its right end, the light of its state. While the pointer is on the row,
 * its archive button shows at the end of the name, and the light of an open
 * one gives way to its close button. Click it to show the session,
 * continuing its conversation when it is not open; double-click it or use
 * its context menu to rename it. Its context menu also closes an open one;
 * its archive button takes the session out of the sidebar, to the settings'
 * Archive page.
 */
export function SavedSessionItem({ saved }: { saved: SavedSessionInfo }) {
  const open = useAppStore((state) =>
    state.sessions.find((session) => session.savedSessionId === saved.id),
  )
  const current = useAppStore((state) => {
    const id = currentSessionId(state)
    return (
      id !== null &&
      state.sessions.some((entry) => entry.id === id && entry.savedSessionId === saved.id)
    )
  })
  const openSaved = useAppStore((state) => state.openSavedSession)
  const startRenaming = useAppStore((state) => state.startRenamingSavedSession)
  const name = chatName(saved)
  const state = open ? sessionState(open) : null

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={<SidebarMenuItem />}
        data-testid="saved-session-item"
        data-saved-session-id={saved.id}
        data-tool={saved.toolId}
        data-running={open !== undefined && isSessionRunning(open)}
        data-current={current}
      >
        <SidebarMenuButton
          render={<button type="button" />}
          isActive={current}
          className={cn('cursor-default pl-8 text-xs text-sidebar-foreground/70', ROW_WITH_CLOSE)}
          onClick={() => openSaved(saved.id)}
          onDoubleClick={() => startRenaming(saved.id)}
          data-testid="saved-session-item-button"
        >
          {/* As much smaller as its name, centered where a full-size icon would be. */}
          <AgentIcon
            toolId={saved.toolId}
            providerId={saved.providerId}
            className="mx-px size-3.5"
          />
          <span
            className="min-w-0 flex-1 truncate"
            data-session-name=""
            data-testid="saved-session-item-name"
          >
            {name}
          </span>
          <ArchiveButtonRoom open={open !== undefined} />
          {open && state !== null && (
            <>
              <StateLight
                state={state}
                className={LIGHT_UNDER_CLOSE}
                testId="saved-session-light"
              />
              <span className="sr-only">{stateDescription(state, open.exit)}</span>
            </>
          )}
        </SidebarMenuButton>
        {/* As much smaller as the row's icon. */}
        <SessionArchiveButton
          id={saved.id}
          name={name}
          open={open !== undefined}
          className="[&>svg]:size-3.5"
          testId="saved-session-item-archive"
        />
        {open && (
          <SessionCloseButton
            session={open}
            name={name}
            className="[&>svg]:size-3.5"
            testId="saved-session-item-close"
          />
        )}
      </ContextMenuTrigger>
      <SavedSessionMenu savedId={saved.id} testId="saved-session-context" />
    </ContextMenu>
  )
}

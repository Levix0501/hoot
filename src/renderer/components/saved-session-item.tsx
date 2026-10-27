import { chatName, type SavedSessionInfo } from '../../shared/chats'
import { sessionState, stateDescription } from '../lib/session-state'
import { currentSessionId, isSessionRunning, useAppStore } from '../store/app-store'
import { SavedSessionMenu } from './session-menus'
import { StateLight } from './state-light'
import { ToolIcon } from './tool-icon'
import { ContextMenu, ContextMenuTrigger } from './ui/context-menu'
import { SidebarMenuButton, SidebarMenuItem } from './ui/sidebar'

/**
 * A saved session's row below its worktree's: the agent's icon, 12px further
 * in than the worktree's; the session's name; both smaller than the
 * worktree's, and the name, unless the row is pointed at or selected,
 * lighter; and while its agent runs, at its right end, the light of its
 * state. Click it to show the session, continuing its conversation when its
 * agent does not run; double-click it or use its context menu to rename it.
 * Its context menu also closes a running one, and deletes it.
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
  const name = chatName(saved)
  const state = running ? sessionState(running) : null

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={<SidebarMenuItem />}
        data-testid="saved-session-item"
        data-saved-session-id={saved.id}
        data-tool={saved.toolId}
        data-running={running !== undefined}
        data-current={current}
      >
        <SidebarMenuButton
          render={<button type="button" />}
          isActive={current}
          className="cursor-default pl-8 text-xs text-sidebar-foreground/70"
          onClick={() => open(saved.id)}
          onDoubleClick={() => startRenaming(saved.id)}
          data-testid="saved-session-item-button"
        >
          {/* As much smaller as its name, centered where a full-size icon would be. */}
          <ToolIcon toolId={saved.toolId} className="mx-px size-3.5" />
          <span
            className="min-w-0 flex-1 truncate"
            data-session-name=""
            data-testid="saved-session-item-name"
          >
            {name}
          </span>
          {running && state !== null && (
            <>
              <StateLight state={state} testId="saved-session-light" />
              <span className="sr-only">{stateDescription(state, running.exit)}</span>
            </>
          )}
        </SidebarMenuButton>
      </ContextMenuTrigger>
      <SavedSessionMenu savedId={saved.id} testId="saved-session-context" />
    </ContextMenu>
  )
}

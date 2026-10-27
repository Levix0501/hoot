import { PencilIcon, XIcon } from 'lucide-react'
import { sessionName } from '../../shared/session'
import {
  currentSessionId,
  focusAfterOverlay,
  useAppStore,
  type UiSession,
} from '../store/app-store'
import { sessionState, stateDescription } from '../lib/session-state'
import { cn } from '../lib/utils'
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
 * A session's row in the sidebar, below its worktree's, or for a session in
 * its project's own folder, below its project's: the tool's icon, 12px
 * further in than that row's icon; the session's name; both smaller than
 * that row's, and the name, unless the row is pointed at or selected,
 * lighter; and, at its right end, the light of the session's state. Click it
 * to show the session, and double-click it or use its context menu to rename
 * it in a dialog; close it from its context menu.
 */
export function SessionItem({ session }: { session: UiSession }) {
  const current = useAppStore((state) => currentSessionId(state) === session.id)
  const selectSession = useAppStore((state) => state.selectSession)
  const startRenaming = useAppStore((state) => state.startRenaming)
  const requestCloseSession = useAppStore((state) => state.requestCloseSession)
  const name = sessionName(session)
  const state = sessionState(session)

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={<SidebarMenuItem />}
        className={cn(session.closing && 'opacity-60')}
        data-testid="session-item"
        data-session-id={session.id}
        data-status={session.status}
        data-tool={session.toolId}
        data-state={state}
        data-current={current}
      >
        <SidebarMenuButton
          render={<button type="button" />}
          isActive={current}
          className={cn(
            'cursor-default text-xs text-sidebar-foreground/70',
            session.worktreePath === null ? 'pl-5' : 'pl-8',
          )}
          onClick={() => selectSession(session.id)}
          onDoubleClick={() => startRenaming(session.id)}
          data-testid="session-item-button"
        >
          {/* As much smaller as its name, centered where a full-size icon would be. */}
          <ToolIcon toolId={session.toolId} className="mx-px size-3.5" />
          <span
            className="min-w-0 flex-1 truncate"
            data-session-name=""
            data-testid="session-item-name"
          >
            {name}
          </span>
          <StateLight state={state} testId="session-light" />
          <span className="sr-only">{stateDescription(state, session.exit)}</span>
        </SidebarMenuButton>
      </ContextMenuTrigger>
      <ContextMenuContent
        className="w-auto min-w-36"
        // The rename dialog takes the focus; otherwise it returns to the terminal.
        finalFocus={() =>
          useAppStore.getState().renamingSessionId === session.id ? false : focusAfterOverlay()
        }
      >
        <ContextMenuItem
          onClick={() => startRenaming(session.id)}
          data-testid="session-context-rename"
        >
          <PencilIcon />
          Rename…
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          disabled={session.closing}
          onClick={() => requestCloseSession(session.id)}
          data-testid="session-context-close"
        >
          <XIcon />
          Close
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

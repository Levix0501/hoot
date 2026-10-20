import { PencilIcon, XIcon } from 'lucide-react'
import { sessionName } from '../../shared/session'
import {
  currentSessionId,
  focusAfterOverlay,
  useAppStore,
  type UiSession,
} from '../store/app-store'
import { sessionState, stateTooltip } from '../lib/session-state'
import { cn } from '../lib/utils'
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
 * A session's row in the sidebar: the light of the session's state, which
 * names the state when pointed at, the tool's icon and the session's name.
 * Click it to show the session, double-click it or use its context menu to
 * rename it in a dialog, and close it with the button that appears on hover
 * or from the context menu.
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
        render={<SidebarMenuSubItem />}
        className={cn(session.closing && 'opacity-60')}
        data-testid="session-item"
        data-session-id={session.id}
        data-status={session.status}
        data-tool={session.toolId}
        data-state={state}
        data-current={current}
      >
        <SidebarMenuSubButton
          render={<button type="button" />}
          isActive={current}
          // Room at its right end for the close button, which lies over it; highlighted also
          // while the pointer is on that button.
          className="w-full cursor-default pr-8.5 text-left group-hover/menu-sub-item:bg-sidebar-accent group-hover/menu-sub-item:text-sidebar-accent-foreground"
          onClick={() => selectSession(session.id)}
          onDoubleClick={() => startRenaming(session.id)}
          data-testid="session-item-button"
        >
          <StateLightWithTooltip
            state={state}
            tooltip={stateTooltip(state, session.exit)}
            testId="session-light"
          />
          <ToolIcon toolId={session.toolId} />
          <span
            className="min-w-0 flex-1 truncate"
            title={name}
            data-session-name=""
            data-testid="session-item-name"
          >
            {name}
          </span>
        </SidebarMenuSubButton>
        <button
          type="button"
          className="invisible absolute top-0.5 right-0.5 flex size-6 items-center justify-center rounded-md text-sidebar-foreground/70 outline-hidden group-focus-within/menu-sub-item:visible group-hover/menu-sub-item:visible hover:bg-sidebar-foreground/10 hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:opacity-50 [&>svg]:size-3.5"
          disabled={session.closing}
          onClick={() => requestCloseSession(session.id)}
          aria-label="Close Session"
          title="Close Session"
          data-testid="session-item-close"
        >
          <XIcon />
        </button>
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

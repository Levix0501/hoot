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
 * Click it to show the session, and double-click it or use its context menu
 * to rename it in a dialog; close it from its context menu.
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
          className="w-full cursor-default text-left"
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

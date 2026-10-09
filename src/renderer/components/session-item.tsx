import { PencilIcon, XIcon } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { describeExit, describeExitCompact, sessionName } from '../../shared/session'
import {
  focusAfterOverlay,
  focusCurrentTerminal,
  useAppStore,
  type UiSession,
} from '../store/app-store'
import { cn } from '../lib/utils'
import { ToolIcon } from './tool-icon'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from './ui/context-menu'
import { Input } from './ui/input'
import { SidebarMenuSubButton, SidebarMenuSubItem } from './ui/sidebar'

/** A green dot while the session runs; how it ended once it has. */
function SessionRowStatus({ session }: { session: UiSession }) {
  if (session.status !== 'exited' || !session.exit) {
    return (
      <span
        className="mr-0.5 size-2 shrink-0 rounded-full bg-emerald-500"
        title="Running"
        data-testid="session-item-status"
        data-state="running"
      >
        <span className="sr-only">Running</span>
      </span>
    )
  }
  return (
    <span
      className={cn(
        'shrink-0 text-xs',
        session.exit.abnormal ? 'font-medium text-destructive' : 'text-muted-foreground',
      )}
      title={describeExit(session.exit)}
      data-testid="session-item-status"
      data-state="exited"
      data-abnormal={session.exit.abnormal}
    >
      {describeExitCompact(session.exit)}
    </span>
  )
}

/** The field that replaces a session's name while the user renames it. */
function RenameField({ session }: { session: UiSession }) {
  const finishRenaming = useAppStore((state) => state.finishRenaming)
  const [value, setValue] = useState(() => sessionName(session))
  const inputRef = useRef<HTMLInputElement>(null)
  const finished = useRef(false)

  useLayoutEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const finish = (name: string | null, focusTerminal: boolean) => {
    if (finished.current) return
    finished.current = true
    finishRenaming(session.id, name)
    if (focusTerminal) focusCurrentTerminal()
  }

  return (
    <div className="flex h-7 min-w-0 flex-1 items-center gap-2 px-2">
      <ToolIcon toolId={session.toolId} className="size-4 shrink-0" />
      <Input
        ref={inputRef}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          // Keys that confirm or cancel an input method's composition are not ours.
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Enter') {
            event.preventDefault()
            // An empty name gives the session its default name again.
            finish(value, true)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            finish(null, true)
          }
        }}
        onBlur={() => finish(value, false)}
        spellCheck={false}
        aria-label="Session name"
        className="h-6 rounded-md px-1.5 md:text-sm"
        data-testid="session-rename-input"
      />
    </div>
  )
}

/**
 * A session's row in the sidebar: click it to show the session, double-click
 * it or use its context menu to rename it, and close it with the button that
 * appears on hover or from the context menu.
 */
export function SessionItem({ session }: { session: UiSession }) {
  const current = useAppStore((state) => state.currentSessionId === session.id)
  const renaming = useAppStore((state) => state.renamingSessionId === session.id)
  const selectSession = useAppStore((state) => state.selectSession)
  const startRenaming = useAppStore((state) => state.startRenaming)
  const requestCloseSession = useAppStore((state) => state.requestCloseSession)
  const name = sessionName(session)

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={<SidebarMenuSubItem />}
        className={cn('flex items-center gap-0.5', session.closing && 'opacity-60')}
        data-testid="session-item"
        data-session-id={session.id}
        data-status={session.status}
        data-tool={session.toolId}
        data-current={current}
      >
        {renaming ? (
          <RenameField session={session} />
        ) : (
          <SidebarMenuSubButton
            render={<button type="button" />}
            isActive={current}
            className="min-w-0 flex-1 cursor-default text-left"
            onClick={() => selectSession(session.id)}
            onDoubleClick={() => startRenaming(session.id)}
            data-testid="session-item-button"
          >
            <ToolIcon toolId={session.toolId} />
            <span
              className="min-w-0 flex-1 truncate"
              title={name}
              data-session-name=""
              data-testid="session-item-name"
            >
              {name}
            </span>
            <SessionRowStatus session={session} />
          </SidebarMenuSubButton>
        )}
        {!renaming && (
          <button
            type="button"
            className="invisible flex size-6 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/70 outline-hidden group-focus-within/menu-sub-item:visible group-hover/menu-sub-item:visible hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:opacity-50 [&>svg]:size-3.5"
            disabled={session.closing}
            onClick={() => requestCloseSession(session.id)}
            aria-label="Close Session"
            title="Close Session"
            data-testid="session-item-close"
          >
            <XIcon />
          </button>
        )}
      </ContextMenuTrigger>
      <ContextMenuContent
        className="w-auto min-w-36"
        // Renaming keeps the focus in its field; otherwise it returns to the terminal.
        finalFocus={() =>
          useAppStore.getState().renamingSessionId === session.id ? false : focusAfterOverlay()
        }
      >
        <ContextMenuItem
          onClick={() => startRenaming(session.id)}
          data-testid="session-context-rename"
        >
          <PencilIcon />
          Rename
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

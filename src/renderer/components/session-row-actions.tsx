import { ArchiveIcon, XIcon } from 'lucide-react'
import { cn } from '../lib/utils'
import { useAppStore, type UiSession } from '../store/app-store'
import { SidebarMenuAction } from './ui/sidebar'

/**
 * The class of the button of a session's row in the sidebar: with a button
 * over the row, the light keeps its place at the row's right end, where the
 * buttons show over it.
 */
export const ROW_WITH_CLOSE = 'group-has-data-[sidebar=menu-action]/menu-item:pr-2'

/**
 * The class of the light of a session's row in the sidebar, which gives way
 * to the row's close button while the pointer is on the row or the keyboard
 * focus in it; it keeps its room meanwhile, where the close button shows.
 */
export const LIGHT_UNDER_CLOSE =
  'group-hover/menu-item:invisible group-has-focus-visible/menu-item:invisible'

/**
 * The room a chat's or a saved session's row in the sidebar makes for its
 * archive button while the button shows, right after the name, taking back
 * the gap before it: the name ends 8px before the button then, as a
 * worktree's before its buttons, and runs on to the light, or to the row's
 * end, the rest of the time. An open session's archive button shows left of
 * the light, which its close button shows over.
 */
export function ArchiveButtonRoom({ open }: { open: boolean }) {
  return (
    <span
      className={cn(
        '-ml-1.5 w-0 shrink-0',
        open
          ? 'group-hover/menu-item:w-7.5 group-has-focus-visible/menu-item:w-7.5'
          : 'group-hover/menu-item:w-6 group-has-focus-visible/menu-item:w-6',
      )}
      aria-hidden
    />
  )
}

/**
 * The close button of an open session's row in the sidebar, where the row's
 * light is, at its right end: it shows while the pointer is on the row or the
 * keyboard focus in it, and closes the session as its tab's close button
 * does. `name` is the session's, as its row shows it.
 */
export function SessionCloseButton({
  session,
  name,
  className,
  testId,
}: {
  session: UiSession
  name: string
  className?: string
  testId: string
}) {
  const requestCloseSession = useAppStore((state) => state.requestCloseSession)
  return (
    <SidebarMenuAction
      showOnHover
      // The button pointed at stands out on the highlighted row. Centered on
      // the light, in the middle of the 30px row: 1px higher than shadcn puts
      // the actions of a row.
      className={cn(
        'top-1.25 hover:bg-sidebar-foreground/10 peer-data-[size=default]/menu-button:top-1.25',
        className,
      )}
      // Pressing it leaves the keyboard focus where it is, as in a terminal.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => requestCloseSession(session.id)}
      aria-label={`Close ${name}`}
      // Its label names the session.
      data-user-text=""
      data-testid={testId}
    >
      <XIcon />
    </SidebarMenuAction>
  )
}

/**
 * The archive button of a chat's or a saved session's row in the sidebar: it
 * shows while the pointer is on the row or the keyboard focus in it, left of
 * the close button while the session is open, and archives the session at
 * once, with a toast that can undo it. `name` is the session's, as its row
 * shows it.
 */
export function SessionArchiveButton({
  id,
  name,
  open,
  className,
  testId,
}: {
  id: string
  name: string
  open: boolean
  className?: string
  testId: string
}) {
  const archiveSession = useAppStore((state) => state.archiveSession)
  return (
    <SidebarMenuAction
      showOnHover
      className={cn(
        'top-1.25 hover:bg-sidebar-foreground/10 peer-data-[size=default]/menu-button:top-1.25',
        open && 'right-7',
        className,
      )}
      // Pressing it leaves the keyboard focus where it is, as in a terminal.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => void archiveSession(id)}
      aria-label={`Archive ${name}`}
      // Its label names the session.
      data-user-text=""
      data-testid={testId}
    >
      <ArchiveIcon />
    </SidebarMenuAction>
  )
}

import { XIcon } from 'lucide-react'
import { cn } from '../lib/utils'
import { useAppStore, type UiSession } from '../store/app-store'
import { SidebarMenuAction } from './ui/sidebar'

/**
 * The class of the button of a session's row in the sidebar: with a close
 * button over the row, the light keeps its place at the row's right end,
 * where the close button shows over it.
 */
export const ROW_WITH_CLOSE = 'group-has-data-[sidebar=menu-action]/menu-item:pr-2'

/**
 * The class of the light of a session's row in the sidebar, which gives way
 * to the row's close button while the pointer is on the row or the keyboard
 * focus in it; it keeps its room meanwhile, so that the name stays as it is.
 */
export const LIGHT_UNDER_CLOSE =
  'group-hover/menu-item:invisible group-has-focus-visible/menu-item:invisible'

/**
 * The close button of an open session's row in the sidebar, where the row's
 * light is, at its right end: it shows while the pointer is on the row or the
 * keyboard focus in it, and closes the session as its tab's close button
 * does, asking first while its agent runs, unless the Agents page says not to
 * ask. `name` is the session's, as its row shows it.
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
      disabled={session.closing}
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

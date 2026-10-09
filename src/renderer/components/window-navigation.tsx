import { ArrowLeftIcon, ArrowRightIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useAppStore } from '../store/app-store'
import { canStep } from '../store/session-history'
import { Button } from './ui/button'
import { Kbd } from './ui/kbd'
import { SidebarTrigger, useSidebar } from './ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

/**
 * Where the navigation starts, in CSS pixels from the window's left edge: past
 * the traffic lights, which take x 15–75 at the position the main process
 * gives them, or near the edge in full screen, where macOS hides them.
 */
const NAVIGATION_START = { windowed: 84, fullScreen: 8 }
/** The width of the navigation: its three `icon-sm` buttons (28px), `gap-1` (4px) apart. */
const NAVIGATION_WIDTH = 3 * 28 + 2 * 4
/** Space between the navigation and the session header's content. */
const HEADER_GAP = 12

/**
 * How far the session header keeps its content from the main area's left
 * edge: while the sidebar is collapsed, the main area starts at the window's
 * left edge, under the navigation. `undefined` leaves the header's own padding.
 */
export function useSessionHeaderInset(): number | undefined {
  const { state } = useSidebar()
  const fullScreen = useAppStore((store) => store.fullScreen)
  if (state === 'expanded') return undefined
  const start = fullScreen ? NAVIGATION_START.fullScreen : NAVIGATION_START.windowed
  return start + NAVIGATION_WIDTH + HEADER_GAP
}

/**
 * A navigation button with a tooltip giving its name and shortcut. The
 * tooltip's trigger wraps the button, so that it also shows while the button
 * is disabled, and keeps the keyboard focus where it is (in a terminal, say)
 * when the button is clicked, as the window's own title bar would.
 */
function NavigationButton({
  label,
  shortcut,
  children,
}: {
  label: string
  shortcut: string
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className="flex" />}
        onMouseDown={(event) => event.preventDefault()}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label}
        <Kbd>{shortcut}</Kbd>
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * The window's navigation, in its top row right of the traffic lights: the
 * sidebar's trigger, and buttons that go back and forward among the sessions
 * shown. It stays in place while the sidebar slides in and out. Its blank
 * parts are part of the area that drags the window; its buttons are not.
 * Entering or leaving full screen moves it the way the session header's
 * content moves then, so that the two never overlap.
 */
export function WindowNavigation() {
  const fullScreen = useAppStore((state) => state.fullScreen)
  const canGoBack = useAppStore((state) => canStep(state.history, -1))
  const canGoForward = useAppStore((state) => canStep(state.history, 1))
  const goBack = useAppStore((state) => state.goBack)
  const goForward = useAppStore((state) => state.goForward)

  return (
    <nav
      aria-label="Navigation"
      className="fixed top-0 left-0 z-20 flex h-11 items-center gap-1 transition-[padding] duration-200 ease-linear [app-region:drag] *:[app-region:no-drag]"
      style={{ paddingLeft: fullScreen ? NAVIGATION_START.fullScreen : NAVIGATION_START.windowed }}
      data-testid="window-navigation"
      data-full-screen={fullScreen}
    >
      <NavigationButton label="Toggle Sidebar" shortcut="⌘B">
        <SidebarTrigger data-testid="toggle-sidebar" />
      </NavigationButton>
      <NavigationButton label="Back" shortcut="⌘[">
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!canGoBack}
          onClick={goBack}
          aria-label="Back"
          data-testid="go-back"
        >
          <ArrowLeftIcon />
        </Button>
      </NavigationButton>
      <NavigationButton label="Forward" shortcut="⌘]">
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!canGoForward}
          onClick={goForward}
          aria-label="Forward"
          data-testid="go-forward"
        >
          <ArrowRightIcon />
        </Button>
      </NavigationButton>
    </nav>
  )
}

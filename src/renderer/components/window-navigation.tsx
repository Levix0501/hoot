import { ArrowLeftIcon, ArrowRightIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useAppStore } from '../store/app-store'
import { canStep, isSettingsPage } from '../store/page-history'
import { Button } from './ui/button'
import { Kbd } from './ui/kbd'
import { SidebarTrigger, useSidebar } from './ui/sidebar'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'

/**
 * Where the navigation starts, in CSS pixels from the window's left edge: past
 * the traffic lights, which take x 15–75 at the position the main process
 * gives them, or near the edge in full screen, where macOS hides them.
 */
const NAVIGATION_START = { windowed: 84, fullScreen: 8 }
/** The width of an `icon-sm` button, and the space between two buttons (`gap-1`). */
const BUTTON_WIDTH = 28
const BUTTON_GAP = 4
/** The width of the navigation: its three buttons. */
const NAVIGATION_WIDTH = 3 * BUTTON_WIDTH + 2 * BUTTON_GAP
/** Space between the navigation and the content of the main area's top row. */
const HEADER_GAP = 12
/**
 * The buttons have half-strength icons that keep their color while pointed
 * at, over a faint highlight.
 */
const BUTTON_CLASS =
  'text-foreground/50 hover:bg-foreground/5 hover:text-foreground/50 disabled:opacity-40 dark:hover:bg-foreground/6'
/**
 * Their tooltips are a pill with a faint border, white in the light
 * appearance and, in the dark one, the popover color mixed with 13% white.
 * They have no arrow, and show and hide at once.
 */
const TOOLTIP_CLASS =
  'gap-2 rounded-2xl border border-foreground/8 bg-popover px-2 py-1.5 text-[13px]/[18px] text-popover-foreground animate-none! has-data-[slot=kbd]:pr-2 **:data-[slot=kbd]:rounded-md dark:bg-[color-mix(in_srgb,var(--popover),white_13%)] [&>[data-side]]:hidden'

/**
 * How far the main area's part of the top row (a session's header, or an
 * Issues page's title row) keeps its content from the main area's left edge:
 * while the sidebar is collapsed, the main area starts at the window's left
 * edge, under the navigation. `undefined` leaves the row's own padding.
 */
export function useTopRowInset(): number | undefined {
  const { state } = useSidebar()
  const fullScreen = useAppStore((store) => store.fullScreen)
  if (state === 'expanded') return undefined
  const start = fullScreen ? NAVIGATION_START.fullScreen : NAVIGATION_START.windowed
  return start + NAVIGATION_WIDTH + HEADER_GAP
}

/**
 * A navigation button with a tooltip below it giving its name and shortcut.
 * The tooltip's trigger wraps the button, so that it also shows while the
 * button is disabled, and keeps the keyboard focus where it is (in a
 * terminal, say) when the button is clicked, as the window's own title bar
 * would.
 */
function NavigationButton({
  label,
  shortcut,
  style,
  children,
}: {
  label: string
  shortcut: string
  style?: React.CSSProperties
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className="flex" style={style} />}
        onMouseDown={(event) => event.preventDefault()}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={2} className={TOOLTIP_CLASS}>
        {label}
        <Kbd className="h-4 px-1.5 font-normal in-data-[slot=tooltip-content]:bg-current/10 in-data-[slot=tooltip-content]:text-current dark:in-data-[slot=tooltip-content]:bg-current/10">
          {shortcut}
        </Kbd>
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * The window's navigation, in its top row right of the traffic lights: the
 * sidebar's trigger, and buttons that go back and forward among the pages
 * shown. It stays in place while the sidebar slides in and out. Its blank
 * parts are part of the area that drags the window; its buttons are not.
 * Entering or leaving full screen moves it the way the content of the main
 * area's top row moves then, so that the two never overlap. While the
 * settings are shown there is no sidebar to show or hide: Back and Forward
 * stay where they are, and the trigger's place is left blank. A button's
 * tooltip shows once the pointer has rested on it for 700 ms, and at once
 * when the pointer comes from another button's within 300 ms.
 */
export function WindowNavigation() {
  const settingsShown = useAppStore((state) => isSettingsPage(state.currentPage))
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
      <TooltipProvider delay={700} timeout={300}>
        {!settingsShown && (
          <NavigationButton label="Toggle sidebar" shortcut="⌘B">
            <SidebarTrigger className={BUTTON_CLASS} data-testid="toggle-sidebar" />
          </NavigationButton>
        )}
        <NavigationButton
          label="Back"
          shortcut="⌘["
          // A margin, not a blank element, keeps the trigger's place in the drag area.
          style={settingsShown ? { marginLeft: BUTTON_WIDTH + BUTTON_GAP } : undefined}
        >
          <Button
            variant="ghost"
            size="icon-sm"
            className={BUTTON_CLASS}
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
            className={BUTTON_CLASS}
            disabled={!canGoForward}
            onClick={goForward}
            aria-label="Forward"
            data-testid="go-forward"
          >
            <ArrowRightIcon />
          </Button>
        </NavigationButton>
      </TooltipProvider>
    </nav>
  )
}

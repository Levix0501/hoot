import { CopyIcon, MinusIcon, SquareIcon, XIcon } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { cn } from 'cn'
import { api } from '../lib/api'
import { Button } from './ui/button'
import { BUTTON_CLASS } from './window-navigation'

/**
 * The minimize, maximize and close buttons of the window on Windows, which
 * the page draws at the right end of its top row instead of Windows drawing
 * them over the page. They are the navigation's buttons, with the icons of
 * lucide closest to Windows's, and, on the page, a side panel that opens
 * there, such as a provider's or an agent's, covers them rather than lying
 * under them. They are left out in full screen, where the window has no top
 * row, and on macOS, whose traffic lights are its own.
 */
export function WindowControls() {
  if (api.windowControls !== 'custom') return null
  return <WindowsControls />
}

/**
 * The three buttons; the last closes the window, after Hoot asks whether to
 * quit if sessions run, as its own close button does. Their icons follow the
 * window, and, as the navigation's buttons, they leave the keyboard focus
 * where it is, in a terminal say, when clicked.
 */
function WindowsControls() {
  const [maximized, setMaximized] = useState(false)
  const [fullScreen, setFullScreen] = useState(false)
  useEffect(() => {
    const stopMaximized = api.onWindowMaximizedChanged(setMaximized)
    const stopFullScreen = api.onFullScreenChanged(setFullScreen)
    return () => {
      stopMaximized()
      stopFullScreen()
    }
  }, [])
  if (fullScreen) return null
  return (
    <div
      className="fixed top-0 right-0 z-40 flex h-11.5 items-center gap-1 pe-2 [app-region:no-drag]"
      data-testid="window-controls"
    >
      <WindowControlButton
        label="Minimize"
        testId="window-control-minimize"
        onClick={() => api.minimizeWindow()}
      >
        <MinusIcon />
      </WindowControlButton>
      <WindowControlButton
        label={maximized ? 'Restore' : 'Maximize'}
        testId="window-control-maximize"
        onClick={() => api.toggleMaximizeWindow()}
      >
        {maximized ? <CopyIcon /> : <SquareIcon />}
      </WindowControlButton>
      <WindowControlButton
        label="Close"
        testId="window-control-close"
        close
        onClick={() => api.closeWindow()}
      >
        <XIcon />
      </WindowControlButton>
    </div>
  )
}

/**
 * One of the navigation's buttons, with an icon instead of a name. The close
 * one, which Windows marks out too, takes the destructive color on a faint
 * red while pointed at, rather than the faint foreground of the others.
 */
function WindowControlButton({
  label,
  testId,
  close = false,
  onClick,
  children,
}: {
  label: string
  testId: string
  /** The close button, which turns red while pointed at. */
  close?: boolean
  onClick(): void
  children: ReactNode
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={cn(
        BUTTON_CLASS,
        close && 'hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/20',
      )}
      aria-label={label}
      onClick={onClick}
      onMouseDown={(event) => event.preventDefault()}
      data-testid={testId}
    >
      {children}
    </Button>
  )
}

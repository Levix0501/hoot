import { api } from '../lib/api'

/**
 * On macOS started with --windows-layout, marks the room at the right end of
 * the window's top row that the minimize, maximize and close buttons of
 * Windows take, which the content of the row stops short of. It only marks
 * the room: it draws no buttons, and the window drags through it.
 */
export function WindowControlsPlaceholder() {
  if (api.windowControls !== 'placeholder') return null
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed top-0 right-0 z-30 h-11 w-(--window-controls-width) border-l border-dashed border-foreground/25 bg-foreground/5"
      data-testid="window-controls-placeholder"
    />
  )
}

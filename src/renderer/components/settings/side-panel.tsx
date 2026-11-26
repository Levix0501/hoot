/**
 * A side panel's own classes: no padding or gap of its own, no ring as the
 * focus comes back to it, and out of the area that drags the window, which
 * the page's top row under it is, so that a click on its title edits it
 * instead of dragging the window (see the issue pages' popups).
 */
export const SIDE_PANEL = 'gap-0 p-0 outline-none [app-region:no-drag]'

/**
 * The name atop a panel, which reads as a title and edits in place, the one
 * it gets left blank as its placeholder: an agent's own name, a provider's
 * saved one, or the one a new provider gets. Esc puts back the name it had,
 * where it was changed.
 */
export function TitleName({
  value,
  own,
  onChange,
  onCommit,
  onRevert,
  autoFocus = false,
  testId = 'agent-panel-name',
}: {
  value: string
  own: string
  onChange: (text: string) => void
  onCommit?: () => void
  /** Puts back the name it had; `null` where nothing was changed. */
  onRevert?: (() => void) | null
  autoFocus?: boolean
  testId?: string
}) {
  return (
    <input
      autoFocus={autoFocus}
      value={value}
      placeholder={own}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onCommit}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape' && onRevert) {
          // Only the change goes; the next Esc closes the panel.
          event.stopPropagation()
          onRevert()
        }
      }}
      spellCheck={false}
      aria-label="Name"
      className="-ml-1.5 h-8 min-w-0 flex-1 rounded-md bg-transparent px-1.5 text-base font-semibold outline-none placeholder:text-foreground hover:bg-muted/60 focus:bg-transparent focus:ring-3 focus:ring-ring/50"
      data-testid={testId}
    />
  )
}

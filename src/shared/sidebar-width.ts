/**
 * The sidebar's width in CSS pixels: what it has until it is resized, and how
 * narrow and how wide dragging its edge makes it.
 */
export const SIDEBAR_WIDTH = { default: 275, min: 240, max: 520 } as const

/** The narrowest the main area gets: in a narrow window, the sidebar narrows to leave it this. */
export const MAIN_AREA_MIN_WIDTH = 240

/**
 * Half the sidebar's narrowest width: its edge dragged closer than this to the
 * window's left edge collapses it, and dragged back past it expands it again.
 */
export const SIDEBAR_COLLAPSE_WIDTH = SIDEBAR_WIDTH.min / 2

/**
 * `width` brought within the sidebar's limits, in whole pixels, and in a
 * window `windowWidth` wide, short enough to leave the main area its narrowest
 * width; the default width for a value that is not a number.
 */
export function sidebarWidthWithin(width: unknown, windowWidth = Infinity): number {
  if (typeof width !== 'number' || !Number.isFinite(width)) return SIDEBAR_WIDTH.default
  const widest = Math.min(SIDEBAR_WIDTH.max, windowWidth - MAIN_AREA_MIN_WIDTH)
  return Math.round(Math.max(SIDEBAR_WIDTH.min, Math.min(width, widest)))
}

/**
 * The width the sidebar takes when its edge, grabbed at `startX` while the
 * sidebar was `startWidth` wide, is dragged to `x` in a window `windowWidth`
 * wide; `null` when the sidebar collapses there.
 */
export function draggedSidebarWidth(
  startWidth: number,
  startX: number,
  x: number,
  windowWidth: number,
): number | null {
  const width = startWidth + x - startX
  return width < SIDEBAR_COLLAPSE_WIDTH ? null : sidebarWidthWithin(width, windowWidth)
}

/**
 * Where the Issues window sits in Hoot's window: its distances in CSS pixels
 * from the side of the window and from the top or bottom it is nearest to,
 * so that it keeps to that corner as the window is resized, and opens away
 * from it.
 */
export interface IssueWindowPosition {
  side: 'left' | 'right'
  x: number
  edge: 'top' | 'bottom'
  y: number
}

/** Where it sits until it is moved: at the bottom right, clear of the window's edges. */
export const DEFAULT_ISSUE_WINDOW_POSITION: IssueWindowPosition = {
  side: 'right',
  x: 16,
  edge: 'bottom',
  y: 16,
}

/** How close to the window's edges it may be moved. */
export const ISSUE_WINDOW_MARGIN = 8

/** How the Issues window was left: open, or closed to its button, and where it sits. */
export interface IssueWindowLayout {
  open: boolean
  position: IssueWindowPosition
}

/** A box in the window, in CSS pixels from the window's top left. */
export interface WindowRect {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * The position of the Issues window when it covers `rect` in a window
 * `width` wide and `height` high: by the side and the top or bottom nearest
 * to its center, in whole pixels.
 */
export function issueWindowPositionOf(
  rect: WindowRect,
  width: number,
  height: number,
): IssueWindowPosition {
  const side = (rect.left + rect.right) / 2 > width / 2 ? 'right' : 'left'
  const edge = (rect.top + rect.bottom) / 2 > height / 2 ? 'bottom' : 'top'
  return {
    side,
    x: Math.max(0, Math.round(side === 'right' ? width - rect.right : rect.left)),
    edge,
    y: Math.max(0, Math.round(edge === 'bottom' ? height - rect.bottom : rect.top)),
  }
}

/** The largest distance from an edge kept, beyond any window's size. */
const MAX_DISTANCE = 100_000

/** Whether a saved distance from an edge is one the window can have. */
function isDistance(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_DISTANCE
}

/** A position as saved, or the default for anything that is not one. */
export function issueWindowPositionWithin(value: unknown): IssueWindowPosition {
  if (typeof value !== 'object' || value === null) return DEFAULT_ISSUE_WINDOW_POSITION
  const { side, x, edge, y } = value as Record<string, unknown>
  if ((side !== 'left' && side !== 'right') || (edge !== 'top' && edge !== 'bottom')) {
    return DEFAULT_ISSUE_WINDOW_POSITION
  }
  if (!isDistance(x) || !isDistance(y)) return DEFAULT_ISSUE_WINDOW_POSITION
  return { side, x: Math.round(x), edge, y: Math.round(y) }
}

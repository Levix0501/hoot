/**
 * The widths of the file panel's parts in CSS pixels: what each has until it
 * is resized, and how narrow and how wide dragging its edge makes it. The
 * tree is at the panel's right end; the open files are left of it.
 */
export const FILE_TREE_WIDTH = { default: 250, min: 200, max: 480 } as const
export const FILE_EDITOR_WIDTH = { default: 480, min: 240, max: 1600 } as const

/**
 * The narrowest the terminal gets beside the file panel, which narrows to
 * leave it this, or half the main area in a narrower one.
 */
export const TERMINAL_MIN_WIDTH = 360

/** How the file panel was left: whether it is shown, and how wide its parts are. */
export interface FilePanelLayout {
  open: boolean
  treeWidth: number
  editorWidth: number
}

/** How wide the file panel's parts are. */
export type FilePanelWidths = Pick<FilePanelLayout, 'treeWidth' | 'editorWidth'>

/** `width` brought within `min` and `max`, in whole pixels; `min` when `max` is less. */
function clamp(width: number, min: number, max: number): number {
  return Math.round(Math.max(min, Math.min(width, max)))
}

function within(width: unknown, limits: { default: number; min: number; max: number }): number {
  if (typeof width !== 'number' || !Number.isFinite(width)) return limits.default
  return clamp(width, limits.min, limits.max)
}

/** The tree's `width` brought within its limits, in whole pixels; the default for a non-number. */
export function fileTreeWidthWithin(width: unknown): number {
  return within(width, FILE_TREE_WIDTH)
}

/** The open files' `width` brought within their limits, in whole pixels; the default for a non-number. */
export function fileEditorWidthWithin(width: unknown): number {
  return within(width, FILE_EDITOR_WIDTH)
}

/**
 * The widest the file panel gets, its lines included, in a session's page
 * `pageWidth` wide: as wide as leaves the terminal its narrowest width.
 */
function panelRoom(pageWidth: number): number {
  return pageWidth - Math.min(TERMINAL_MIN_WIDTH, pageWidth / 2)
}

/**
 * The widths the file panel's parts take when the panel's left edge, grabbed
 * at `startX` while they were `start` wide, is dragged to `x` in a session's
 * page `pageWidth` wide; `null` when the panel hides there. The edge resizes
 * the open files or, while none is open (`filesOpen` false), the tree: within
 * its limits, and narrow enough to leave the terminal its narrowest width.
 * Dragged narrower than half its narrowest width, the part hides the panel.
 */
export function draggedPanelEdge(
  start: FilePanelWidths,
  filesOpen: boolean,
  startX: number,
  x: number,
  pageWidth: number,
): FilePanelWidths | null {
  const limits = filesOpen ? FILE_EDITOR_WIDTH : FILE_TREE_WIDTH
  const startWidth = filesOpen ? start.editorWidth : start.treeWidth
  // A part shown narrower than its narrowest width, as the open files are in
  // a page too narrow for them, hides the panel only once dragged as far as
  // from that width, not as soon as the edge moves.
  if (Math.max(startWidth, limits.min) + startX - x < limits.min / 2) return null
  const width = startWidth + startX - x
  // The rest of the panel: the tree and the lines left of it and of the open
  // files, or the line at the panel's left edge alone.
  const rest = filesOpen ? start.treeWidth + 2 : 1
  const shown = clamp(width, limits.min, Math.min(limits.max, panelRoom(pageWidth) - rest))
  return filesOpen ? { ...start, editorWidth: shown } : { ...start, treeWidth: shown }
}

/**
 * The widths the file panel's parts take when the line between its open
 * files and its tree, grabbed at `startX` while they were `start` wide, is
 * dragged to `x` in a session's page `pageWidth` wide. The tree takes what it
 * gains from the open files, down to their narrowest width, then from the
 * terminal, as far as that leaves the terminal its narrowest width; what it
 * loses goes to the open files. Either keeps within its limits.
 */
export function draggedTreeEdge(
  start: FilePanelWidths,
  startX: number,
  x: number,
  pageWidth: number,
): FilePanelWidths {
  // How much wider the tree can get: what the open files have over their
  // narrowest width, and the room the panel has left.
  const spare =
    Math.max(0, start.editorWidth - FILE_EDITOR_WIDTH.min) +
    Math.max(0, panelRoom(pageWidth) - (start.editorWidth + 1 + start.treeWidth + 1))
  const treeWidth = clamp(
    start.treeWidth + startX - x,
    FILE_TREE_WIDTH.min,
    Math.min(FILE_TREE_WIDTH.max, start.treeWidth + spare),
  )
  const editorWidth = clamp(
    start.editorWidth - (treeWidth - start.treeWidth),
    FILE_EDITOR_WIDTH.min,
    FILE_EDITOR_WIDTH.max,
  )
  return { treeWidth, editorWidth }
}

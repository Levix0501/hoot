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

function within(width: unknown, limits: { default: number; min: number; max: number }): number {
  if (typeof width !== 'number' || !Number.isFinite(width)) return limits.default
  return Math.round(Math.max(limits.min, Math.min(width, limits.max)))
}

/** The tree's `width` brought within its limits, in whole pixels; the default for a non-number. */
export function fileTreeWidthWithin(width: unknown): number {
  return within(width, FILE_TREE_WIDTH)
}

/** The open files' `width` brought within their limits, in whole pixels; the default for a non-number. */
export function fileEditorWidthWithin(width: unknown): number {
  return within(width, FILE_EDITOR_WIDTH)
}

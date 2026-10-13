import type { TitleBarOverlay } from 'electron'

/**
 * The page's background and text colors in each appearance, as
 * src/renderer/index.css sets them. The window takes the background, so that
 * nothing else shows before the page paints; on Windows, so do the buttons
 * Windows draws over the page, with symbols in the text color.
 */
const COLORS = {
  light: { background: '#ffffff', text: '#1a1c1f' },
  dark: { background: '#181818', text: '#ffffff' },
}

/** The height of the page's top row (`h-11`). */
const TOP_ROW_HEIGHT = 44

/** The window's background in the dark appearance or the light one. */
export function windowBackground(dark: boolean): string {
  return (dark ? COLORS.dark : COLORS.light).background
}

/**
 * How Windows draws its minimize, maximize and close buttons over the right
 * end of the page's top row: as tall as the row, on the page's background,
 * with symbols in its text color.
 */
export function titleBarOverlay(dark: boolean): TitleBarOverlay {
  const colors = dark ? COLORS.dark : COLORS.light
  return { color: colors.background, symbolColor: colors.text, height: TOP_ROW_HEIGHT }
}

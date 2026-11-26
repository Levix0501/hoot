/**
 * The page's background in each appearance, as src/renderer/index.css sets
 * it. The window takes the background, so that nothing else shows before the
 * page paints.
 */
const COLORS = {
  light: { background: '#ffffff' },
  dark: { background: '#181818' },
}

/** The window's background in the dark appearance or the light one. */
export function windowBackground(dark: boolean): string {
  return (dark ? COLORS.dark : COLORS.light).background
}

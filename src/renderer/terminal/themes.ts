import type { ITheme } from '@xterm/xterm'

export type ColorScheme = 'light' | 'dark'

/** The theme keys of the 16 colors, in order of their numbers 0–15. */
export const ANSI_COLOR_KEYS = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
] as const satisfies ReadonlyArray<keyof ITheme>

/** Ghostty's default 16 colors (Ghostty 1.3.1, src/terminal/color.zig), for the dark appearance. */
export const DARK_ANSI_COLORS: readonly string[] = [
  '#1D1F21',
  '#CC6666',
  '#B5BD68',
  '#F0C674',
  '#81A2BE',
  '#B294BB',
  '#8ABEB7',
  '#C5C8C6',
  '#666666',
  '#D54E53',
  '#B9CA4A',
  '#E7C547',
  '#7AA6DA',
  '#C397D8',
  '#70C0B1',
  '#EAEAEA',
]

/** The 16 colors of Claude Light from iTerm2-Color-Schemes, for the light appearance. */
export const LIGHT_ANSI_COLORS: readonly string[] = [
  '#0a0a0a',
  '#a84b3a',
  '#2e7c4c',
  '#8a6220',
  '#184e95',
  '#882b4d',
  '#066049',
  '#b6b5aa',
  '#51504d',
  '#e34a4a',
  '#639900',
  '#b87700',
  '#3886e5',
  '#d55382',
  '#199f70',
  '#e2e1da',
]

/** `#rrggbb` with an opacity from 0 to 1, as `#rrggbbaa`. */
function withOpacity(color: string, opacity: number): string {
  const alpha = Math.round(opacity * 255)
  return `${color}${alpha.toString(16).padStart(2, '0')}`
}

/**
 * A theme whose default background and foreground are the interface's
 * `--background` and `--foreground` colors, so that the terminal blends into
 * the session card.
 */
function theme(background: string, foreground: string, ansi: readonly string[]): ITheme {
  return {
    background,
    foreground,
    // As in Ghostty by default: a block cursor in the foreground color with the
    // character under it in the background color, and a selection that swaps
    // the two colors.
    cursor: foreground,
    cursorAccent: background,
    selectionBackground: foreground,
    selectionForeground: background,
    // The scrollbar's slider is the foreground color, partly transparent.
    scrollbarSliderBackground: withOpacity(foreground, 0.4),
    scrollbarSliderHoverBackground: withOpacity(foreground, 0.55),
    scrollbarSliderActiveBackground: withOpacity(foreground, 0.7),
    // The overview ruler under the scrollbar has nothing to show; its border is not drawn either.
    overviewRulerBorder: withOpacity(background, 0),
    ...Object.fromEntries(ANSI_COLOR_KEYS.map((key, index) => [key, ansi[index]])),
  }
}

export const lightTheme: ITheme = theme('#ffffff', '#0a0a0a', LIGHT_ANSI_COLORS)
export const darkTheme: ITheme = theme('#0a0a0a', '#fafafa', DARK_ANSI_COLORS)

export function terminalTheme(scheme: ColorScheme): ITheme {
  return scheme === 'dark' ? darkTheme : lightTheme
}

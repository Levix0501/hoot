import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { connectClipboard } from './terminal-clipboard'
import { TERMINAL_FONT_FAMILY, TERMINAL_FONT_SIZE } from './terminal-font'
import { terminalTheme, type ColorScheme } from './themes'
import { applyCurrentUnicodeWidths } from './unicode-widths'

/** Lines kept above the visible screen for scrolling back. */
export const SCROLLBACK_LINES = 10_000

/** Width of the terminal's scrollbar, in CSS pixels: a thin slider beside the text. */
const SCROLLBAR_WIDTH = 6

export interface SessionTerminal {
  terminal: Terminal
  fit: FitAddon
}

export function systemColorScheme(): ColorScheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * Creates the terminal for a session. It exists before it is shown so that
 * xterm.js keeps any output that arrives before the terminal is on screen.
 */
export function createSessionTerminal(scheme: ColorScheme): SessionTerminal {
  const terminal = new Terminal({
    allowProposedApi: true,
    scrollback: SCROLLBACK_LINES,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: TERMINAL_FONT_SIZE,
    // The font's own line height, without extra spacing between lines.
    lineHeight: 1,
    cursorStyle: 'block',
    cursorBlink: true,
    // Bold text keeps its color instead of switching to the bright one.
    drawBoldTextInBrightColors: false,
    macOptionClickForcesSelection: true,
    scrollbar: { width: SCROLLBAR_WIDTH },
    // Keys reach programs with their usual encoding: programs cannot turn on
    // the kitty keyboard protocol.
    vtExtensions: { kittyKeyboard: false },
    theme: terminalTheme(scheme),
  })
  const fit = new FitAddon()
  terminal.loadAddon(fit)
  connectClipboard(terminal)
  applyCurrentUnicodeWidths(terminal)
  return { terminal, fit }
}

export function setTerminalColorScheme({ terminal }: SessionTerminal, scheme: ColorScheme): void {
  terminal.options.theme = terminalTheme(scheme)
}

/** Stops sending keyboard input once the session's process has ended. */
export function setTerminalInputEnabled({ terminal }: SessionTerminal, enabled: boolean): void {
  terminal.options.disableStdin = !enabled
  terminal.options.cursorBlink = enabled
}

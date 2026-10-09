import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { terminalTheme, type ColorScheme } from './themes'
import { applyCurrentUnicodeWidths } from './unicode-widths'

/** Lines kept above the visible screen for scrolling back. */
export const SCROLLBACK_LINES = 10_000

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
    // Nerd Font symbol fonts, when installed, supply the icons many prompts use.
    fontFamily:
      'Menlo, Monaco, "Courier New", "Symbols Nerd Font Mono", "JetBrainsMono Nerd Font Mono", "MesloLGS NF", monospace',
    fontSize: 13,
    cursorBlink: true,
    macOptionClickForcesSelection: true,
    theme: terminalTheme(scheme),
  })
  const fit = new FitAddon()
  terminal.loadAddon(fit)
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

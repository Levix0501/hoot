import { ClipboardAddon, type IClipboardProvider } from '@xterm/addon-clipboard'
import type { Terminal } from '@xterm/xterm'
import { api } from '../lib/api'
import { clipboardKeyAction } from './clipboard-keys'

/**
 * The clipboard as the programs in a session reach it, with OSC 52: they can
 * put text on it, as Claude Code does with the text selected in it, but not
 * read it, so that no program learns what was copied elsewhere. A program
 * that asks for it is told it is empty. Every clipboard OSC 52 can name is
 * the one clipboard there is.
 */
const programClipboard: IClipboardProvider = {
  readText: () => '',
  writeText: (_selection, text) => api.writeClipboardText(text),
}

/**
 * Connects a session's terminal to the clipboard: its programs can put text
 * on it, and on Windows its keys copy and paste as in Windows Terminal (see
 * `clipboardKeyAction`). On macOS ⌘C and ⌘V do, through the Edit menu.
 */
export function connectClipboard(terminal: Terminal): void {
  terminal.loadAddon(new ClipboardAddon(undefined, programClipboard))
  if (!api.windowsClipboardKeys) return
  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown') return true
    const action = clipboardKeyAction(event, terminal.hasSelection())
    if (action === 'copy') {
      api.writeClipboardText(terminal.getSelection())
      // As in Windows Terminal: the next Ctrl+C interrupts the program.
      terminal.clearSelection()
      // Chromium would copy too.
      event.preventDefault()
    }
    // A paste is left to Chromium, whose paste event xterm.js handles: the
    // program gets the text instead of Ctrl+V.
    return action === null
  })
}

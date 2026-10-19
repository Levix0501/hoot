import type { Terminal } from '@xterm/xterm'
import { api } from '../lib/api'
import { clipboardKeyAction } from './clipboard-keys'

/**
 * Connects a session's terminal to the clipboard: on Windows its keys copy
 * and paste as in Windows Terminal (see `clipboardKeyAction`). On macOS ⌘C
 * and ⌘V do, through the Edit menu.
 */
export function connectClipboard(terminal: Terminal): void {
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

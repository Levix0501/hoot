/** What a key press does with the clipboard in a session's terminal. */
export type ClipboardKeyAction = 'copy' | 'paste'

type ClipboardKeyEvent = Pick<
  KeyboardEvent,
  'keyCode' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'
>

// Key codes, which Windows gives the same on every keyboard layout.
const KEY_C = 67
const KEY_V = 86
const KEY_INSERT = 45

/**
 * What a key press does with the clipboard in a session's terminal on
 * Windows, with the keys of Windows Terminal: Ctrl+C, Ctrl+Shift+C and
 * Ctrl+Insert copy the selection, and Ctrl+V pastes. Ctrl+C copies only when
 * text is selected: otherwise it reaches the program, to interrupt it.
 * Ctrl+Shift+V and Shift+Insert paste already, as Chromium's own keys. Keys
 * are matched by their key code, as xterm.js matches those it sends as
 * control characters, so that Ctrl+C copies with every keyboard layout it
 * interrupts with.
 */
export function clipboardKeyAction(
  event: ClipboardKeyEvent,
  hasSelection: boolean,
): ClipboardKeyAction | null {
  if (!event.ctrlKey || event.altKey || event.metaKey) return null
  if (event.keyCode === KEY_V) return event.shiftKey ? null : 'paste'
  const copies = event.keyCode === KEY_C || (event.keyCode === KEY_INSERT && !event.shiftKey)
  return copies && hasSelection ? 'copy' : null
}

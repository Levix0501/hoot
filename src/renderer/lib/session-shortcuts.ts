/** A session command bound to a keyboard shortcut. */
export type SessionShortcut =
  | { kind: 'select'; index: number }
  | { kind: 'next' }
  | { kind: 'previous' }
  | { kind: 'back' }
  | { kind: 'forward' }
  | { kind: 'close' }

type ShortcutKeyEvent = Pick<
  KeyboardEvent,
  'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'isComposing'
>

/**
 * The session command of a key press: ⌘1–⌘9 select the session at that place
 * in the sidebar, ⌘⇧] and ⌘⇧[ the next and previous session, ⌘[ and ⌘] go
 * back and forward among the sessions shown, and ⌘W closes the current
 * session. Digits are matched by the key's position on the number row, the
 * other keys by the character they type.
 */
export function sessionShortcut(event: ShortcutKeyEvent): SessionShortcut | null {
  if (!event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return null
  const key = event.key.toLowerCase()
  if (event.shiftKey) {
    if (key === ']' || key === '}') return { kind: 'next' }
    if (key === '[' || key === '{') return { kind: 'previous' }
    return null
  }
  if (key === '[') return { kind: 'back' }
  if (key === ']') return { kind: 'forward' }
  if (key === 'w') return { kind: 'close' }
  const digit = /^Digit([1-9])$/.exec(event.code)?.[1] ?? /^[1-9]$/.exec(event.key)?.[0]
  return digit ? { kind: 'select', index: Number(digit) - 1 } : null
}

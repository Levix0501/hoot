/**
 * A command of the single-key shortcuts of Issues pages, as in Linear. They
 * work only while the keyboard focus is on the page itself, not in a field,
 * an editor, a terminal, a menu or a dialog.
 */
export type IssueShortcut =
  | { kind: 'new-issue' }
  /** On the list, the next (1) or previous (-1) issue in it; on an issue's page, the next or previous issue of the list. */
  | { kind: 'move'; offset: 1 | -1 }
  | { kind: 'status' }
  | { kind: 'priority' }
  | { kind: 'delete' }
  /** On an issue's page: the issue list. */
  | { kind: 'back-to-list' }

/** Which Issues page has the keyboard: the issue list, or one issue. */
export type IssuesPageKind = 'list' | 'issue'

type IssueKeyEvent = Pick<
  KeyboardEvent,
  'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'isComposing' | 'repeat'
>

/**
 * The command of a key press on an Issues page: C creates an issue, J and K
 * (and on a list ↓ and ↑) move to the next and previous issue, S and P change
 * the status and the priority, ⌘⌫ deletes, and Esc on an issue's page goes
 * back to the list. Letters are matched by the character they type, in
 * either case, without Shift; held keys repeat only the moves.
 */
export function issueShortcut(event: IssueKeyEvent, page: IssuesPageKind): IssueShortcut | null {
  if (event.isComposing || event.ctrlKey || event.altKey || event.shiftKey) return null
  if (event.metaKey) {
    return event.key === 'Backspace' && !event.repeat ? { kind: 'delete' } : null
  }
  switch (event.key.toLowerCase()) {
    case 'j':
      return { kind: 'move', offset: 1 }
    case 'k':
      return { kind: 'move', offset: -1 }
    case 'arrowdown':
      return page === 'list' ? { kind: 'move', offset: 1 } : null
    case 'arrowup':
      return page === 'list' ? { kind: 'move', offset: -1 } : null
    case 'escape':
      return page === 'issue' && !event.repeat ? { kind: 'back-to-list' } : null
  }
  if (event.repeat) return null
  switch (event.key.toLowerCase()) {
    case 'c':
      return { kind: 'new-issue' }
    case 's':
      return { kind: 'status' }
    case 'p':
      return { kind: 'priority' }
  }
  return null
}

/** Where keys typed are not shortcuts: fields, editors, terminals, menus and dialogs. */
const TYPING_OR_OVERLAY = [
  'input',
  'textarea',
  'select',
  '[contenteditable]:not([contenteditable="false"])',
  '.xterm',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[role="combobox"]',
].join(', ')

/** Whether a key pressed with the focus on `target` belongs to what has the focus. */
export function isTypingOrOverlayTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(TYPING_OR_OVERLAY) !== null
}

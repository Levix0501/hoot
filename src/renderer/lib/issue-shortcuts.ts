/**
 * A command of the keyboard shortcuts of Issues pages, as in Linear. The
 * single-key ones work only while the keyboard focus is on the page itself,
 * not in a field, an editor, a terminal, a menu or a dialog; those with ⌘ and
 * ⇧ also in a field or an editor of the page (see `worksWhileTyping`).
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
  /** On an issue's page: the card for a new sub-issue of the issue. */
  | { kind: 'new-sub-issue' }
  /** On an issue's page: the picker of the issue's parent. */
  | { kind: 'set-parent' }

/** Which Issues page has the keyboard: the issue list, or one issue. */
export type IssuesPageKind = 'list' | 'issue'

type IssueKeyEvent = Pick<
  KeyboardEvent,
  'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'isComposing' | 'repeat'
>

/**
 * The command of a key press on an Issues page: C creates an issue, J and K
 * (and on a list ↓ and ↑) move to the next and previous issue, S and P change
 * the status and the priority, ⌘⌫ deletes, Esc on an issue's page goes back
 * to the list, and on an issue's page ⌘⇧O adds a sub-issue and ⌘⇧P picks the
 * parent. Letters are matched by the character they type, in either case,
 * without Shift unless with ⌘; held keys repeat only the moves.
 */
export function issueShortcut(event: IssueKeyEvent, page: IssuesPageKind): IssueShortcut | null {
  if (event.isComposing || event.ctrlKey || event.altKey) return null
  if (event.shiftKey) {
    if (!event.metaKey || event.repeat || page !== 'issue') return null
    switch (event.key.toLowerCase()) {
      case 'o':
        return { kind: 'new-sub-issue' }
      case 'p':
        return { kind: 'set-parent' }
    }
    return null
  }
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

/** Whether a shortcut works also while the keyboard focus is in a field or an editor of the page. */
export function worksWhileTyping(shortcut: IssueShortcut): boolean {
  return shortcut.kind === 'new-sub-issue' || shortcut.kind === 'set-parent'
}

/** Where no key typed is a shortcut: terminals, menus and dialogs. */
const OVERLAY = [
  '.xterm',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[role="combobox"]',
].join(', ')

/** Where keys typed are not shortcuts either, but for those that work while typing. */
const TYPING_OR_OVERLAY = [
  'input',
  'textarea',
  'select',
  '[contenteditable]:not([contenteditable="false"])',
  OVERLAY,
].join(', ')

/** Whether a key pressed with the focus on `target` belongs to what has the focus. */
export function isTypingOrOverlayTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(TYPING_OR_OVERLAY) !== null
}

/** Whether the focus on `target` is in a terminal, a menu or a dialog. */
export function isOverlayTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(OVERLAY) !== null
}

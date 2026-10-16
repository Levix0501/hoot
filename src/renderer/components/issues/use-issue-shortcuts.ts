import { useEffect, useRef } from 'react'
import {
  issueShortcut,
  isOverlayTarget,
  isTypingOrOverlayTarget,
  worksWhileTyping,
  type IssueShortcut,
  type IssuesPageKind,
} from '../../lib/issue-shortcuts'

/**
 * Runs the keyboard shortcuts of an Issues page while it is shown. Keys typed
 * into a field, an editor or a terminal, and keys for a menu or a dialog, are
 * left to them, but for the shortcuts that work while typing; so is a key
 * whose event something handled before. `run` says whether it did
 * something, which keeps the key from doing anything else, such as typing
 * the C that opens the new issue dialog into its title, or reaching the
 * application menu.
 */
export function useIssueShortcuts(
  page: IssuesPageKind,
  run: (shortcut: IssueShortcut) => boolean,
): void {
  const runRef = useRef(run)
  useEffect(() => {
    runRef.current = run
  })
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const shortcut = issueShortcut(event, page)
      if (shortcut === null) return
      const leftAlone = worksWhileTyping(shortcut) ? isOverlayTarget : isTypingOrOverlayTarget
      if (leftAlone(event.target)) return
      if (runRef.current(shortcut)) event.preventDefault()
    }
    // In the bubble phase, after the menus and dialogs that close on Escape.
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [page])
}

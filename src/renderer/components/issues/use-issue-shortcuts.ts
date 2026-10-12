import { useEffect, useRef } from 'react'
import {
  issueShortcut,
  isTypingOrOverlayTarget,
  type IssueShortcut,
  type IssuesPageKind,
} from '../../lib/issue-shortcuts'

/**
 * Runs the single-key shortcuts of an Issues page while it is shown. Keys
 * typed into a field, an editor or a terminal, and keys for a menu or a
 * dialog, are left to them; so is a key whose event something handled
 * before. `run` says whether it did something, which keeps the key from
 * doing anything else, such as typing the C that opens the new issue
 * dialog into its title.
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
      if (event.defaultPrevented || isTypingOrOverlayTarget(event.target)) return
      const shortcut = issueShortcut(event, page)
      if (shortcut !== null && runRef.current(shortcut)) event.preventDefault()
    }
    // In the bubble phase, after the menus and dialogs that close on Escape.
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [page])
}

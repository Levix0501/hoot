import type { ReactElement, ReactNode } from 'react'
import { focusAfterOverlay } from '../store/app-store'
import { dropdownMenuParts } from './menu-parts'
import { NewSessionMenuEntries } from './new-session-menu-entries'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from './ui/dropdown-menu'

/**
 * A `+` for a worktree, or for a `worktreePath` of `null`, the project's own
 * folder, drawn as `render` with `children` in it. Pressing it opens the menu
 * New Session ▸ also shows (see `NewSessionMenuEntries`): the agents, one of
 * which starts a session there, and Terminal, which starts a Terminal session
 * there.
 */
export function NewWorktreeSessionButton({
  projectRoot,
  worktreePath,
  render,
  children,
  testId,
}: {
  projectRoot: string
  worktreePath: string | null
  render: ReactElement
  children: ReactNode
  /** The prefix of its menu items' test ids. */
  testId: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={render}>{children}</DropdownMenuTrigger>
      <DropdownMenuContent className="w-auto min-w-48" finalFocus={focusAfterOverlay}>
        <NewSessionMenuEntries
          components={dropdownMenuParts}
          projectRoot={projectRoot}
          worktreePath={worktreePath}
          testId={testId}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

import { useRender } from '@base-ui/react/use-render'
import { useState, type ReactElement, type ReactNode } from 'react'
import { agentChoice } from '../../shared/chats'
import type { CodingToolId } from '../../shared/tools'
import { focusAfterOverlay, useAppStore } from '../store/app-store'
import { ChatAgentMenuEntries } from './chat-agent-menu'
import { dropdownComponents } from './project-item'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from './ui/dropdown-menu'

/**
 * A `+` that starts a session in a worktree, or for a `worktreePath` of
 * `null`, in the project's own folder, drawn as `render` with `children` in
 * it. While more than one agent can be used, pressing it opens a menu of
 * them, as New Session ▸ lists them, and choosing one starts a session of
 * it; with only one, clicking it starts that one at once; with none,
 * clicking it says that one must be installed or turned on, and opens the
 * Agents page. Until the first detection of the agents finishes, its menu
 * says that they are being checked for.
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
  const newWorktreeSession = useAppStore((state) => state.newWorktreeSession)
  const choice = useAppStore((state) => agentChoice(state.tools, state.launchSettings))
  const [open, setOpen] = useState(false)
  const start = (toolId?: CodingToolId) =>
    void newWorktreeSession(projectRoot, worktreePath, toolId)
  const button = useRender({ render, props: { onClick: () => start(), children } })

  // An open menu stays while the agents change, as when the first detection finishes.
  if (!choice && !open) return button
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger render={render}>{children}</DropdownMenuTrigger>
      <DropdownMenuContent className="w-auto min-w-48" finalFocus={focusAfterOverlay}>
        <ChatAgentMenuEntries
          components={dropdownComponents}
          onSelect={start}
          testId={testId}
          failure="Could not start a session."
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

import { getTool, type CodingToolId } from '../../shared/tools'
import { useAppStore } from '../store/app-store'
import { ChatAgentMenuEntries } from './chat-agent-menu'
import type { MenuParts } from './menu-parts'
import { ToolIcon } from './tool-icon'

/**
 * What a menu that starts a session in a worktree, or for a `worktreePath`
 * of `null`, in the project's own folder, holds: the agents, as the New chat
 * menu lists them, choosing one of which starts a session of it there; and
 * below them, set apart by a line, Terminal, which starts a Terminal session
 * there instead, the user's default shell. Terminal can be chosen whatever
 * the agents are, also while they are being checked for. `testId` is the
 * prefix of the items' test ids.
 */
export function NewSessionMenuEntries({
  components,
  projectRoot,
  worktreePath,
  testId,
}: {
  components: MenuParts
  projectRoot: string
  worktreePath: string | null
  testId: string
}) {
  const newWorktreeSession = useAppStore((state) => state.newWorktreeSession)
  const newTerminalSession = useAppStore((state) => state.newTerminalSession)
  const { Item, Separator } = components

  const start = (toolId: CodingToolId) => void newWorktreeSession(projectRoot, worktreePath, toolId)

  return (
    <>
      <ChatAgentMenuEntries
        components={components}
        onSelect={start}
        testId={testId}
        failure="Could not start a session."
      />
      <Separator />
      <Item
        onClick={() => newTerminalSession(projectRoot, worktreePath)}
        data-testid={`${testId}-terminal`}
      >
        <ToolIcon toolId="shell" />
        <span>{getTool('shell').label}</span>
      </Item>
    </>
  )
}

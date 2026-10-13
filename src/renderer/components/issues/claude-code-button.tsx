import type { Issue } from '../../../shared/issues'
import { getTool } from '../../../shared/tools'
import { sendBlockers, type SendBlocker } from '../../lib/issue-sending'
import { useAppStore } from '../../store/app-store'
import { ToolIcon } from '../tool-icon'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

const SEND_HINT = "Judge the workload and split the issue with Hoot's built-in instructions"
const SHOW_HINT = 'Show the Claude Code session started from this issue'

/** What the tooltip of a send button that cannot be used says about one of the reasons. */
function BlockerNote({ blocker }: { blocker: SendBlocker }) {
  switch (blocker) {
    case 'checking':
      return <p>Hoot is still checking whether Claude Code is installed.</p>
    case 'not-installed':
      return (
        <p>
          Claude Code is not installed. Install it with{' '}
          <code className="font-mono break-all">{getTool('claude').installCommand}</code>
        </p>
      )
    case 'no-project':
      return <p>Set a Project for this issue first: Claude Code starts in the project's root.</p>
  }
}

/**
 * The first of an open issue's actions. It sends the issue to Claude Code, in
 * a new session in the main worktree of the project the issue belongs to,
 * which judges the issue's workload and splits it as Hoot's instructions say;
 * while that session is in the sidebar, it shows the session instead,
 * whatever project the issue belongs to now. Its tooltip says what it does,
 * or why it cannot send the issue now, also while the button is disabled: the
 * tooltip's trigger wraps the button.
 */
export function ClaudeCodeButton({ issue }: { issue: Issue }) {
  const sessionId = useAppStore(
    (state) => state.sessions.find((session) => session.issueId === issue.id)?.id ?? null,
  )
  const tools = useAppStore((state) => state.tools)
  const selectSession = useAppStore((state) => state.selectSession)
  const sendIssueToClaudeCode = useAppStore((state) => state.sendIssueToClaudeCode)
  const blockers = sessionId === null ? sendBlockers(tools, issue) : []

  return (
    <Tooltip>
      <TooltipTrigger render={<span className="flex" />}>
        {/* While it cannot send, it is still what the pointer is on, like any other button. */}
        <Button
          variant="outline"
          size="sm"
          className="disabled:pointer-events-auto"
          disabled={blockers.length > 0}
          onClick={() =>
            sessionId === null ? sendIssueToClaudeCode(issue.id) : selectSession(sessionId)
          }
          data-testid="issue-claude-code"
          data-action={sessionId === null ? 'send' : 'show'}
        >
          <ToolIcon toolId="claude" />
          {sessionId === null ? 'Send to Claude Code' : 'Show Claude Code Session'}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" data-testid="issue-claude-code-tooltip">
        {blockers.length === 0 ? (
          sessionId === null ? (
            SEND_HINT
          ) : (
            SHOW_HINT
          )
        ) : (
          <div className="grid gap-1">
            {blockers.map((blocker) => (
              <BlockerNote key={blocker} blocker={blocker} />
            ))}
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

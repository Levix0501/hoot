import type { Issue } from '../../../shared/issues'
import { getTool } from '../../../shared/tools'
import { sendBlockers, type SendBlocker } from '../../lib/issue-sending'
import { useAppStore } from '../../store/app-store'
import { ToolIcon } from '../tool-icon'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

const SEND_HINT = "Judge the workload and split the issue with Hoot's built-in skill"
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
    case 'too-long':
      return <p>This issue is too long to send. Shorten it first.</p>
  }
}

/**
 * The first of an open issue's actions. It sends the issue to Claude Code, in
 * a new session in the project's main worktree that judges the issue's
 * workload and splits it with Hoot's skill; while that session is in the
 * sidebar, it shows the session instead. Its tooltip says what it does, or
 * every reason it cannot send the issue now. The tooltip's trigger wraps the
 * button, so that it also shows while the button is disabled.
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
        <Button
          variant="outline"
          size="sm"
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

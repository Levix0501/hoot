import { SendIcon } from 'lucide-react'
import type { Issue } from '../../../shared/issues'
import { getTool } from '../../../shared/tools'
import { startState, type StartBlocker, type StartState } from '../../lib/issue-start'
import { cn } from '../../lib/utils'
import { issueWorktreeOf, useAppStore } from '../../store/app-store'
import { ToolIcon } from '../tool-icon'
import { Button } from '../ui/button'
import { Spinner } from '../ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

/** What the button's tooltip says it does, when it can be used. */
const HINTS: Record<Exclude<StartState['kind'], 'blocked'>, string> = {
  show: 'Show the Claude Code session started from this issue',
  worktree: "Start Claude Code in this issue's worktree",
  'new-worktree': 'Start with Claude Code in a new worktree',
}

/** What the tooltip of a start button that cannot be used says about one of the reasons. */
function BlockerNote({ blocker }: { blocker: StartBlocker }) {
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
      return (
        <p>Set a Project for this issue first: its worktree is created in the issue's project.</p>
      )
  }
}

/**
 * The start button of an open issue, at the end of its row in the issue list
 * and on its page, where it is the same button. It starts work on the issue
 * with Claude Code, in the issue's worktree, which it creates when there is
 * none; while the session started from the issue is in the sidebar, it shows
 * that session instead. It has only an icon: a paper plane, which turns into
 * Claude Code's mark under the pointer or with the keyboard focus while it
 * can be used, and into a spinner while the issue's worktree is created. Its
 * tooltip says what it does, or why it cannot be used now, also while it is
 * disabled: the tooltip's trigger wraps the button.
 */
export function IssueStartButton({
  issue,
  tooltipSide,
  className,
}: {
  issue: Issue
  tooltipSide: 'top' | 'bottom'
  /** Places the button, as its row or its page needs. */
  className?: string
}) {
  const sessionId = useAppStore(
    (state) => state.sessions.find((session) => session.issueId === issue.id)?.id ?? null,
  )
  const tools = useAppStore((state) => state.tools)
  const worktreePath = useAppStore((state) => issueWorktreeOf(state, issue)?.path ?? null)
  const starting = useAppStore((state) => state.startingIssues.includes(issue.id))
  const startIssue = useAppStore((state) => state.startIssue)
  const action = startState(issue, { sessionId, tools, worktreePath })
  const usable = action.kind !== 'blocked'

  return (
    <Tooltip>
      <TooltipTrigger render={<span className={cn('flex shrink-0', className)} />}>
        {/* While it cannot be used, it is still what the pointer is on, like any other button. */}
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground disabled:pointer-events-auto"
          disabled={!usable}
          aria-label={usable ? HINTS[action.kind] : 'Start with Claude Code'}
          aria-busy={starting || undefined}
          onClick={() => void startIssue(issue.id)}
          data-testid="issue-start"
          data-issue-id={issue.id}
          data-action={action.kind}
          data-starting={starting || undefined}
        >
          {starting ? (
            <Spinner />
          ) : (
            <>
              <SendIcon
                className={cn(
                  usable && 'group-hover/button:hidden group-focus-visible/button:hidden',
                )}
                data-start-icon="send"
              />
              {usable && (
                <ToolIcon
                  toolId="claude"
                  className="hidden group-hover/button:block group-focus-visible/button:block"
                />
              )}
            </>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide} data-testid="issue-start-tooltip">
        {usable ? (
          HINTS[action.kind]
        ) : (
          <div className="grid gap-1">
            {action.blockers.map((blocker) => (
              <BlockerNote key={blocker} blocker={blocker} />
            ))}
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

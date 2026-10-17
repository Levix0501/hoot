import { SendIcon } from 'lucide-react'
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ISSUE_WORKFLOW } from '../../../shared/built-in-workflow'
import { issueIdentifier, type Issue } from '../../../shared/issues'
import type { StartBlocker } from '../../../shared/start-blockers'
import { getTool } from '../../../shared/tools'
import { startHint, startState } from '../../lib/issue-start'
import { cn } from '../../lib/utils'
import {
  issueProgressOf,
  issueWorktreeOf,
  latestIssueSession,
  startBlockersOf,
  useAppStore,
} from '../../store/app-store'
import { ToolIcon } from '../tool-icon'
import { Button } from '../ui/button'
import { Spinner } from '../ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

/** The issues an issue waits on, each with its identifier and title, as the tooltip lists them. */
function WaitingNote({ issueIds }: { issueIds: readonly number[] }) {
  const issues = useAppStore(
    useShallow((state) =>
      issueIds.flatMap((id) => state.issues.find((issue) => issue.id === id) ?? []),
    ),
  )
  return (
    <div className="grid gap-0.5" data-testid="issue-start-waiting">
      <p>It waits on issues that are neither done nor canceled:</p>
      <ul className="grid gap-0.5">
        {issues.map((issue) => (
          <li key={issue.id} className="flex min-w-0 gap-1.5" data-issue-id={issue.id}>
            <span className="shrink-0 tabular-nums">{issueIdentifier(issue.id)}</span>
            <span className="min-w-0 truncate" data-user-text="">
              {issue.title}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** What the tooltip of a start button that cannot be used says about one of the reasons. */
function BlockerNote({ blocker }: { blocker: StartBlocker }) {
  switch (blocker.kind) {
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
    case 'waiting':
      return <WaitingNote issueIds={blocker.issueIds} />
    case 'finished':
      return <p>Its workflow is finished: it has the label {blocker.label}.</p>
  }
}

/**
 * The start button of an open issue, at the end of its row in the issue list
 * and on its page, where it is the same button. While a session opened from
 * the issue is in the sidebar, it shows the one opened last. Otherwise it
 * starts work on the issue with Claude Code, at the step of its workflow it
 * is at, or the first, in the issue's worktree, which it creates when there
 * is none; it cannot be used while Claude Code is not found, the issue has
 * no project, waits on issues or its workflow is finished. It has only an
 * icon: a paper plane, which turns into Claude Code's mark under the pointer
 * or with the keyboard focus while it can be used, and into a spinner while
 * the issue's worktree is created. Its tooltip says what it does, or why it
 * cannot be used now, also while it is disabled: the tooltip's trigger
 * wraps the button.
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
  const sessionId = useAppStore((state) => latestIssueSession(state, issue.id)?.id ?? null)
  // As text, which stays the same while the reasons do.
  const blockerText = useAppStore((state) => JSON.stringify(startBlockersOf(state, issue)))
  const blockers = useMemo(() => JSON.parse(blockerText) as StartBlocker[], [blockerText])
  const worktreePath = useAppStore((state) => issueWorktreeOf(state, issue)?.path ?? null)
  const starting = useAppStore((state) => state.startingIssues.includes(issue.id))
  const startIssue = useAppStore((state) => state.startIssue)
  const progress = useAppStore((state) => issueProgressOf(state, issue.id))
  const action = startState({ sessionId, blockers, worktreePath })
  const hint = action.kind === 'blocked' ? null : startHint(action, progress, ISSUE_WORKFLOW)

  return (
    <Tooltip>
      <TooltipTrigger render={<span className={cn('flex shrink-0', className)} />}>
        {/* While it cannot be used, it is still what the pointer is on, like any other button. */}
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground disabled:pointer-events-auto"
          disabled={hint === null}
          aria-label={hint ?? 'Start with Claude Code'}
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
                  hint !== null && 'group-hover/button:hidden group-focus-visible/button:hidden',
                )}
                data-start-icon="send"
              />
              {hint !== null && (
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
        {action.kind !== 'blocked' ? (
          hint
        ) : (
          <div className="grid max-w-80 gap-1">
            {action.blockers.map((blocker) => (
              <BlockerNote key={blocker.kind} blocker={blocker} />
            ))}
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

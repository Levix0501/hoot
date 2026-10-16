import { useState } from 'react'
import {
  focusAfterOverlay,
  shownSubIssuesOf,
  useAppStore,
  waitCountsOf,
} from '../../store/app-store'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog'

/** What becomes of an issue's sub-issues, by how many there are. */
function subIssuesStay(count: number): string {
  return count === 1
    ? 'Its 1 sub-issue will stay, without a parent.'
    : `Its ${count} sub-issues will stay, without a parent.`
}

/** What becomes of the issues waiting on an issue, by how many there are. */
function waitingStop(count: number): string {
  return count === 1
    ? '1 issue waits on it, and will no longer be blocked by it.'
    : `${count} issues wait on it, and will no longer be blocked by it.`
}

/**
 * Asks before an issue is deleted, which cannot be undone: from its page's
 * menu, its row's context menu, or ⌘⌫. It says how many sub-issues the issue
 * has, which stay as top-level issues, and how many issues wait on it, which
 * will no longer be blocked by it.
 */
export function DeleteIssueDialog() {
  const issue = useAppStore((state) =>
    state.issues.find((candidate) => candidate.id === state.issueDeletion),
  )
  const subIssueCount = useAppStore((state) =>
    state.issueDeletion === null ? 0 : shownSubIssuesOf(state, state.issueDeletion).length,
  )
  const waitingCount = useAppStore((state) =>
    state.issueDeletion === null ? 0 : waitCountsOf(state, state.issueDeletion).waiting,
  )
  const answerDeleteIssue = useAppStore((state) => state.answerDeleteIssue)
  // Kept while the dialog fades out after the answer.
  const [title, setTitle] = useState('')
  const [count, setCount] = useState(0)
  const [waiting, setWaiting] = useState(0)
  if (issue && issue.title !== title) setTitle(issue.title)
  if (issue && subIssueCount !== count) setCount(subIssueCount)
  if (issue && waitingCount !== waiting) setWaiting(waitingCount)

  return (
    <AlertDialog
      open={issue !== undefined}
      onOpenChange={(open) => {
        if (!open) answerDeleteIssue(false)
      }}
    >
      <AlertDialogContent data-testid="delete-issue-dialog" finalFocus={focusAfterOverlay}>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this issue?</AlertDialogTitle>
          <AlertDialogDescription>
            <span
              className="font-medium text-foreground [overflow-wrap:anywhere]"
              data-user-text=""
            >
              {title}
            </span>{' '}
            will be deleted for good. This cannot be undone.
            {count > 0 && (
              <span className="mt-2 block" data-testid="delete-issue-sub-issues">
                {subIssuesStay(count)}
              </span>
            )}
            {waiting > 0 && (
              <span className="mt-2 block" data-testid="delete-issue-waiting" data-count={waiting}>
                {waitingStop(waiting)}
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="delete-issue-cancel">Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => answerDeleteIssue(true)}
            data-testid="delete-issue-confirm"
          >
            Delete Issue
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

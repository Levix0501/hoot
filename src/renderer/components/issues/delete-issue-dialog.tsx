import { useState } from 'react'
import { focusAfterOverlay, useAppStore } from '../../store/app-store'
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

/**
 * Asks before an issue is deleted, which cannot be undone: from its page's
 * menu, its row's context menu, or ⌘⌫.
 */
export function DeleteIssueDialog() {
  const issue = useAppStore((state) =>
    state.issues.find((candidate) => candidate.id === state.issueDeletion),
  )
  const answerDeleteIssue = useAppStore((state) => state.answerDeleteIssue)
  // Kept while the dialog fades out after the answer.
  const [title, setTitle] = useState('')
  if (issue && issue.title !== title) setTitle(issue.title)

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

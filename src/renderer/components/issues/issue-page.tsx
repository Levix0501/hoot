import { CircleCheckIcon, CircleDotIcon, PencilIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import {
  ISSUE_DESCRIPTION_MAX_LENGTH,
  ISSUE_TITLE_MAX_LENGTH,
  issueTitle,
  type Issue,
} from '../../../shared/issues'
import { useAppStore } from '../../store/app-store'
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
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { ClaudeCodeButton } from './claude-code-button'
import { IssueDescription } from './issue-description'
import { BackToIssues, IssuesTopRow, ProjectName } from './issues-top-row'
import { RelativeTime, useNow } from './relative-time'

/** Open or Closed, the way GitHub shows it. */
function StateBadge({ issue }: { issue: Issue }) {
  const open = issue.state === 'open'
  return (
    <Badge
      className={
        open
          ? 'bg-emerald-600 text-white dark:bg-emerald-700'
          : 'bg-violet-600 text-white dark:bg-violet-700'
      }
      data-testid="issue-state"
      data-state={issue.state}
    >
      {open ? <CircleDotIcon /> : <CircleCheckIcon />}
      {open ? 'Open' : 'Closed'}
    </Badge>
  )
}

/** Asks before an issue is deleted, which cannot be undone. */
function DeleteIssueDialog({
  issue,
  open,
  onOpenChange,
}: {
  issue: Issue
  open: boolean
  onOpenChange(open: boolean): void
}) {
  const deleteIssue = useAppStore((state) => state.deleteIssue)
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="delete-issue-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this issue?</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-medium break-words text-foreground" data-user-text="">
              {issue.title}
            </span>{' '}
            will be deleted for good. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="delete-issue-cancel">Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              onOpenChange(false)
              void deleteIssue(issue.id)
            }}
            data-testid="delete-issue-confirm"
          >
            Delete Issue
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * An issue's page: its title, state, when it was opened and its description,
 * with buttons to send it to Claude Code while it is open, edit it, close or
 * reopen it and delete it. In the edit state, the title and description are
 * fields in their places, kept as they are while other pages are shown, until
 * Save or Cancel.
 */
export function IssuePage({ issueId }: { issueId: number }) {
  const issue = useAppStore((state) => state.issues.find(({ id }) => id === issueId))
  const edit = useAppStore((state) => state.issueEdits[issueId])
  const startEditingIssue = useAppStore((state) => state.startEditingIssue)
  const updateIssueEdit = useAppStore((state) => state.updateIssueEdit)
  const saveIssueEdit = useAppStore((state) => state.saveIssueEdit)
  const cancelIssueEdit = useAppStore((state) => state.cancelIssueEdit)
  const setIssueState = useAppStore((state) => state.setIssueState)
  const [busy, setBusy] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const now = useNow()
  if (!issue) return null

  const run = async (change: () => Promise<void>) => {
    setBusy(true)
    try {
      await change()
    } finally {
      setBusy(false)
    }
  }
  const editing = edit !== undefined

  return (
    <div
      className="flex min-h-0 flex-1 flex-col bg-background text-foreground"
      data-testid="issue-page"
      data-issue-id={issue.id}
      data-editing={editing}
    >
      <IssuesTopRow>
        <BackToIssues projectId={issue.projectId} />
        <ProjectName projectId={issue.projectId} />
      </IssuesTopRow>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 pt-2 pb-6">
          {editing ? (
            <Input
              value={edit.title}
              maxLength={ISSUE_TITLE_MAX_LENGTH}
              onChange={(event) =>
                updateIssueEdit(issue.id, { ...edit, title: event.target.value })
              }
              aria-label="Title"
              spellCheck={false}
              autoFocus
              className="h-9 text-lg font-semibold md:text-lg"
              data-testid="issue-title-input"
            />
          ) : (
            <h1
              className="text-xl font-semibold break-words"
              data-user-text=""
              data-testid="issue-title"
            >
              {issue.title}
            </h1>
          )}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-3 text-sm">
            <StateBadge issue={issue} />
            <span className="text-muted-foreground">
              opened <RelativeTime time={issue.createdAt} now={now} data-testid="issue-created" />
            </span>
            {!editing && (
              <div
                className="ml-auto flex flex-wrap gap-2"
                key="actions"
                data-testid="issue-actions"
              >
                {issue.state === 'open' && <ClaudeCodeButton issue={issue} />}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => startEditingIssue(issue.id)}
                  data-testid="issue-edit"
                >
                  <PencilIcon />
                  Edit
                </Button>
                {issue.state === 'open' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void run(() => setIssueState(issue.id, 'closed'))}
                    data-testid="issue-close"
                  >
                    <CircleCheckIcon />
                    Close Issue
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void run(() => setIssueState(issue.id, 'open'))}
                    data-testid="issue-reopen"
                  >
                    <CircleDotIcon />
                    Reopen Issue
                  </Button>
                )}
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={busy}
                  onClick={() => setConfirmingDelete(true)}
                  data-testid="issue-delete"
                >
                  <Trash2Icon />
                  Delete
                </Button>
              </div>
            )}
          </div>
          {editing ? (
            <>
              <Textarea
                value={edit.description}
                maxLength={ISSUE_DESCRIPTION_MAX_LENGTH}
                onChange={(event) =>
                  updateIssueEdit(issue.id, { ...edit, description: event.target.value })
                }
                aria-label="Description"
                placeholder="Add a description. Markdown is supported."
                spellCheck={false}
                className="max-h-[calc(100svh-10rem)] min-h-48"
                data-testid="issue-description-input"
              />
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => cancelIssueEdit(issue.id)}
                  data-testid="issue-cancel-edit"
                >
                  Cancel
                </Button>
                {/* While it cannot save, it is still what the pointer is on, like any other button. */}
                <Button
                  className="disabled:pointer-events-auto"
                  disabled={busy || issueTitle(edit.title) === ''}
                  onClick={() => void run(() => saveIssueEdit(issue.id))}
                  data-testid="issue-save"
                >
                  Save
                </Button>
              </div>
            </>
          ) : (
            <div className="border-t pt-4">
              <IssueDescription markdown={issue.description} />
            </div>
          )}
        </div>
      </div>
      <DeleteIssueDialog issue={issue} open={confirmingDelete} onOpenChange={setConfirmingDelete} />
    </div>
  )
}

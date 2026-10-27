import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  inspectionIsClean,
  type RepositoryChanges,
  type WorktreeInspection,
} from '../../shared/worktrees'
import {
  focusAfterOverlay,
  runningSessionsWithin,
  shownSessionName,
  useAppStore,
  type WorktreeDeletion,
} from '../store/app-store'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog'
import { Spinner } from './ui/spinner'

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/** The folders that deleting the worktree deletes, and the branches it keeps. */
function WhatIsDeleted({ inspection }: { inspection: WorktreeInspection }) {
  const folders = [inspection.root, ...inspection.innerMembers]
  return (
    <div className="grid gap-1.5">
      <p>
        {folders.length === 1 ? 'This folder will be deleted:' : 'These folders will be deleted:'}
      </p>
      <ul className="grid gap-0.5" data-testid="worktree-delete-folders">
        {folders.map((folder) => (
          <li
            key={folder}
            className="font-mono text-xs break-all text-foreground"
            data-path=""
            data-testid="worktree-delete-folder"
          >
            {folder}
          </li>
        ))}
      </ul>
      <p data-testid="worktree-delete-branches">
        {inspection.branch === null ? (
          'No branch will be deleted.'
        ) : (
          <>
            The branch <span data-user-text="">{inspection.branch}</span> will be kept
            {inspection.innerMembers.length > 0 ? ' in every repository.' : '.'}
          </>
        )}
      </p>
    </div>
  )
}

/** What a repository of the worktree would lose. */
function RepositoryLoss({ changes }: { changes: RepositoryChanges }) {
  const more = changes.total - changes.files.length
  return (
    <li
      className="grid gap-1"
      data-testid="worktree-changes"
      data-repository={changes.repository}
      data-total={changes.total}
    >
      <span className="font-medium text-foreground">
        <span className="font-mono" data-path="">
          {changes.repository}
        </span>
        {changes.total > 0 && (
          <span data-testid="worktree-changes-total">
            {' '}
            — {plural(changes.total, 'changed file', 'changed files')}
          </span>
        )}
      </span>
      {changes.files.length > 0 && (
        <ul className="grid gap-0.5 pl-3">
          {changes.files.map((file) => (
            <li
              key={file}
              className="font-mono text-xs break-all"
              data-path=""
              data-testid="worktree-changed-file"
            >
              {file}
            </li>
          ))}
          {more > 0 && <li className="text-xs">and {plural(more, 'more file', 'more files')}</li>}
        </ul>
      )}
      {changes.detachedCommits && (
        <span className="pl-3 text-xs" data-testid="worktree-detached-commits">
          It has commits that are not on any branch.
        </span>
      )}
    </li>
  )
}

/** Everything that deleting the worktree would lose. */
function WhatIsLost({ inspection }: { inspection: WorktreeInspection }) {
  return (
    <div className="grid gap-3">
      {inspection.changes.length > 0 && (
        <div className="grid gap-1.5">
          <p>These repositories have changes that will be lost:</p>
          <ul className="grid gap-2">
            {inspection.changes.map((changes) => (
              <RepositoryLoss key={changes.repository} changes={changes} />
            ))}
          </ul>
        </div>
      )}
      {inspection.foreignRepositories.length > 0 && (
        <div className="grid gap-1.5">
          <p>These repositories are not part of the worktree and will be deleted with it:</p>
          <ul className="grid gap-0.5" data-testid="worktree-foreign-repositories">
            {inspection.foreignRepositories.map((repository) => (
              <li
                key={repository}
                className="font-mono text-xs break-all text-foreground"
                data-path=""
                data-testid="worktree-foreign-repository"
              >
                {repository}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/**
 * The sessions still running in the worktree, which end before it is
 * deleted, and that it may change until they have.
 */
function RunningSessions({ names }: { names: readonly string[] }) {
  const one = names.length === 1
  return (
    <div className="grid gap-1.5" data-testid="worktree-delete-sessions">
      <p>
        {one
          ? 'This session is still running in the worktree, and will be ended first:'
          : 'These sessions are still running in the worktree, and will be ended first:'}
      </p>
      <ul className="grid gap-0.5">
        {names.map((name, index) => (
          <li
            key={index}
            className="font-medium text-foreground [overflow-wrap:anywhere]"
            data-user-text=""
            data-testid="worktree-delete-session"
          >
            {name}
          </li>
        ))}
      </ul>
      <p data-testid="worktree-delete-sessions-note">
        Until {one ? 'it ends' : 'they end'}, what is in the worktree may still change, and is
        deleted as it is then.
      </p>
    </div>
  )
}

function DeletionBody({ deletion }: { deletion: WorktreeDeletion }) {
  // While asking, the sessions running now; once confirmed, those it listed.
  const running = useAppStore(
    useShallow((state) =>
      runningSessionsWithin(state, deletion.path).map((session) =>
        shownSessionName(state, session),
      ),
    ),
  )
  const sessions = deletion.endingSessions ?? running
  if (deletion.phase === 'checking' || (!deletion.inspection && !deletion.error)) {
    return (
      <p className="flex items-center gap-2" data-testid="worktree-delete-checking">
        <Spinner />
        Checking the worktree for changes…
      </p>
    )
  }
  return (
    <div className="grid max-h-[60vh] gap-3 overflow-y-auto text-left">
      {deletion.inspection && !inspectionIsClean(deletion.inspection) && (
        <WhatIsLost inspection={deletion.inspection} />
      )}
      {deletion.inspection && sessions.length > 0 && <RunningSessions names={sessions} />}
      {deletion.inspection && <WhatIsDeleted inspection={deletion.inspection} />}
      {deletion.error && (
        <p
          className="font-mono text-xs whitespace-pre-wrap text-destructive"
          role="alert"
          data-path=""
          data-testid="worktree-delete-error"
        >
          {deletion.error}
        </p>
      )}
    </div>
  )
}

/**
 * Asks before a worktree is deleted, after checking it: what will be
 * deleted, that branches are kept, the sessions still running in it, which
 * end first, and, repository by repository, the changes, detached commits
 * and foreign repositories that would be lost.
 */
export function DeleteWorktreeDialog() {
  const deletion = useAppStore((state) => state.worktreeDeletion)
  const answer = useAppStore((state) => state.answerDeleteWorktree)
  // Kept while the dialog fades out after the answer.
  const [shown, setShown] = useState<WorktreeDeletion | null>(null)
  if (deletion !== null && deletion !== shown) setShown(deletion)
  const current = deletion ?? shown
  const dirty = current?.inspection ? !inspectionIsClean(current.inspection) : false
  const deleting = current?.phase === 'deleting'
  const ready = current?.phase === 'confirm' && current.inspection !== null

  return (
    <AlertDialog
      open={deletion !== null}
      onOpenChange={(open) => {
        if (!open && !deleting) void answer(false)
      }}
    >
      <AlertDialogContent
        className="data-[size=default]:max-w-md data-[size=default]:sm:max-w-lg"
        finalFocus={focusAfterOverlay}
        data-testid="delete-worktree-dialog"
        data-phase={current?.phase}
        data-dirty={dirty}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            {dirty ? 'Discard changes and delete this worktree?' : 'Delete this worktree?'}
          </AlertDialogTitle>
          <AlertDialogDescription render={<div />} className="w-full">
            {current && <DeletionBody deletion={current} />}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting} data-testid="worktree-delete-cancel">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={!ready || deleting}
            onClick={() => void answer(true)}
            data-testid="worktree-delete-confirm"
          >
            {deleting && <Spinner />}
            {deleting ? 'Deleting…' : dirty ? 'Discard Changes and Delete' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

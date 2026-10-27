import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  focusAfterOverlay,
  openSessionsOf,
  projectWorktreeRows,
  shownSessionName,
  useAppStore,
  type WorktreeRemoval,
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

/** The open sessions of the worktree, which close before it is removed. */
function OpenSessions({ names }: { names: readonly string[] }) {
  return (
    <div className="grid gap-1.5" data-testid="worktree-remove-sessions">
      <p>
        {names.length === 1
          ? 'This session is still open in it, and will be closed first:'
          : 'These sessions are still open in it, and will be closed first:'}
      </p>
      <ul className="grid gap-0.5">
        {names.map((name, index) => (
          <li
            key={index}
            className="font-medium text-foreground [overflow-wrap:anywhere]"
            data-user-text=""
            data-testid="worktree-remove-session"
          >
            {name}
          </li>
        ))}
      </ul>
    </div>
  )
}

function RemovalBody({ removal }: { removal: WorktreeRemoval }) {
  // While asking, the sessions open now; once confirmed, those it listed.
  const open = useAppStore(
    useShallow((state) =>
      openSessionsOf(state, removal.projectRoot, removal.path).map((session) =>
        shownSessionName(state, session),
      ),
    ),
  )
  const names = removal.closingSessions ?? open
  return (
    <div className="grid gap-3 text-left">
      <p>The folder of this worktree is missing.</p>
      {names.length > 0 && <OpenSessions names={names} />}
      <p>Its saved sessions are removed from Hoot too. No branch is deleted.</p>
    </div>
  )
}

/**
 * Asks before a missing worktree some of whose sessions are open is
 * removed: which sessions close first, which ends the processes of those
 * still running. Once the worktree is gone without it, as when its sessions
 * close by themselves and it is cleaned up, it stops asking.
 */
export function RemoveWorktreeDialog() {
  const removal = useAppStore((state) => state.worktreeRemoval)
  const answer = useAppStore((state) => state.answerRemoveWorktree)
  const shownAsMissing = useAppStore(
    (state) =>
      removal !== null &&
      projectWorktreeRows(state, removal.projectRoot).some(
        (row) => row.path === removal.path && row.missing,
      ),
  )
  // Kept while the dialog fades out after the answer.
  const [shown, setShown] = useState<WorktreeRemoval | null>(null)
  if (removal !== null && removal !== shown) setShown(removal)
  const current = removal ?? shown
  const removing = current?.phase === 'removing'

  useEffect(() => {
    if (removal?.phase === 'confirm' && !shownAsMissing) void answer(false)
  }, [removal, shownAsMissing, answer])

  return (
    <AlertDialog
      open={removal !== null}
      onOpenChange={(open) => {
        if (!open && !removing) void answer(false)
      }}
    >
      <AlertDialogContent
        finalFocus={focusAfterOverlay}
        data-testid="remove-worktree-dialog"
        data-phase={current?.phase}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Remove this worktree?</AlertDialogTitle>
          <AlertDialogDescription render={<div />} className="w-full">
            {current && <RemovalBody removal={current} />}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={removing} data-testid="worktree-remove-cancel">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={removing}
            onClick={() => void answer(true)}
            data-testid="worktree-remove-confirm"
          >
            {removing && <Spinner />}
            {removing ? 'Removing…' : 'Remove'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

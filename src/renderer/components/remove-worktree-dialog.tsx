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
  const openNames = useAppStore(
    useShallow((state) =>
      removal === null
        ? []
        : openSessionsOf(state, removal.projectRoot, removal.path).map((session) =>
            shownSessionName(state, session),
          ),
    ),
  )
  // As it asked last, kept while the dialog fades out after the answer,
  // which takes the sessions out at once.
  const [shown, setShown] = useState<{ removal: WorktreeRemoval; names: string[] } | null>(null)
  if (removal !== null && (removal !== shown?.removal || openNames !== shown?.names)) {
    setShown({ removal, names: openNames })
  }
  const names = shown?.names ?? []

  useEffect(() => {
    if (removal !== null && !shownAsMissing) void answer(false)
  }, [removal, shownAsMissing, answer])

  return (
    <AlertDialog
      open={removal !== null}
      onOpenChange={(open) => {
        if (!open) void answer(false)
      }}
    >
      <AlertDialogContent finalFocus={focusAfterOverlay} data-testid="remove-worktree-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Remove this worktree?</AlertDialogTitle>
          <AlertDialogDescription render={<div />} className="w-full">
            <div className="grid gap-3 text-left">
              <p>The folder of this worktree is missing.</p>
              {names.length > 0 && <OpenSessions names={names} />}
              <p>Its saved sessions are removed from Hoot too. No branch is deleted.</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="worktree-remove-cancel">Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => void answer(true)}
            data-testid="worktree-remove-confirm"
          >
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

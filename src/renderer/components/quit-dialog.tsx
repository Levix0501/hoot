import { useEffect, useRef, useState } from 'react'
import { describeRunningSessions, quitConfirmationLabel } from '../../shared/session'
import { focusAfterOverlay, useAppStore } from '../store/app-store'
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

export function QuitDialog() {
  const confirmation = useAppStore((state) => state.quitConfirmation)
  const answerQuit = useAppStore((state) => state.answerQuit)
  const open = confirmation !== null
  // Kept while the dialog fades out after the answer.
  const [runningSessions, setRunningSessions] = useState(1)
  if (confirmation && confirmation.runningSessions !== runningSessions) {
    setRunningSessions(confirmation.runningSessions)
  }
  const answered = useRef(false)
  useEffect(() => {
    if (open) answered.current = false
  }, [open])

  const answer = (confirmed: boolean) => {
    if (answered.current) return
    answered.current = true
    answerQuit(confirmed)
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) answer(false)
      }}
    >
      <AlertDialogContent data-testid="quit-dialog" finalFocus={focusAfterOverlay}>
        <AlertDialogHeader>
          <AlertDialogTitle>Quit Hoot?</AlertDialogTitle>
          <AlertDialogDescription data-testid="quit-dialog-description">
            {describeRunningSessions(runningSessions)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="quit-cancel">Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => answer(true)}
            data-testid="quit-confirm"
          >
            {quitConfirmationLabel(runningSessions)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

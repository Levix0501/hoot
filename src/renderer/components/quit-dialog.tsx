import { useEffect, useRef, useState } from 'react'
import { describeQuit, quitConfirmationLabel, quitQuestion } from '../../shared/session'
import { focusAfterOverlay, useAppStore, type AppState } from '../store/app-store'
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
  const [shown, setShown] = useState<NonNullable<AppState['quitConfirmation']>>({
    runningSessions: 1,
    reason: 'quit',
    agentOperations: [],
  })
  if (confirmation && confirmation !== shown) setShown(confirmation)
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
          <AlertDialogTitle>{quitQuestion(shown.reason)}</AlertDialogTitle>
          <AlertDialogDescription data-testid="quit-dialog-description">
            {describeQuit(shown.runningSessions, shown.reason, shown.agentOperations)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="quit-cancel">Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => answer(true)}
            data-testid="quit-confirm"
          >
            {quitConfirmationLabel(shown.runningSessions, shown.reason)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

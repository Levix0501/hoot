import { useState } from 'react'
import { sessionName } from '../../shared/session'
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

/** Asks before a running session is closed, which ends its process. */
export function CloseSessionDialog() {
  const session = useAppStore((state) =>
    state.sessions.find((candidate) => candidate.id === state.closeConfirmation),
  )
  const answerCloseConfirmation = useAppStore((state) => state.answerCloseConfirmation)
  // Kept while the dialog fades out after the answer.
  const [name, setName] = useState('')
  if (session && sessionName(session) !== name) setName(sessionName(session))

  return (
    <AlertDialog
      open={session !== undefined}
      onOpenChange={(open) => {
        if (!open) answerCloseConfirmation(false)
      }}
    >
      <AlertDialogContent data-testid="close-session-dialog" finalFocus={focusAfterOverlay}>
        <AlertDialogHeader>
          <AlertDialogTitle>Close this session?</AlertDialogTitle>
          <AlertDialogDescription>
            <span
              className="font-medium text-foreground [overflow-wrap:anywhere]"
              data-session-name=""
            >
              {name}
            </span>{' '}
            is still running. Closing the session ends its process.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="close-session-cancel">Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => answerCloseConfirmation(true)}
            data-testid="close-session-confirm"
          >
            Close Session
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

import { useState } from 'react'
import { sessionName } from '../../shared/session'
import { focusAfterOverlay, useAppStore } from '../store/app-store'
import { Checkbox } from './ui/checkbox'
import { Label } from './ui/label'
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

/**
 * Asks before a running session is closed, which ends its process. Below the
 * text, Don't ask again, unchecked each time the dialog opens, turns asking
 * off once the session is closed with it checked; the Agents page turns it
 * on again.
 */
export function CloseSessionDialog() {
  const session = useAppStore((state) =>
    state.sessions.find((candidate) => candidate.id === state.closeConfirmation),
  )
  const answerCloseConfirmation = useAppStore((state) => state.answerCloseConfirmation)
  // Kept while the dialog fades out after the answer.
  const [name, setName] = useState('')
  if (session && sessionName(session) !== name) setName(sessionName(session))
  const [dontAskAgain, setDontAskAgain] = useState(false)
  // Unchecked each time the dialog opens, also again for the same session.
  const asked = session?.id ?? null
  const [askedFor, setAskedFor] = useState<string | null>(null)
  if (asked !== askedFor) {
    setAskedFor(asked)
    if (asked !== null) setDontAskAgain(false)
  }

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
        <Label className="font-normal">
          <Checkbox
            checked={dontAskAgain}
            onCheckedChange={setDontAskAgain}
            data-testid="close-session-dont-ask"
          />
          Don't ask again
        </Label>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="close-session-cancel">Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => answerCloseConfirmation(true, dontAskAgain)}
            data-testid="close-session-confirm"
          >
            Close Session
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

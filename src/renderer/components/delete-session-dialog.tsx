import { useState } from 'react'
import { chatName } from '../../shared/chats'
import { focusAfterOverlay, isSessionRunning, useAppStore } from '../store/app-store'
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
 * Asks before a chat or saved session is deleted, every time: it says that
 * the session goes from Hoot, and, while its agent runs, that Hoot ends the
 * agent first.
 */
export function DeleteSessionDialog() {
  const record = useAppStore((state) =>
    state.sessionDeletion === null
      ? undefined
      : (state.chats.find((chat) => chat.id === state.sessionDeletion) ??
        state.savedSessions.find((saved) => saved.id === state.sessionDeletion)),
  )
  const running = useAppStore(
    (state) =>
      state.sessionDeletion !== null &&
      state.sessions.some(
        (session) =>
          (session.chatId === state.sessionDeletion ||
            session.savedSessionId === state.sessionDeletion) &&
          isSessionRunning(session),
      ),
  )
  const answerDeleteSession = useAppStore((state) => state.answerDeleteSession)
  // Kept while the dialog fades out after the answer.
  const [name, setName] = useState('')
  const [wasRunning, setWasRunning] = useState(false)
  if (record && chatName(record) !== name) setName(chatName(record))
  if (record && running !== wasRunning) setWasRunning(running)

  return (
    <AlertDialog
      open={record !== undefined}
      onOpenChange={(open) => {
        if (!open) void answerDeleteSession(false)
      }}
    >
      <AlertDialogContent data-testid="delete-session-dialog" finalFocus={focusAfterOverlay}>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this session?</AlertDialogTitle>
          <AlertDialogDescription>
            <span
              className="font-medium text-foreground [overflow-wrap:anywhere]"
              data-session-name=""
            >
              {name}
            </span>{' '}
            will be removed from Hoot.
            {wasRunning && (
              <span className="mt-2 block" data-testid="delete-session-running">
                It is still running: Hoot ends its agent first.
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="delete-session-cancel">Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => void answerDeleteSession(true)}
            data-testid="delete-session-confirm"
          >
            Delete Session
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

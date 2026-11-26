import { useState } from 'react'
import { chatName } from '../../shared/chats'
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

/**
 * Asks before an archived chat or saved session is deleted for good, as the
 * Archive page's Delete does: the session leaves Hoot for good, and a chat's
 * own folder goes to the Trash.
 */
export function DeleteArchivedSessionDialog() {
  const record = useAppStore((state) =>
    state.sessionDeletion === null
      ? undefined
      : state.archivedSessions.find((entry) => entry.id === state.sessionDeletion),
  )
  const answerDeleteSession = useAppStore((state) => state.answerDeleteSession)
  // Kept while the dialog fades out after the answer.
  const [name, setName] = useState('')
  if (record && chatName(record) !== name) setName(chatName(record))

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
            will be removed from Hoot for good.
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

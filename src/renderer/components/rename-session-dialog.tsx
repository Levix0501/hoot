import { useState } from 'react'
import { defaultSessionName, sessionName } from '../../shared/session'
import { focusAfterOverlay, useAppStore, type UiSession } from '../store/app-store'
import { Button } from './ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Input } from './ui/input'

/** The name field and buttons of the rename dialog, which start from the session's name. */
function RenameSessionForm({
  session,
  onRename,
}: {
  session: UiSession
  onRename: (name: string) => void
}) {
  const [name, setName] = useState(() => sessionName(session))

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        onRename(name)
      }}
    >
      <DialogHeader>
        <DialogTitle>Rename Session</DialogTitle>
      </DialogHeader>
      <Input
        value={name}
        onChange={(event) => setName(event.target.value)}
        // All of it, so that what is typed replaces it.
        onFocus={(event) => event.currentTarget.select()}
        autoFocus
        spellCheck={false}
        autoComplete="off"
        // The name an empty one gives the session.
        placeholder={defaultSessionName(session.toolId, session.title)}
        aria-label="Session name"
        data-testid="session-rename-input"
      />
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />} data-testid="session-rename-cancel">
          Cancel
        </DialogClose>
        <Button type="submit" data-testid="session-rename-confirm">
          Rename
        </Button>
      </DialogFooter>
    </form>
  )
}

/**
 * Renames a session: Rename or Enter gives it the name typed, or its default
 * name again when that is empty; Cancel or Esc keeps its name.
 */
export function RenameSessionDialog() {
  const session = useAppStore((state) =>
    state.sessions.find((candidate) => candidate.id === state.renamingSessionId),
  )
  const finishRenaming = useAppStore((state) => state.finishRenaming)
  // Kept while the dialog fades out after it closes.
  const [shown, setShown] = useState(session)
  if (session && session !== shown) setShown(session)

  return (
    <Dialog
      open={session !== undefined}
      onOpenChange={(open) => {
        if (!open && session) finishRenaming(session.id, null)
      }}
    >
      <DialogContent
        showCloseButton={false}
        finalFocus={focusAfterOverlay}
        data-testid="rename-session-dialog"
      >
        {shown && (
          <RenameSessionForm
            key={shown.id}
            session={shown}
            onRename={(name) => finishRenaming(shown.id, name)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

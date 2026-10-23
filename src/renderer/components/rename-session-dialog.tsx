import { useState } from 'react'
import { defaultSessionName, sessionName } from '../../shared/session'
import { chatName, type ChatInfo, type SavedSessionInfo } from '../../shared/chats'
import { focusAfterOverlay, useAppStore } from '../store/app-store'
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

/** The name field and buttons of a rename dialog, which start from the name something has. */
function RenameForm({
  title,
  name: initialName,
  placeholder,
  ariaLabel,
  testId,
  onRename,
}: {
  title: string
  name: string
  placeholder: string
  ariaLabel: string
  testId: string
  onRename: (name: string) => void
}) {
  const [name, setName] = useState(initialName)

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        onRename(name)
      }}
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <Input
        value={name}
        onChange={(event) => setName(event.target.value)}
        // All of it, so that what is typed replaces it.
        onFocus={(event) => event.currentTarget.select()}
        autoFocus
        spellCheck={false}
        autoComplete="off"
        // The name an empty one gives it.
        placeholder={placeholder}
        aria-label={ariaLabel}
        data-testid={testId}
      />
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />} data-testid={`${testId}-cancel`}>
          Cancel
        </DialogClose>
        <Button type="submit" data-testid={`${testId}-confirm`}>
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
          <RenameForm
            key={shown.id}
            title="Rename Session"
            name={sessionName(shown)}
            placeholder={defaultSessionName(shown.toolId, shown.title)}
            ariaLabel="Session name"
            testId="session-rename-input"
            onRename={(name) => finishRenaming(shown.id, name)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Renames a saved session, as a chat's rename dialog renames a chat. */
export function RenameSavedSessionDialog() {
  const saved = useAppStore((state) =>
    state.savedSessions.find((candidate) => candidate.id === state.renamingSavedSessionId),
  )
  const finishRenaming = useAppStore((state) => state.finishRenamingSavedSession)
  const [shown, setShown] = useState<SavedSessionInfo | undefined>(saved)
  if (saved && saved !== shown) setShown(saved)

  return (
    <Dialog
      open={saved !== undefined}
      onOpenChange={(open) => {
        if (!open && saved) finishRenaming(saved.id, null)
      }}
    >
      <DialogContent
        showCloseButton={false}
        finalFocus={focusAfterOverlay}
        data-testid="rename-saved-session-dialog"
      >
        {shown && (
          <RenameForm
            key={shown.id}
            title="Rename Session"
            name={chatName(shown)}
            placeholder={defaultSessionName(shown.toolId, shown.title)}
            ariaLabel="Session name"
            testId="saved-session-rename-input"
            onRename={(name) => finishRenaming(shown.id, name)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Renames a chat, as a session's rename dialog renames a session. */
export function RenameChatDialog() {
  const chat = useAppStore((state) =>
    state.chats.find((candidate) => candidate.id === state.renamingChatId),
  )
  const finishRenamingChat = useAppStore((state) => state.finishRenamingChat)
  const [shown, setShown] = useState<ChatInfo | undefined>(chat)
  if (chat && chat !== shown) setShown(chat)

  return (
    <Dialog
      open={chat !== undefined}
      onOpenChange={(open) => {
        if (!open && chat) finishRenamingChat(chat.id, null)
      }}
    >
      <DialogContent
        showCloseButton={false}
        finalFocus={focusAfterOverlay}
        data-testid="rename-chat-dialog"
      >
        {shown && (
          <RenameForm
            key={shown.id}
            title="Rename Chat"
            name={chatName(shown)}
            placeholder={defaultSessionName(shown.toolId, shown.title)}
            ariaLabel="Chat name"
            testId="chat-rename-input"
            onRename={(name) => finishRenamingChat(shown.id, name)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

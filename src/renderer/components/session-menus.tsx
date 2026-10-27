import { PencilIcon, Trash2Icon, XIcon } from 'lucide-react'
import {
  focusAfterOverlay,
  isSessionRunning,
  useAppStore,
  type UiSession,
} from '../store/app-store'
import { ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from './ui/context-menu'

/**
 * Where the keyboard focus goes as a session's context menu closes: to the
 * dialog an item opened, which takes it, or else where it goes after a menu.
 */
function focusAfterSessionMenu(dialogOpened: () => boolean): () => HTMLElement | boolean {
  return () => (dialogOpened() ? false : focusAfterOverlay())
}

/**
 * The context menu of a saved session, the same on its row in the sidebar
 * and on its tab: Rename…, Close while its agent runs, and Delete, whether or
 * not it runs. `testId` is the prefix of the items' test ids.
 */
export function SavedSessionMenu({ savedId, testId }: { savedId: string; testId: string }) {
  const running = useAppStore((state) =>
    state.sessions.find(
      (session) => session.savedSessionId === savedId && isSessionRunning(session),
    ),
  )
  const startRenaming = useAppStore((state) => state.startRenamingSavedSession)
  const close = useAppStore((state) => state.closeSavedSession)
  const requestDelete = useAppStore((state) => state.requestDeleteSession)
  return (
    <ContextMenuContent
      className="w-auto min-w-36"
      finalFocus={focusAfterSessionMenu(() => {
        const state = useAppStore.getState()
        return state.renamingSavedSessionId === savedId || state.sessionDeletion === savedId
      })}
    >
      <ContextMenuItem onClick={() => startRenaming(savedId)} data-testid={`${testId}-rename`}>
        <PencilIcon />
        Rename…
      </ContextMenuItem>
      <ContextMenuSeparator />
      {running && (
        <ContextMenuItem
          variant="destructive"
          disabled={running.closing}
          onClick={() => close(savedId)}
          data-testid={`${testId}-close`}
        >
          <XIcon />
          Close
        </ContextMenuItem>
      )}
      <ContextMenuItem
        variant="destructive"
        onClick={() => requestDelete(savedId)}
        data-testid={`${testId}-delete`}
      >
        <Trash2Icon />
        Delete
      </ContextMenuItem>
    </ContextMenuContent>
  )
}

/**
 * The context menu of a chat's row in the sidebar: Rename…, Close while its
 * agent runs, and Delete, whether or not it runs.
 */
export function ChatMenu({ chatId, testId }: { chatId: string; testId: string }) {
  const running = useAppStore((state) =>
    state.sessions.find((session) => session.chatId === chatId && isSessionRunning(session)),
  )
  const startRenaming = useAppStore((state) => state.startRenamingChat)
  const close = useAppStore((state) => state.closeChat)
  const requestDelete = useAppStore((state) => state.requestDeleteSession)
  return (
    <ContextMenuContent
      className="w-auto min-w-36"
      finalFocus={focusAfterSessionMenu(() => {
        const state = useAppStore.getState()
        return state.renamingChatId === chatId || state.sessionDeletion === chatId
      })}
    >
      <ContextMenuItem onClick={() => startRenaming(chatId)} data-testid={`${testId}-rename`}>
        <PencilIcon />
        Rename…
      </ContextMenuItem>
      <ContextMenuSeparator />
      {running && (
        <ContextMenuItem
          variant="destructive"
          disabled={running.closing}
          onClick={() => close(chatId)}
          data-testid={`${testId}-close`}
        >
          <XIcon />
          Close
        </ContextMenuItem>
      )}
      <ContextMenuItem
        variant="destructive"
        onClick={() => requestDelete(chatId)}
        data-testid={`${testId}-delete`}
      >
        <Trash2Icon />
        Delete
      </ContextMenuItem>
    </ContextMenuContent>
  )
}

/**
 * The context menu of a session Hoot does not keep, such as one started for
 * an issue, the same on its row in the sidebar and on its tab: Rename… and
 * Close, which takes it away.
 */
export function SessionMenu({ session, testId }: { session: UiSession; testId: string }) {
  const startRenaming = useAppStore((state) => state.startRenaming)
  const requestCloseSession = useAppStore((state) => state.requestCloseSession)
  return (
    <ContextMenuContent
      className="w-auto min-w-36"
      // The rename dialog takes the focus; otherwise it returns to the terminal.
      finalFocus={focusAfterSessionMenu(
        () => useAppStore.getState().renamingSessionId === session.id,
      )}
    >
      <ContextMenuItem onClick={() => startRenaming(session.id)} data-testid={`${testId}-rename`}>
        <PencilIcon />
        Rename…
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        variant="destructive"
        disabled={session.closing}
        onClick={() => requestCloseSession(session.id)}
        data-testid={`${testId}-close`}
      >
        <XIcon />
        Close
      </ContextMenuItem>
    </ContextMenuContent>
  )
}

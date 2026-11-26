import { PencilIcon, XIcon } from 'lucide-react'
import { focusAfterOverlay, useAppStore, type UiSession } from '../store/app-store'
import { ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from './ui/context-menu'

/**
 * Where the keyboard focus goes as a session's context menu closes: to the
 * dialog an item opened, which takes it, or else where it goes after a menu.
 */
function focusAfterSessionMenu(dialogOpened: () => boolean): () => HTMLElement | boolean {
  return () => (dialogOpened() ? false : focusAfterOverlay())
}

/**
 * The class of the menus a tab shares with its session's row in the sidebar.
 * Opened on a tab, such a menu lies partly over the window's top row, which
 * drags the window, and takes the pointer there too.
 */
const SESSION_MENU_CLASS = 'w-auto min-w-36 [app-region:no-drag]'

/**
 * The context menu of a saved session, the same on its row in the sidebar
 * and on its tab: Rename…, and Close while it is open, as its close button
 * closes it. The row's archive button takes the session out of the sidebar.
 * `testId` is the prefix of the items' test ids.
 */
export function SavedSessionMenu({ savedId, testId }: { savedId: string; testId: string }) {
  const open = useAppStore((state) =>
    state.sessions.find((session) => session.savedSessionId === savedId),
  )
  const startRenaming = useAppStore((state) => state.startRenamingSavedSession)
  const close = useAppStore((state) => state.closeSavedSession)
  return (
    <ContextMenuContent
      className={SESSION_MENU_CLASS}
      finalFocus={focusAfterSessionMenu(
        () => useAppStore.getState().renamingSavedSessionId === savedId,
      )}
    >
      <ContextMenuItem onClick={() => startRenaming(savedId)} data-testid={`${testId}-rename`}>
        <PencilIcon />
        Rename…
      </ContextMenuItem>
      {open && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            onClick={() => close(savedId)}
            data-testid={`${testId}-close`}
          >
            <XIcon />
            Close
          </ContextMenuItem>
        </>
      )}
    </ContextMenuContent>
  )
}

/**
 * The context menu of a chat, the same on its row in the sidebar and on its
 * tab: Rename…, and Close while it is open, as its close button closes it.
 * The row's archive button takes the chat out of the sidebar. `testId` is the
 * prefix of the items' test ids.
 */
export function ChatMenu({ chatId, testId }: { chatId: string; testId: string }) {
  const open = useAppStore((state) => state.sessions.find((session) => session.chatId === chatId))
  const startRenaming = useAppStore((state) => state.startRenamingChat)
  const close = useAppStore((state) => state.closeChat)
  return (
    <ContextMenuContent
      className={SESSION_MENU_CLASS}
      finalFocus={focusAfterSessionMenu(() => useAppStore.getState().renamingChatId === chatId)}
    >
      <ContextMenuItem onClick={() => startRenaming(chatId)} data-testid={`${testId}-rename`}>
        <PencilIcon />
        Rename…
      </ContextMenuItem>
      {open && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            onClick={() => close(chatId)}
            data-testid={`${testId}-close`}
          >
            <XIcon />
            Close
          </ContextMenuItem>
        </>
      )}
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
      className={SESSION_MENU_CLASS}
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
        onClick={() => requestCloseSession(session.id)}
        data-testid={`${testId}-close`}
      >
        <XIcon />
        Close
      </ContextMenuItem>
    </ContextMenuContent>
  )
}

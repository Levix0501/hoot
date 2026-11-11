import { FolderPlusIcon, PlayIcon, SquareTerminalIcon, XIcon } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { TERMINAL_MIN_WIDTH } from '../../shared/file-panel'
import { describeExit, isNormalExit } from '../../shared/session'
import { cn } from '../lib/utils'
import { useAppStore, type UiSession } from '../store/app-store'
import { useFilesStore } from '../store/files-store'
import { FilePanel, FilePanelToggle } from './files/file-panel'
import { SessionTabs } from './session-tabs'
import { TerminalView } from './terminal-view'
import { useTopRowInset } from './window-navigation'
import { Button } from './ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from './ui/empty'

/**
 * A session's page: its header in the window's top row, and its terminal;
 * for a session of a project, also the file panel of its folder, right of
 * the terminal while it is shown, and the button that shows and hides it, at
 * the top row's right end.
 */
export function SessionPane({ session }: { session: UiSession }) {
  const closeSession = useAppStore((state) => state.closeSession)
  const resumeChat = useAppStore((state) => state.resumeChat)
  const resumeSavedSession = useAppStore((state) => state.resumeSavedSession)
  const chat = useAppStore((state) =>
    session.chatId === null
      ? undefined
      : state.chats.find((candidate) => candidate.id === session.chatId),
  )
  const saved = useAppStore((state) =>
    session.savedSessionId === null
      ? undefined
      : state.savedSessions.find((candidate) => candidate.id === session.savedSessionId),
  )
  const inset = useTopRowInset()
  const filePanelOpen = useFilesStore((state) => state.layout.open)
  const { treeWidth, editorWidth } = useFilesStore(
    useShallow((state) => ({
      treeWidth: state.layout.treeWidth,
      editorWidth: state.layout.editorWidth,
    })),
  )
  // A chat runs in a folder of its own, which has no file panel.
  const hasFiles = session.chatId === null
  const filesShown = hasFiles && filePanelOpen
  // A chat or saved session whose agent ended any other way than normally
  // keeps its last output, and can be resumed; a session, and one closed by
  // the user, close instead.
  const record = chat ?? saved
  const resumable =
    record !== undefined &&
    session.status === 'exited' &&
    session.exit !== null &&
    !isNormalExit(session.exit)

  return (
    <div
      className="relative flex min-h-0 flex-1"
      // The widths of the file panel's parts, which dragging its edges sets
      // here directly while the panel follows the pointer.
      style={
        {
          '--file-tree-width': `${treeWidth}px`,
          '--file-editor-width': `${editorWidth}px`,
        } as React.CSSProperties
      }
      data-session-page=""
      data-testid="session"
      data-session-id={session.id}
      data-status={session.status}
      data-tool={session.toolId}
    >
      {/* Narrowed by the file panel no further than this, or half the page in a narrow window. */}
      <div
        className="flex min-h-0 flex-1 flex-col"
        style={{ minWidth: `min(${TERMINAL_MIN_WIDTH}px, 50%)` }}
      >
        {/*
        The main area's part of the window's top row: the tabs of the sessions
        open in the session's worktree, or for a chat, of the chats open. Its
        blank parts drag the window; the tabs and their `+` do not. While the
        sidebar slides, its left padding changes in step, keeping its content
        clear of the navigation. The tabs of a chat leave no room for the file
        panel's button, which a chat does not have, so each kind of row is a
        row of its own: switching between them does not slide the row's end
        as well. At its right end it leaves room for the window's buttons on
        Windows, and for the file panel's button while the panel is hidden;
        the panel's own part of the row has them while it shows.
      */}
        <header
          key={session.chatId === null ? 'tabs' : 'chat-tabs'}
          className={cn(
            'flex h-11.5 shrink-0 items-center gap-3 pl-2 transition-[padding] duration-200 ease-linear [app-region:drag]',
            session.chatId !== null
              ? 'pr-(--window-controls-width)'
              : filesShown
                ? 'pr-0'
                : 'pr-[calc(--spacing(10)+var(--window-controls-width))]',
          )}
          style={{ paddingLeft: inset }}
        >
          <SessionTabs session={session} />
        </header>
        <TerminalView key={session.id} sessionId={session.id} />
        {session.status === 'exited' && session.exit && (
          <div
            className="flex shrink-0 items-center gap-3 border-t bg-muted/50 px-4 py-2 text-sm"
            role="status"
            data-testid="session-ended"
            data-abnormal={session.exit.abnormal}
          >
            <span
              className={
                session.exit.abnormal ? 'min-w-0 flex-1 text-destructive' : 'min-w-0 flex-1'
              }
              data-testid="session-exit-message"
            >
              {describeExit(session.exit)}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={session.closing}
              onClick={() => {
                if (resumable && session.chatId !== null) resumeChat(session.chatId)
                else if (resumable && session.savedSessionId !== null) {
                  resumeSavedSession(session.savedSessionId)
                } else void closeSession(session.id)
              }}
              data-testid={resumable ? 'session-ended-resume' : 'session-ended-close'}
            >
              {resumable ? <PlayIcon /> : <XIcon />}
              {resumable ? 'Resume' : 'Close'}
            </Button>
          </div>
        )}
      </div>
      {hasFiles && (
        <FilePanel
          open={filePanelOpen}
          projectRoot={session.projectRoot}
          worktreePath={session.worktreePath}
        />
      )}
      {hasFiles && <FilePanelToggle />}
    </div>
  )
}

/** The empty page, shown when the main area shows no other page. */
export function NoSession() {
  const hasProjects = useAppStore((state) => state.projects.length > 0)
  const addProject = useAppStore((state) => state.addProject)
  return (
    <>
      {/* The main area's part of the window's top row, which drags the window. */}
      <div className="absolute inset-x-0 top-0 h-11.5 [app-region:drag]" />
      <Empty className="flex-1" data-testid="no-session">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SquareTerminalIcon />
          </EmptyMedia>
          <EmptyTitle>No session</EmptyTitle>
          <EmptyDescription>
            {hasProjects
              ? 'Start a session from a project in the sidebar.'
              : 'Add a project to get started.'}
          </EmptyDescription>
        </EmptyHeader>
        {!hasProjects && (
          <EmptyContent>
            <Button onClick={() => void addProject()}>
              <FolderPlusIcon />
              Add Project
            </Button>
          </EmptyContent>
        )}
      </Empty>
    </>
  )
}

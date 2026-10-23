import { FolderPlusIcon, PlayIcon, SquareTerminalIcon, XIcon } from 'lucide-react'
import { chatName } from '../../shared/chats'
import { describeExit, isNormalExit, sessionName } from '../../shared/session'
import { sessionState, stateLabel } from '../lib/session-state'
import { useAppStore, type UiSession } from '../store/app-store'
import { StateLight } from './state-light'
import { TerminalView } from './terminal-view'
import { ToolIcon } from './tool-icon'
import { useTopRowInset } from './window-navigation'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from './ui/empty'

/** The light of the session's state, and right of it the state's name or how the session ended. */
function StatusBadge({ session }: { session: UiSession }) {
  const state = sessionState(session)
  return (
    <Badge variant="secondary" className="gap-1.5" data-testid="session-status" data-state={state}>
      <StateLight state={state} />
      {stateLabel(state, session.exit)}
    </Badge>
  )
}

/** A session's page: its header in the window's top row, and its terminal. */
export function SessionPane({ session }: { session: UiSession }) {
  const requestCloseSession = useAppStore((state) => state.requestCloseSession)
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
  // A chat or saved session whose agent ended any other way than normally
  // keeps its last output, and can be resumed; a session, and one closed by
  // the user, close instead.
  const record = chat ?? saved
  const resumable =
    record !== undefined &&
    session.status === 'exited' &&
    session.exit !== null &&
    !isNormalExit(session.exit)
  // The page shows the name of the chat or saved session, which keeps the
  // last title its agent set when the agent clears the terminal title.
  const name = record === undefined ? sessionName(session) : chatName(record)

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="session"
      data-session-id={session.id}
      data-status={session.status}
      data-tool={session.toolId}
    >
      {/*
        The main area's part of the window's top row. Its blank parts drag the
        window; the name, which shows its full text on hover, and the close
        button do not. While the sidebar slides, its left padding changes in
        step, keeping its content clear of the navigation. At its right end it
        leaves room for the window's buttons on Windows.
      */}
      <header
        className="flex h-11 shrink-0 items-center gap-3 pr-[calc(--spacing(4)+var(--window-controls-width))] pl-4 transition-[padding] duration-200 ease-linear [app-region:drag]"
        style={{ paddingLeft: inset }}
      >
        <ToolIcon toolId={session.toolId} className="size-4 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 text-sm">
          <span
            className="min-w-0 truncate font-medium [app-region:no-drag]"
            title={name}
            data-session-name=""
            data-testid="session-name"
          >
            {name}
          </span>
        </div>
        <StatusBadge session={session} />
        <Button
          variant="ghost"
          size="icon-sm"
          className="[app-region:no-drag]"
          disabled={session.closing}
          onClick={() => requestCloseSession(session.id)}
          aria-label="Close Session"
          title="Close Session"
          data-testid="session-header-close"
        >
          <XIcon />
        </Button>
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
            className={session.exit.abnormal ? 'min-w-0 flex-1 text-destructive' : 'min-w-0 flex-1'}
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
  )
}

/** The empty page, shown when the main area shows no other page. */
export function NoSession() {
  const hasProjects = useAppStore((state) => state.projects.length > 0)
  const addProject = useAppStore((state) => state.addProject)
  return (
    <>
      {/* The main area's part of the window's top row, which drags the window. */}
      <div className="absolute inset-x-0 top-0 h-11 [app-region:drag]" />
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

import { FolderPlusIcon, SquareTerminalIcon, XIcon } from 'lucide-react'
import { describeExit, describeExitShort, sessionName } from '../../shared/session'
import { useAppStore, worktreeDisplayName, type UiSession } from '../store/app-store'
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

function projectName(root: string): string {
  return root.split('/').filter(Boolean).at(-1) ?? root
}

function StatusBadge({ session }: { session: UiSession }) {
  if (session.status !== 'exited' || !session.exit) {
    return (
      <Badge
        variant="secondary"
        className="gap-1.5"
        data-testid="session-status"
        data-state="running"
      >
        <span className="size-1.5 rounded-full bg-emerald-500" />
        Running
      </Badge>
    )
  }
  return (
    <Badge
      variant={session.exit.abnormal ? 'destructive' : 'outline'}
      data-testid="session-status"
      data-state="exited"
    >
      {describeExitShort(session.exit)}
    </Badge>
  )
}

/** A session's page: its header in the window's top row, and its terminal. */
export function SessionPane({ session }: { session: UiSession }) {
  const project = useAppStore((state) =>
    state.projects.find((candidate) => candidate.root === session.projectRoot),
  )
  // A session in a worktree also names the worktree.
  const worktree = useAppStore((state) =>
    session.worktreePath === null ? null : worktreeDisplayName(state, session.worktreePath),
  )
  const projectLabel = project?.name ?? projectName(session.projectRoot)
  const requestCloseSession = useAppStore((state) => state.requestCloseSession)
  const closeSession = useAppStore((state) => state.closeSession)
  const inset = useTopRowInset()

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
        window; the names, which show their full text on hover, and the close
        button do not. While the sidebar slides, its left padding changes in
        step, keeping its content clear of the navigation.
      */}
      <header
        className="flex h-11 shrink-0 items-center gap-3 px-4 transition-[padding] duration-200 ease-linear [app-region:drag]"
        style={{ paddingLeft: inset }}
      >
        <ToolIcon toolId={session.toolId} className="size-4 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5 text-sm">
          <span
            className="min-w-0 truncate font-medium [app-region:no-drag]"
            title={sessionName(session)}
            data-session-name=""
            data-testid="session-name"
          >
            {sessionName(session)}
          </span>
          <span className="shrink-0 text-muted-foreground">in</span>
          <span
            className="max-w-[50%] shrink-0 truncate font-medium [app-region:no-drag]"
            title={session.worktreePath ?? session.projectRoot}
            data-path=""
            data-testid="session-project"
          >
            {worktree === null ? projectLabel : `${projectLabel} · ${worktree}`}
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
            onClick={() => void closeSession(session.id)}
            data-testid="session-ended-close"
          >
            <XIcon />
            Close
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
              : 'Add a local Git repository to get started.'}
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

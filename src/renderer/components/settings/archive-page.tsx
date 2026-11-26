import { Trash2Icon } from 'lucide-react'
import { useId } from 'react'
import { chatName, type ArchivedSessionInfo } from '../../../shared/chats'
import { projectWorktreeRows, useAppStore } from '../../store/app-store'
import { AgentIcon } from '../provider-icon'
import { Button } from '../ui/button'

/** The last part of a path, which names its folder. */
function folderName(path: string): string {
  return path.split(/[\\/]/).findLast(Boolean) ?? path
}

/** The archived chats, or the archived sessions of a project, under the name of the group. */
interface ArchiveGroup {
  /** The project's folder, or `null` for the chats. */
  projectRoot: string | null
  entries: ArchivedSessionInfo[]
}

/**
 * The archived chats and the archived sessions of each project, each group in
 * the order of its last archived one, as its entries are.
 */
function archiveGroups(entries: readonly ArchivedSessionInfo[]): ArchiveGroup[] {
  const groups = new Map<string | null, ArchiveGroup>()
  for (const entry of entries) {
    const group = groups.get(entry.projectRoot)
    if (group) group.entries.push(entry)
    else groups.set(entry.projectRoot, { projectRoot: entry.projectRoot, entries: [entry] })
  }
  return [...groups.values()]
}

/** The name of the worktree an archived session was in, as its row shows it, or `null` for one of a project's own folder or a chat. */
function useWorktreeName(entry: ArchivedSessionInfo): string | null {
  return useAppStore((state) => {
    if (entry.projectRoot === null || entry.worktreePath === null) return null
    const worktree = projectWorktreeRows(state, entry.projectRoot).find(
      (row) => row.path === entry.worktreePath,
    )
    return worktree ? (worktree.name ?? worktree.displayName) : folderName(entry.worktreePath)
  })
}

/**
 * An archived session's row: the agent's icon, the session's name, after it
 * the worktree it was in, and at its right end a button that deletes it for
 * good, after a confirmation, and Unarchive, which brings it back to the
 * sidebar.
 */
function ArchivedRow({ entry }: { entry: ArchivedSessionInfo }) {
  const name = chatName(entry)
  const worktree = useWorktreeName(entry)
  const unarchiveSession = useAppStore((state) => state.unarchiveSession)
  const requestDeleteArchivedSession = useAppStore((state) => state.requestDeleteArchivedSession)
  return (
    <li
      className="flex items-center gap-3 px-4 py-3"
      data-testid="archive-row"
      data-session-id={entry.id}
      data-tool={entry.toolId}
    >
      <AgentIcon toolId={entry.toolId} providerId={entry.providerId} className="size-4 shrink-0" />
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span
          className="min-w-0 truncate text-sm"
          data-session-name=""
          data-testid="archive-row-name"
        >
          {name}
        </span>
        {worktree !== null && (
          <span
            className="min-w-0 shrink-[2] truncate text-xs text-muted-foreground"
            data-user-text=""
            data-testid="archive-row-worktree"
          >
            {worktree}
          </span>
        )}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/20"
        aria-label={`Delete ${name}`}
        // Its label names the session.
        data-user-text=""
        onClick={() => requestDeleteArchivedSession(entry.id)}
        data-testid="archive-row-delete"
      >
        <Trash2Icon />
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => void unarchiveSession(entry.id)}
        data-testid="archive-row-unarchive"
      >
        Unarchive
      </Button>
    </li>
  )
}

/** A group of archived sessions: the project's name, or Chats, above their rows. */
function ArchivedGroup({ group }: { group: ArchiveGroup }) {
  const heading = useId()
  const { projectRoot } = group
  const title = useAppStore((state) =>
    projectRoot === null
      ? 'Chats'
      : (state.projects.find((project) => project.root === projectRoot)?.name ??
        folderName(projectRoot)),
  )
  return (
    <section
      className="flex flex-col gap-2"
      aria-labelledby={heading}
      data-testid="archive-group"
      data-project-root={projectRoot ?? undefined}
    >
      <h2
        id={heading}
        className="truncate text-sm font-medium"
        data-user-text={projectRoot === null ? undefined : ''}
      >
        {title}
      </h2>
      <ul className="flex flex-col divide-y overflow-hidden rounded-xl border">
        {group.entries.map((entry) => (
          <ArchivedRow key={entry.id} entry={entry} />
        ))}
      </ul>
    </section>
  )
}

/**
 * The settings' Archive page: the archived chats and the archived sessions of
 * each project, in groups, the last archived first. An archived session can
 * be brought back to the sidebar, or deleted for good after a confirmation.
 */
export function ArchivePage() {
  const archived = useAppStore((state) => state.archivedSessions)
  return (
    <div className="flex min-w-0 flex-1 flex-col bg-background" data-testid="archive-page">
      {/* The page's part of the window's top row, which drags the window. */}
      <div className="h-11.5 shrink-0 [app-region:drag]" />
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 pt-2 pb-10">
          <h1 className="text-2xl font-semibold tracking-tight">Archive</h1>
          {archived.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="archive-empty">
              No archived sessions
            </p>
          ) : (
            <div className="flex flex-col gap-6" data-testid="archive-list">
              {archiveGroups(archived).map((group) => (
                <ArchivedGroup key={group.projectRoot ?? ''} group={group} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

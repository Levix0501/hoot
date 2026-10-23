import type { Project } from '../../shared/ipc'

/**
 * Sessions in sidebar order: grouped by project in the order of the project
 * list. Within a project come first the sessions in its main worktree, then
 * those of each of its worktrees in the order of the worktree rows
 * (`worktreeOrder` gives the roots of a project's worktree rows); each in
 * the order they were started.
 */
export function sidebarOrder<T extends { projectRoot: string; worktreePath: string | null }>(
  projects: readonly Project[],
  sessions: readonly T[],
  worktreeOrder: (projectRoot: string) => readonly string[] = () => [],
): T[] {
  const roots = new Set(projects.map((project) => project.root))
  return [
    ...projects.flatMap((project) => {
      const own = sessions.filter((session) => session.projectRoot === project.root)
      const worktrees = worktreeOrder(project.root)
      const listed = new Set(worktrees)
      return [
        ...own.filter((session) => session.worktreePath === null),
        ...worktrees.flatMap((path) => own.filter((session) => session.worktreePath === path)),
        // Not expected: every worktree a session runs in has a row.
        ...own.filter(
          (session) => session.worktreePath !== null && !listed.has(session.worktreePath),
        ),
      ]
    }),
    // Not expected: a session's project leaves the list only after it is closed.
    ...sessions.filter((session) => !roots.has(session.projectRoot)),
  ]
}

/**
 * The sessions of the switch order among those given: a saved session that is
 * not running is left out, as its page may stay after an unexpected end with
 * its Resume button, which the shortcuts do not show; every other session
 * stays, as a session of a project does after it ended.
 */
export function sessionsInSwitchOrder<T extends { savedSessionId: string | null }>(
  sessions: readonly T[],
  running: (session: T) => boolean,
): T[] {
  return sessions.filter((session) => session.savedSessionId === null || running(session))
}

/**
 * The sessions of running chats, in the order of the Chats group, which comes
 * after the projects in the sidebar and in the switch order. A session that
 * is being closed counts too, at the place of its chat.
 */
export function orderedChatSessions<T extends { id: string; chatId: string | null }>(
  chats: readonly { id: string }[],
  sessions: readonly T[],
  running: (session: T) => boolean,
  closing: ReadonlySet<string> = new Set(),
): T[] {
  return chats.flatMap((chat) => {
    const session = sessions.find(
      (candidate) =>
        candidate.chatId === chat.id && (running(candidate) || closing.has(candidate.id)),
    )
    return session === undefined ? [] : [session]
  })
}

/**
 * The session shown once the sessions in `closing` are closed: the current one
 * if it stays, otherwise the first remaining session after it in sidebar order,
 * otherwise the last remaining one before it, otherwise none.
 */
export function currentAfterClosing(
  order: readonly string[],
  current: string | null,
  closing: ReadonlySet<string>,
): string | null {
  if (current === null || !closing.has(current)) return current
  const index = order.indexOf(current)
  const after = order.slice(index + 1).find((id) => !closing.has(id))
  if (after !== undefined) return after
  const before = order.slice(0, Math.max(index, 0)).findLast((id) => !closing.has(id))
  return before ?? null
}

/**
 * The session `offset` steps from the current one in sidebar order, wrapping
 * around at either end.
 */
export function relativeSession(
  order: readonly string[],
  current: string | null,
  offset: 1 | -1,
): string | null {
  if (order.length === 0) return null
  const index = current === null ? -1 : order.indexOf(current)
  if (index === -1) return offset === 1 ? order[0]! : order.at(-1)!
  return order[(index + offset + order.length) % order.length]!
}

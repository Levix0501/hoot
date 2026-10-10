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

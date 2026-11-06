import type { Project } from '../../shared/ipc'

/**
 * Sessions in sidebar order: grouped by project in the order of the project
 * list. Within a project come first the sessions in its own folder, which its
 * Local row lists, then those of each of its worktrees in the order of the
 * worktree rows (`worktreeOrder` gives the roots of a project's worktree
 * rows); each in the order the sessions are given in, which is the order of
 * their tabs.
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
 * The session shown once the sessions in `closing` are closed: the current
 * one if it stays; otherwise the first remaining tab after it in its row of
 * tabs, else the last remaining one before it there; once its row has no tab
 * left, the first remaining session after it in switch order, else the last
 * remaining one before it; otherwise none. `strip` gives the row of a
 * session's tab (see `tabStrip`).
 */
export function currentAfterClosing<T extends { id: string }>(
  order: readonly T[],
  current: string | null,
  closing: ReadonlySet<string>,
  strip: (session: T) => string,
): string | null {
  if (current === null || !closing.has(current)) return current
  const index = order.findIndex((session) => session.id === current)
  const row = index === -1 ? null : strip(order[index]!)
  const stays = (session: T) => !closing.has(session.id)
  const after = order.slice(index + 1).filter(stays)
  const before = order.slice(0, Math.max(index, 0)).filter(stays)
  const inRow = (session: T) => strip(session) === row
  return (after.find(inRow) ?? before.findLast(inRow) ?? after[0] ?? before.at(-1))?.id ?? null
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

/**
 * The key in `tabOrders` of the chats' row of tabs, which no folder's root
 * is: the roots of projects and worktrees are absolute paths.
 */
export const CHAT_TABS = 'chats'

/**
 * The row of tabs a session's tab is in, by its key in `tabOrders`: for a
 * chat's session the chats' (`CHAT_TABS`), otherwise the root of the
 * worktree the session runs in, which for the project's own folder is the
 * project's root.
 */
export function tabStrip(session: {
  projectRoot: string
  worktreePath: string | null
  chatId: string | null
}): string {
  return session.chatId === null ? (session.worktreePath ?? session.projectRoot) : CHAT_TABS
}

/**
 * The key of a session's tab: the id of its saved session or chat, which
 * the session that continues it after an unexpected end keeps, or else its
 * own id.
 */
export function tabKey(session: {
  id: string
  savedSessionId: string | null
  chatId: string | null
}): string {
  return session.savedSessionId ?? session.chatId ?? session.id
}

/**
 * The orders tabs were dragged into without the tabs of `closed`, by their
 * keys, so that a tab opened again comes last, as a new one does; the same
 * object when it has none of them.
 */
export function withoutTabs(
  orders: Readonly<Record<string, readonly string[]>>,
  closed: ReadonlySet<string>,
): Readonly<Record<string, readonly string[]>> {
  const kept = Object.entries(orders).map(
    ([strip, order]) => [strip, order.filter((key) => !closed.has(key))] as const,
  )
  if (kept.every(([strip, order]) => order.length === orders[strip]!.length)) return orders
  return Object.fromEntries(kept.filter(([, order]) => order.length > 0))
}

/**
 * Tabs, or the sessions of tabs, in the order of the tabs: first those whose
 * keys `order` has, in its order, which is the order a row of tabs was
 * dragged into; then the others in the order they were made, so that a new
 * tab comes last.
 */
export function inTabOrder<T extends { createdAt: number }>(
  tabs: readonly T[],
  key: (tab: T) => string,
  order: readonly string[],
): T[] {
  const places = new Map(order.map((tab, index) => [tab, index]))
  const place = (tab: T) => places.get(key(tab)) ?? order.length
  return tabs.toSorted((a, b) => place(a) - place(b) || a.createdAt - b.createdAt)
}

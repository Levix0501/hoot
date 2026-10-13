/** Where an issue is in its life, named after Linear's default workflow. */
export const ISSUE_STATUSES = ['backlog', 'todo', 'in_progress', 'done', 'canceled'] as const
export type IssueStatus = (typeof ISSUE_STATUSES)[number]

/** How urgent an issue is, numbered as Linear does: 0 for none, then urgent (1) to low (4). */
export const ISSUE_PRIORITIES = [0, 1, 2, 3, 4] as const
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number]

/** How the interface writes each status. */
export const STATUS_LABELS: Readonly<Record<IssueStatus, string>> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In Progress',
  done: 'Done',
  canceled: 'Canceled',
}

/** How the interface writes each priority. */
export const PRIORITY_LABELS: Readonly<Record<IssuePriority, string>> = {
  0: 'No priority',
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
}

/**
 * The issues a project's list shows: all of them, the active ones (to do or
 * in progress), or those in the backlog.
 */
export const ISSUE_VIEWS = ['all', 'active', 'backlog'] as const
export type IssueView = (typeof ISSUE_VIEWS)[number]

/** A note kept for a project: what to do, or what went wrong. */
export interface Issue {
  id: number
  /** The id of the project it belongs to. */
  projectId: number
  /** Its number in its project, from 1 in the order they were created. Never reused. */
  number: number
  title: string
  /** Markdown; may be empty. */
  description: string
  status: IssueStatus
  priority: IssuePriority
  /** When it was created, in milliseconds since the Unix epoch. */
  createdAt: number
  /** When it last became done or canceled, in milliseconds since the Unix epoch; `null` while it is neither. */
  completedAt: number | null
}

/** The longest title and description Hoot saves, in UTF-16 code units. */
export const ISSUE_TITLE_MAX_LENGTH = 10_000
export const ISSUE_DESCRIPTION_MAX_LENGTH = 1_000_000

/** The title saved for what was entered: without whitespace around it. Empty when there is none. */
export function issueTitle(entered: string): string {
  return entered.trim()
}

export interface NewIssue {
  projectId: number
  /** As entered; saved without the whitespace around it, and must not be empty then. */
  title: string
  description: string
  status: IssueStatus
  priority: IssuePriority
}

/**
 * What changes about an issue; what is left out stays as it is. A title is
 * saved without the whitespace around it, and must not be empty then.
 */
export type IssueChanges = Partial<Pick<Issue, 'title' | 'description' | 'status' | 'priority'>>

export type IssueResult = { ok: true; issue: Issue } | { ok: false; message: string }

/** Whether issues in a status are completed: done, or canceled. */
export function isCompleted(status: IssueStatus): boolean {
  return status === 'done' || status === 'canceled'
}

/** Whether an issue is still to be dealt with: neither done nor canceled. */
export function isIssueOpen(issue: Pick<Issue, 'status'>): boolean {
  return !isCompleted(issue.status)
}

/**
 * The statuses of a project's issue list, in the order it shows them, as
 * Linear's lists do: the closest to done first, then the done and the
 * canceled issues.
 */
export const STATUS_GROUP_ORDER: readonly IssueStatus[] = [
  'in_progress',
  'todo',
  'backlog',
  'done',
  'canceled',
]

const VIEW_STATUSES: Record<IssueView, readonly IssueStatus[]> = {
  all: STATUS_GROUP_ORDER,
  active: ['in_progress', 'todo'],
  backlog: ['backlog'],
}

/** Whether a list showing a view shows an issue. */
export function inView(issue: Pick<Issue, 'status'>, view: IssueView): boolean {
  return VIEW_STATUSES[view].includes(issue.status)
}

/** Urgent first and no priority last. */
function priorityRank(priority: IssuePriority): number {
  return priority === 0 ? ISSUE_PRIORITIES.length : priority
}

/**
 * The order of the issues in a status group: completed issues the most
 * recently completed first; the others by priority, urgent first and those
 * without one last, then newest first.
 */
export function compareInGroup(a: Issue, b: Issue): number {
  if (isCompleted(a.status) && isCompleted(b.status)) {
    return (b.completedAt ?? 0) - (a.completedAt ?? 0) || b.id - a.id
  }
  return (
    priorityRank(a.priority) - priorityRank(b.priority) || b.createdAt - a.createdAt || b.id - a.id
  )
}

export interface IssueGroup {
  status: IssueStatus
  issues: Issue[]
}

/** The issues a list shows for a view, grouped by status in the list's order; no empty groups. */
export function issueGroups(issues: readonly Issue[], view: IssueView): IssueGroup[] {
  return VIEW_STATUSES[view]
    .map((status) => ({
      status,
      issues: issues.filter((issue) => issue.status === status).toSorted(compareInGroup),
    }))
    .filter((group) => group.issues.length > 0)
}

/** The issues a list shows for a view, one after another, in the order it shows them. */
export function listOrder(issues: readonly Issue[], view: IssueView): Issue[] {
  return issueGroups(issues, view).flatMap((group) => group.issues)
}

/**
 * What a project's issue identifiers start with: the first three ASCII
 * letters or digits of its name, in capitals, or "ISS" without any.
 */
export function projectKey(projectName: string): string {
  const key = projectName
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 3)
    .toUpperCase()
  return key === '' ? 'ISS' : key
}

/** How an issue is referred to, as in Linear: its project's key and its number, such as "HOO-12". */
export function issueIdentifier(projectName: string, number: number): string {
  return `${projectKey(projectName)}-${number}`
}

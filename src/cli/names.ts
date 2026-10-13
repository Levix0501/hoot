import {
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  type IssuePriority,
  type IssueStatus,
} from '../shared/issues'

/** How hoot names each status, in its arguments and its JSON. */
export const STATUS_NAMES: Readonly<Record<IssueStatus, string>> = {
  backlog: 'backlog',
  todo: 'todo',
  in_progress: 'in-progress',
  done: 'done',
  canceled: 'canceled',
}

/** How hoot names each priority, in its arguments and its JSON. */
export const PRIORITY_NAMES: Readonly<Record<IssuePriority, string>> = {
  0: 'none',
  1: 'urgent',
  2: 'high',
  3: 'medium',
  4: 'low',
}

/** The status names in the order of the statuses' workflow. */
export const STATUS_NAME_LIST: readonly string[] = ISSUE_STATUSES.map(
  (status) => STATUS_NAMES[status],
)

/** The priority names, none first, then urgent to low. */
export const PRIORITY_NAME_LIST: readonly string[] = ISSUE_PRIORITIES.map(
  (priority) => PRIORITY_NAMES[priority],
)

/** The status a name names, if any. */
export function statusNamed(name: string): IssueStatus | undefined {
  return ISSUE_STATUSES.find((status) => STATUS_NAMES[status] === name)
}

/** The priority a name names, if any. */
export function priorityNamed(name: string): IssuePriority | undefined {
  return ISSUE_PRIORITIES.find((priority) => PRIORITY_NAMES[priority] === name)
}

import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  type IssuePriority,
  type IssueStatus,
  type IssueView,
} from '../../shared/issues'

/** A value of an issue's property, as pickers and menus offer it. */
export interface PropertyOption<T> {
  value: T
  label: string
  /** The digit that picks it while a picker or menu of the property is open, if any. */
  shortcut?: string
}

/** The statuses, in the order of their workflow, numbered as Linear numbers them. */
export const STATUS_OPTIONS: ReadonlyArray<PropertyOption<IssueStatus>> = [
  { value: 'backlog', label: STATUS_LABELS.backlog, shortcut: '1' },
  { value: 'todo', label: STATUS_LABELS.todo, shortcut: '2' },
  { value: 'in_progress', label: STATUS_LABELS.in_progress, shortcut: '3' },
  { value: 'done', label: STATUS_LABELS.done, shortcut: '4' },
  { value: 'canceled', label: STATUS_LABELS.canceled, shortcut: '5' },
]

/** The priorities, none first, each picked by its own number. */
export const PRIORITY_OPTIONS: ReadonlyArray<PropertyOption<IssuePriority>> = [
  { value: 0, label: PRIORITY_LABELS[0], shortcut: '0' },
  { value: 1, label: PRIORITY_LABELS[1], shortcut: '1' },
  { value: 2, label: PRIORITY_LABELS[2], shortcut: '2' },
  { value: 3, label: PRIORITY_LABELS[3], shortcut: '3' },
  { value: 4, label: PRIORITY_LABELS[4], shortcut: '4' },
]

export function statusLabel(status: IssueStatus): string {
  return STATUS_LABELS[status]
}

export function priorityLabel(priority: IssuePriority): string {
  return PRIORITY_LABELS[priority]
}

/** The option of the digit typed while a picker of the property is open, if any. */
export function optionOfDigit<T>(
  options: ReadonlyArray<PropertyOption<T>>,
  key: string,
): PropertyOption<T> | null {
  return options.find((option) => option.shortcut === key) ?? null
}

/** The views of the issue list, in the order its tabs show them. */
export const VIEW_OPTIONS: ReadonlyArray<{ value: IssueView; label: string }> = [
  { value: 'all', label: 'All issues' },
  { value: 'active', label: 'Active' },
  { value: 'backlog', label: 'Backlog' },
]

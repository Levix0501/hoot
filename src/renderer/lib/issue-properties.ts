import type { IssuePriority, IssueStatus, IssueView } from '../../shared/issues'

/** A value of an issue's property, as pickers and menus offer it. */
export interface PropertyOption<T> {
  value: T
  label: string
  /** The digit that picks it while a picker or menu of the property is open. */
  shortcut: string
}

/** The statuses, in the order of their workflow, numbered as Linear numbers them. */
export const STATUS_OPTIONS: ReadonlyArray<PropertyOption<IssueStatus>> = [
  { value: 'backlog', label: 'Backlog', shortcut: '1' },
  { value: 'todo', label: 'Todo', shortcut: '2' },
  { value: 'in_progress', label: 'In Progress', shortcut: '3' },
  { value: 'done', label: 'Done', shortcut: '4' },
  { value: 'canceled', label: 'Canceled', shortcut: '5' },
]

/** The priorities, none first, each picked by its own number. */
export const PRIORITY_OPTIONS: ReadonlyArray<PropertyOption<IssuePriority>> = [
  { value: 0, label: 'No priority', shortcut: '0' },
  { value: 1, label: 'Urgent', shortcut: '1' },
  { value: 2, label: 'High', shortcut: '2' },
  { value: 3, label: 'Medium', shortcut: '3' },
  { value: 4, label: 'Low', shortcut: '4' },
]

export function statusLabel(status: IssueStatus): string {
  return STATUS_OPTIONS.find((option) => option.value === status)!.label
}

export function priorityLabel(priority: IssuePriority): string {
  return PRIORITY_OPTIONS.find((option) => option.value === priority)!.label
}

/** The option of the digit typed while a picker of the property is open, if any. */
export function optionOfDigit<T>(
  options: ReadonlyArray<PropertyOption<T>>,
  key: string,
): PropertyOption<T> | null {
  return options.find((option) => option.shortcut === key) ?? null
}

/** The views of an issue list, in the order its tabs show them. */
export const VIEW_OPTIONS: ReadonlyArray<{ value: IssueView; label: string }> = [
  { value: 'all', label: 'All issues' },
  { value: 'active', label: 'Active' },
  { value: 'backlog', label: 'Backlog' },
]

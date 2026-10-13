import { issueIdentifier, PRIORITY_LABELS, STATUS_LABELS, type Issue } from '../shared/issues'
import { PRIORITY_NAMES, STATUS_NAMES } from './names'

/** An issue as hoot prints it with `--json`. */
export interface IssueJson {
  /** Such as "ISS-12". */
  identifier: string
  /** Its number, as in its identifier: 12 for ISS-12. */
  number: number
  title: string
  /** Markdown; empty when it has none. */
  description: string
  /** A status name, such as "in-progress". */
  status: string
  /** A priority name, such as "none". */
  priority: string
  /** When it was created, in UTC, in ISO 8601. */
  createdAt: string
  /** When it last became done or canceled, in UTC, in ISO 8601; `null` while it is neither. */
  completedAt: string | null
}

export function issueJson(issue: Issue): IssueJson {
  return {
    identifier: issueIdentifier(issue.id),
    number: issue.id,
    title: issue.title,
    description: issue.description,
    status: STATUS_NAMES[issue.status],
    priority: PRIORITY_NAMES[issue.priority],
    createdAt: new Date(issue.createdAt).toISOString(),
    completedAt: issue.completedAt === null ? null : new Date(issue.completedAt).toISOString(),
  }
}

/** JSON as hoot prints it: indented, on lines of its own. */
export function jsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

const twoDigits = (value: number) => String(value).padStart(2, '0')

/** A moment in local time, to the minute: "2026-10-12 14:03". */
export function localMinute(time: number): string {
  const date = new Date(time)
  return (
    `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())} ` +
    `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`
  )
}

/**
 * An issue as `hoot issue view` prints it: its identifier and title; its
 * status, priority and creation time; and its description as it is saved,
 * after a blank line, when it has one.
 */
export function issueText(issue: Issue): string {
  const lines = [
    `${issueIdentifier(issue.id)} ${issue.title}`,
    [
      STATUS_LABELS[issue.status],
      PRIORITY_LABELS[issue.priority],
      `Created ${localMinute(issue.createdAt)}`,
    ].join(' · '),
  ]
  let text = `${lines.join('\n')}\n`
  if (issue.description !== '') {
    text += `\n${issue.description}`
    if (!issue.description.endsWith('\n')) text += '\n'
  }
  return text
}

/**
 * Issues as `hoot issue list` prints them, one line each, in columns: the
 * identifier, the status, the priority and the title.
 */
export function issueListText(issues: readonly Issue[]): string {
  const rows = issues.map((issue) => ({
    identifier: issueIdentifier(issue.id),
    status: STATUS_LABELS[issue.status],
    priority: PRIORITY_LABELS[issue.priority],
    title: issue.title,
  }))
  const width = (column: 'identifier' | 'status' | 'priority') =>
    Math.max(0, ...rows.map((row) => row[column].length))
  const identifierWidth = width('identifier')
  const statusWidth = width('status')
  const priorityWidth = width('priority')
  return rows
    .map(
      (row) =>
        `${row.identifier.padEnd(identifierWidth)}  ${row.status.padEnd(statusWidth)}  ` +
        `${row.priority.padEnd(priorityWidth)}  ${row.title}\n`,
    )
    .join('')
}

import type { HootIssue, HootProject, RelatedIssue } from '../shared/hoot-cli'
import { issueIdentifier, PRIORITY_LABELS, STATUS_LABELS, type Issue } from '../shared/issues'
import { percentCompleted, subIssueProgress } from '../shared/sub-issues'
import { PRIORITY_NAMES, STATUS_NAMES } from './names'

/**
 * An issue's parent, one of its sub-issues, or one of the issues it is
 * blocked by or blocks, as hoot prints it with `--json`.
 */
export interface RelatedIssueJson {
  /** Such as "ISS-12". */
  identifier: string
  number: number
  title: string
  /** A status name, such as "in-progress". */
  status: string
  /** The name of its project, or `null` for none. */
  project: string | null
}

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
  /** Its parent; `null` for a top-level issue. */
  parent: RelatedIssueJson | null
  /** Its sub-issues, in the order its page lists them. */
  subIssues: RelatedIssueJson[]
  /**
   * How many of its sub-issues are not canceled, how many of them are done,
   * and the percentage done, rounded down: 0 without any.
   */
  subIssuesSummary: { total: number; completed: number; percentCompleted: number }
  /** The issues it is blocked by, in the order it became blocked by them. */
  blockedBy: RelatedIssueJson[]
  /** The issues it blocks, in the order they became blocked by it. */
  blocking: RelatedIssueJson[]
}

function relatedJson(issue: RelatedIssue): RelatedIssueJson {
  return {
    identifier: issueIdentifier(issue.id),
    number: issue.id,
    title: issue.title,
    status: STATUS_NAMES[issue.status],
    project: issue.project,
  }
}

export function issueJson(issue: HootIssue): IssueJson {
  const progress = subIssueProgress(issue.subIssues.map((subIssue) => subIssue.status))
  return {
    identifier: issueIdentifier(issue.id),
    number: issue.id,
    title: issue.title,
    description: issue.description,
    status: STATUS_NAMES[issue.status],
    priority: PRIORITY_NAMES[issue.priority],
    createdAt: new Date(issue.createdAt).toISOString(),
    completedAt: issue.completedAt === null ? null : new Date(issue.completedAt).toISOString(),
    parent: issue.parent === null ? null : relatedJson(issue.parent),
    subIssues: issue.subIssues.map(relatedJson),
    subIssuesSummary: {
      total: progress.total,
      completed: progress.completed,
      percentCompleted: percentCompleted(progress),
    },
    blockedBy: issue.blockedBy.map(relatedJson),
    blocking: issue.blocking.map(relatedJson),
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
 * What follows the title of an issue's parent, sub-issue, or an issue it is
 * blocked by or blocks: in parentheses, its project's name, or No project,
 * when that is not the session's project.
 */
function projectNote(issue: RelatedIssue, project: HootProject): string | null {
  if (issue.projectId === project.id) return null
  return issue.project ?? 'No project'
}

/**
 * An issue as `hoot issue view` prints it: its identifier and title; its
 * status, priority and creation time; the issue it is a sub-issue of, if
 * any, such as `Sub-issue of ISS-4 Ship it (Todo)`; its description as it is
 * saved, after a blank line, when it has one; after a blank line, its
 * sub-issues when it has any: their progress, such as `Sub-issues · 1/3
 * (33%)`, then the status, identifier and title of each, in the order its
 * page lists them; and, each after a blank line, `Blocked by` and the issues
 * it is blocked by, and `Blocking` and those it blocks, when it has any, one
 * line each as its sub-issues. A related issue of another project than the
 * session's is followed by its project's name, or No project, in
 * parentheses.
 */
export function issueText(issue: HootIssue, project: HootProject): string {
  const lines = [
    `${issueIdentifier(issue.id)} ${issue.title}`,
    [
      STATUS_LABELS[issue.status],
      PRIORITY_LABELS[issue.priority],
      `Created ${localMinute(issue.createdAt)}`,
    ].join(' · '),
  ]
  if (issue.parent !== null) {
    const { parent } = issue
    const note = [STATUS_LABELS[parent.status], projectNote(parent, project)]
      .filter((part) => part !== null)
      .join(' · ')
    lines.push(`Sub-issue of ${issueIdentifier(parent.id)} ${parent.title} (${note})`)
  }
  let text = `${lines.join('\n')}\n`
  if (issue.description !== '') {
    text += `\n${issue.description}`
    if (!issue.description.endsWith('\n')) text += '\n'
  }
  if (issue.subIssues.length > 0) {
    const progress = subIssueProgress(issue.subIssues.map((subIssue) => subIssue.status))
    text +=
      `\nSub-issues · ${progress.completed}/${progress.total} (${percentCompleted(progress)}%)\n` +
      relatedRows(issue.subIssues, project)
  }
  if (issue.blockedBy.length > 0) text += `\nBlocked by\n${relatedRows(issue.blockedBy, project)}`
  if (issue.blocking.length > 0) text += `\nBlocking\n${relatedRows(issue.blocking, project)}`
  return text
}

/** Related issues, one line each, in columns: the status, the identifier and the title. */
function relatedRows(issues: readonly RelatedIssue[], project: HootProject): string {
  const rows = issues.map((issue) => {
    const note = projectNote(issue, project)
    return {
      status: STATUS_LABELS[issue.status],
      identifier: issueIdentifier(issue.id),
      title: note === null ? issue.title : `${issue.title} (${note})`,
    }
  })
  const statusWidth = Math.max(...rows.map((row) => row.status.length))
  const identifierWidth = Math.max(...rows.map((row) => row.identifier.length))
  return rows
    .map(
      (row) =>
        `${row.status.padEnd(statusWidth)}  ${row.identifier.padEnd(identifierWidth)}  ${row.title}\n`,
    )
    .join('')
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

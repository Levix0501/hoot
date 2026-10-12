export type IssueState = 'open' | 'closed'

/** A note kept for a project: what to do, or what went wrong. */
export interface Issue {
  id: number
  /** The id of the project it belongs to. */
  projectId: number
  title: string
  /** Markdown, as it was entered; may be empty. */
  description: string
  state: IssueState
  /** When it was created, in milliseconds since the Unix epoch. */
  createdAt: number
  /** When it was last closed, in milliseconds since the Unix epoch; `null` until it first is. */
  closedAt: number | null
}

/** The longest title and description Hoot saves, in UTF-16 code units. */
export const ISSUE_TITLE_MAX_LENGTH = 10_000
export const ISSUE_DESCRIPTION_MAX_LENGTH = 1_000_000

/**
 * The longest issue that can be sent to Claude Code: its title and
 * description together, in UTF-16 code units. The issue reaches Claude Code
 * in its command's arguments, which macOS limits to about 1 MB together with
 * the environment; this stays well below that, whatever the characters.
 */
export const ISSUE_SEND_MAX_LENGTH = 100_000

/** How long an issue is when it is sent: its title and description together, in UTF-16 code units. */
export function issueSendLength(issue: Pick<Issue, 'title' | 'description'>): number {
  return issue.title.length + issue.description.length
}

/** The title saved for what was entered: without whitespace around it. Empty when there is none. */
export function issueTitle(entered: string): string {
  return entered.trim()
}

export interface NewIssue {
  projectId: number
  /** As entered; saved without the whitespace around it, and must not be empty then. */
  title: string
  description: string
}

export interface IssueChanges {
  /** As entered; saved without the whitespace around it, and must not be empty then. */
  title: string
  description: string
}

export type IssueResult = { ok: true; issue: Issue } | { ok: false; message: string }

/**
 * The issues in one state, as their list shows them: open issues newest
 * first, closed issues the most recently closed first.
 */
export function issuesInState(issues: readonly Issue[], state: IssueState): Issue[] {
  const time = (issue: Issue) => (state === 'open' ? issue.createdAt : (issue.closedAt ?? 0))
  return issues
    .filter((issue) => issue.state === state)
    .toSorted((a, b) => time(b) - time(a) || b.id - a.id)
}

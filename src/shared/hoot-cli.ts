/**
 * What hoot, the command line program in Hoot's sessions, and the Hoot that
 * started a session tell each other. hoot asks over HTTP, through a Unix
 * domain socket (a named pipe on Windows) that only that Hoot listens on:
 *
 * - `GET /issues`: every issue of the session's project.
 * - `GET /issues/<number>`: the issue with this number, as in `ISS-12`, if it is in the
 *   project; `null` when it is not.
 * - `POST /issues`: creates an issue in the project, from a `NewHootIssue`.
 * - `PATCH /issues/<number>`: changes the parent and the sub-issues of an
 *   issue of the project, from an `IssueEdit`.
 * - `POST /steps/report`: reports the outcome of the current step of the
 *   workflow of the issue the session was started from, from a
 *   `StepReportRequest`.
 *
 * Each request names its session in the `SESSION_HEADER` header, and each
 * answer is a JSON `HootAnswer`.
 */
import type { Issue, IssuePriority, IssueStatus } from './issues'
import type { WorkflowStep } from './workflows'

/** The variables Hoot adds to the environment of every session's process for hoot. */
export const HOOT_ENV = {
  /** The socket, or on Windows the named pipe, of the Hoot that started the session. */
  socket: 'HOOT_SOCKET',
  /** The session's id, by which that Hoot knows the session's project. */
  sessionId: 'HOOT_SESSION_ID',
  /** Hoot's own executable, which runs hoot's script as Node.js. */
  node: 'HOOT_NODE',
  /** hoot's script. */
  script: 'HOOT_CLI',
} as const

/** The header that names the session a request comes from. */
export const SESSION_HEADER = 'hoot-session-id'

/** The project of the session hoot runs in. */
export interface HootProject {
  id: number
  /** Its name, the last segment of its root. */
  name: string
}

/**
 * An issue's parent or one of its sub-issues, which may belong to another
 * project than the issue, or to none.
 */
export interface RelatedIssue {
  /** Its number, as in `ISS-12`. */
  id: number
  title: string
  status: IssueStatus
  /** The project it belongs to, or `null` for none. */
  projectId: number | null
  /** The name of its project, or `null` for none. */
  project: string | null
}

/**
 * An issue of the session's project as hoot gets it: with its parent, unless
 * it is a top-level issue, and its sub-issues, in the order its page lists
 * them. A parent or sub-issue of a project removed from Hoot's list is left
 * out, as Hoot's window leaves it out.
 */
export interface HootIssue extends Issue {
  parent: RelatedIssue | null
  subIssues: RelatedIssue[]
}

/**
 * An issue to create, with its title as entered, which Hoot saves as the new
 * issue dialog does: on one line, without the whitespace around it. With a
 * parent, given by its number in decimal digits, it is created as the
 * parent's last sub-issue, with the parent's priority unless one is given.
 */
export interface NewHootIssue {
  title: string
  description: string
  status: IssueStatus
  priority?: IssuePriority
  parent?: string
}

/**
 * What changes about an issue's parent and sub-issues, each issue given by its
 * number in decimal digits: its parent, or none for `removeParent`; issues
 * that become its last sub-issues, in this order, leaving any other parent
 * they have; and sub-issues of it that become top-level issues.
 */
export interface IssueEdit {
  parent?: string
  removeParent?: boolean
  addSubIssues?: string[]
  removeSubIssues?: string[]
}

/** What Hoot answers: what was asked for, with the session's project, or why it could not be done. */
export type HootAnswer<T> =
  | ({ ok: true; project: HootProject } & T)
  | { ok: false; message: string }

export type IssueListAnswer = HootAnswer<{ issues: HootIssue[] }>
export type IssueAnswer = HootAnswer<{ issue: HootIssue | null }>
export type CreatedIssueAnswer = HootAnswer<{ issue: HootIssue }>
export type EditedIssueAnswer = HootAnswer<{ issue: HootIssue }>

/** An outcome of the current step, by its name, and the agent's summary of the step, in Markdown. */
export interface StepReportRequest {
  outcome: string
  summary: string
}

/** What Hoot recorded of a step's outcome, and what comes next. */
export interface StepReport {
  /** The issue's identifier, such as `ISS-12`. */
  issue: string
  /** The name of the step reported. */
  step: string
  /** The label of the outcome. */
  outcome: string
  /** The step that starts now, or `null` when the outcome finished the workflow. */
  next: WorkflowStep | null
}

export type StepReportAnswer = HootAnswer<{ report: StepReport }>

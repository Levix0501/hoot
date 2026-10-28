/**
 * What hoot, the command line program in Hoot's sessions, and the Hoot that
 * started a session tell each other. hoot asks over HTTP, through a Unix
 * domain socket (a named pipe on Windows) that only that Hoot listens on:
 *
 * - `GET /issues`: every issue of the session's project.
 * - `GET /issues/<number>`: the issue with this number, as in `ISS-12`, if it is in the
 *   project; `null` when it is not.
 * - `POST /issues`: creates an issue in the project, from a `NewHootIssue`.
 * - `PATCH /issues/<number>`: changes the parent, the sub-issues, the
 *   dependencies and the labels of an issue of the project, from an
 *   `IssueEdit`.
 * - `POST /issues/<number>/sub-issues`: creates sub-issues of an issue of the
 *   project, with dependencies and labels, from a `BatchRequest`.
 * - `GET /labels`: every label.
 * - `POST /labels`: creates a label, from a `NewHootLabel`.
 * - `PATCH /labels/<name>`: changes the label with this name, from a `LabelEdit`.
 * - `DELETE /labels/<name>`: deletes the label with this name.
 * - `POST /sessions`: starts a session for an issue of the project, from a
 *   `SessionRequest`.
 * - `POST /hook-events`: reports an event of a hook Hoot adds to the
 *   session's Claude Code or Codex, from a `HookEventReport`.
 *
 * Each request names its session in the `SESSION_HEADER` header, and each
 * answer is a JSON `HootAnswer`.
 */
import type { Issue, IssuePriority, IssueStatus } from './issues'

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
 * An issue's parent, one of its sub-issues, or one of the issues it is
 * blocked by or blocks, which may belong to another project than the issue,
 * or to none.
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

/** A label as hoot gets it. */
export interface HootLabel {
  name: string
  /** Six hexadecimal digits in lower case, without `#`. */
  color: string
  /** Empty when it has none. */
  description: string
  /** The name of its group, or `null` for none. */
  group: string | null
}

/**
 * An issue of the session's project as hoot gets it: with its parent, unless
 * it is a top-level issue; its sub-issues, in the order its page lists them;
 * the issues it is blocked by and those it blocks, in the order the
 * dependencies were made; and its labels, in the order Hoot lists labels. An
 * issue of a project removed from Hoot's list is left out, as Hoot's window
 * leaves it out.
 */
export interface HootIssue extends Issue {
  parent: RelatedIssue | null
  subIssues: RelatedIssue[]
  blockedBy: RelatedIssue[]
  blocking: RelatedIssue[]
  labels: HootLabel[]
}

/**
 * An issue to create, with its title as entered, which Hoot saves as the new
 * issue dialog does: on one line, without the whitespace around it. With a
 * parent, given by its number in decimal digits, it is created as the
 * parent's last sub-issue, with the parent's priority unless one is given.
 * It is blocked by the issues `blockedBy` gives, and blocks those `blocking`
 * gives, by their numbers, and carries the labels `labels` names.
 */
export interface NewHootIssue {
  title: string
  description: string
  status: IssueStatus
  priority?: IssuePriority
  parent?: string
  blockedBy?: string[]
  blocking?: string[]
  labels?: string[]
}

/**
 * What changes about an issue's parent, sub-issues, dependencies and labels,
 * each issue given by its number in decimal digits and each label by its
 * name: its parent, or none for `removeParent`; issues that become its last
 * sub-issues, in this order, leaving any other parent they have; sub-issues
 * of it that become top-level issues; issues it becomes blocked by, or stops
 * being blocked by; issues that become blocked by it, or stop being blocked
 * by it; and labels it is given, in this order, or that are taken off it.
 */
export interface IssueEdit {
  parent?: string
  removeParent?: boolean
  addSubIssues?: string[]
  removeSubIssues?: string[]
  addBlockedBy?: string[]
  removeBlockedBy?: string[]
  addBlocking?: string[]
  removeBlocking?: string[]
  addLabels?: string[]
  removeLabels?: string[]
}

/**
 * An issue a sub-issue to create is blocked by or blocks: another of those
 * created with it, by its place among them from 1, or an issue of the
 * project, by its number in decimal digits.
 */
export type BatchReference = { item: number } | { issue: string }

/**
 * A sub-issue to create, as `NewHootIssue` gives one, but for the parent,
 * which is the issue they are created under.
 */
export interface BatchIssue {
  title: string
  description: string
  status: IssueStatus
  priority?: IssuePriority
  blockedBy: BatchReference[]
  blocking: BatchReference[]
  labels: string[]
}

/** Sub-issues to create together, in order, after the issue's other sub-issues. */
export interface BatchRequest {
  issues: BatchIssue[]
}

/** A label to create, without a group: its color, or one Hoot picks, and its description. */
export interface NewHootLabel {
  name: string
  color?: string
  description?: string
}

/** What changes about a label. */
export interface LabelEdit {
  name?: string
  color?: string
  description?: string
}

/** The longest first message a session is given, in UTF-16 code units. */
export const MAX_PROMPT_LENGTH = 1_000_000

/**
 * A session to start for an issue of the project, given by its number in
 * decimal digits, as its start button starts one; with its first message,
 * when one is given, instead of the one of the issue's workflow.
 */
export interface SessionRequest {
  issue: string
  prompt?: string
}

/**
 * The events of the hooks Hoot adds to every Claude Code session it starts,
 * which hoot reports to Hoot to show what the session is doing and which
 * conversation it is in: a session started or resumed, or a new
 * conversation started in it (`SessionStart`); a session ended
 * (`SessionEnd`); Claude Code asks the user to approve a tool call or a
 * plan, or to answer a question (`PermissionRequest`); an MCP server asks
 * the user for input (`Elicitation`); a turn starts, on a message of the
 * user's or the notification that a background agent is done
 * (`UserPromptSubmit`); a turn ends (`Stop`); and a turn stops on an API
 * error (`StopFailure`). The hook Hoot adds to Codex is on `UserPromptSubmit`
 * alone, for the conversation of each message.
 */
export const HOOK_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'PermissionRequest',
  'Elicitation',
  'UserPromptSubmit',
  'Stop',
  'StopFailure',
] as const

export type HookEvent = (typeof HOOK_EVENTS)[number]

/** An event of a hook of the session's Claude Code or Codex, as hoot reports it. */
export interface HookEventReport {
  /** The event, by the name the agent gives it. */
  event: HookEvent
  /**
   * When the hook's hoot started, in milliseconds since the Unix epoch: just
   * after the agent ran the hook, while the report can arrive much later.
   */
  startedAt: number
  /**
   * Whether one of Claude Code's subagents, rather than the session's own
   * agent, met the event, such as a background agent asking to run a command.
   */
  subagent: boolean
  /**
   * The turn the event belongs to, by the id Claude Code gives it (the
   * hook's `prompt_id`); `null` when the hook's input has none.
   */
  turn: string | null
  /**
   * The conversation the event belongs to, by the id the agent gives it (the
   * hook's `session_id`), which changes when `/clear` starts another.
   */
  conversationId?: string | null
  /** Why a `SessionStart` happened: `startup`, `resume`, `clear`, `compact` or `fork`. */
  source?: string | null
  /** Why a `SessionEnd` happened, such as `clear` or `exit`. */
  reason?: string | null
}

/** What Hoot answers: what was asked for, with the session's project, or why it could not be done. */
export type HootAnswer<T> =
  | ({ ok: true; project: HootProject } & T)
  | { ok: false; message: string }

export type IssueListAnswer = HootAnswer<{ issues: HootIssue[] }>
export type IssueAnswer = HootAnswer<{ issue: HootIssue | null }>
export type CreatedIssueAnswer = HootAnswer<{ issue: HootIssue }>
export type EditedIssueAnswer = HootAnswer<{ issue: HootIssue }>
export type BatchAnswer = HootAnswer<{ issues: HootIssue[] }>
export type LabelListAnswer = HootAnswer<{ labels: HootLabel[] }>
export type LabelAnswer = HootAnswer<{ label: HootLabel }>
export type DeletedLabelAnswer = HootAnswer<object>
/** The session started: the root of the worktree it runs in. */
export type SessionAnswer = HootAnswer<{ worktreePath: string }>
/** Hoot took the event; it needs no project, as a chat has none. */
export type HookEventAnswer = { ok: true } | { ok: false; message: string }

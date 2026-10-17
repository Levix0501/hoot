import http from 'node:http'
import {
  SESSION_HEADER,
  type BatchAnswer,
  type BatchIssue,
  type CreatedIssueAnswer,
  type DeletedLabelAnswer,
  type EditedIssueAnswer,
  type HootAnswer,
  type IssueAnswer,
  type IssueEdit,
  type IssueListAnswer,
  type LabelAnswer,
  type LabelEdit,
  type LabelListAnswer,
  type NewHootIssue,
  type NewHootLabel,
  type SessionAnswer,
} from '../shared/hoot-cli'

/** Something hoot cannot do, and why; it ends hoot with exit code 1. */
export class CliError extends Error {}

/** How long hoot waits for Hoot to answer. */
const ANSWER_TIMEOUT_MS = 30_000

/**
 * How long hoot waits for a session to start, which may need a worktree
 * created first: a little longer than Hoot waits for its window.
 */
const SESSION_TIMEOUT_MS = 6 * 60_000

/** Why hoot could not reach Hoot, by the error that the connection ended with. */
export function connectionProblem(error: NodeJS.ErrnoException): string {
  switch (error.code) {
    // No socket, or nothing listening on it.
    case 'ENOENT':
    case 'ECONNREFUSED':
      return 'Hoot is not running: the Hoot that started this session has quit.'
    case 'EPERM':
    case 'EACCES':
      return (
        'The system refused the connection to Hoot, which a sandbox may have blocked, such as ' +
        "Codex's at its Default and Read Only permission levels. Run hoot outside the sandbox."
      )
    default:
      return `Could not reach Hoot: ${error.message}`
  }
}

/**
 * Asks the Hoot that started the session hoot runs in, through the socket
 * the session's environment names.
 */
export class HootClient {
  constructor(
    private readonly socket: string,
    private readonly sessionId: string,
  ) {}

  /** Every issue of the session's project. */
  listIssues(): Promise<IssueListAnswer> {
    return this.ask('GET', '/issues')
  }

  /** The issue with this number, given in decimal digits, in the session's project, or `null`. */
  issue(digits: string): Promise<IssueAnswer> {
    return this.ask('GET', `/issues/${digits}`)
  }

  /** Creates an issue in the session's project. */
  createIssue(issue: NewHootIssue): Promise<CreatedIssueAnswer> {
    return this.ask('POST', '/issues', issue)
  }

  /**
   * Changes the parent, the sub-issues, the dependencies and the labels of
   * the issue with this number, given in decimal digits, in the session's
   * project.
   */
  editIssue(digits: string, edit: IssueEdit): Promise<EditedIssueAnswer> {
    return this.ask('PATCH', `/issues/${digits}`, edit)
  }

  /**
   * Creates sub-issues of the issue with this number, given in decimal
   * digits, in the session's project, all together or none.
   */
  createBatch(digits: string, issues: BatchIssue[]): Promise<BatchAnswer> {
    return this.ask('POST', `/issues/${digits}/sub-issues`, { issues })
  }

  /** Every label. */
  listLabels(): Promise<LabelListAnswer> {
    return this.ask('GET', '/labels')
  }

  createLabel(label: NewHootLabel): Promise<LabelAnswer> {
    return this.ask('POST', '/labels', label)
  }

  /** Changes the label with this name. */
  editLabel(name: string, edit: LabelEdit): Promise<LabelAnswer> {
    return this.ask('PATCH', `/labels/${encodeURIComponent(name)}`, edit)
  }

  /** Deletes the label with this name. */
  deleteLabel(name: string): Promise<DeletedLabelAnswer> {
    return this.ask('DELETE', `/labels/${encodeURIComponent(name)}`)
  }

  /**
   * Starts a session for the issue with this number, given in decimal digits,
   * in the session's project, with this first message when one is given.
   */
  startSession(digits: string, prompt: string | null): Promise<SessionAnswer> {
    return this.ask(
      'POST',
      '/sessions',
      { issue: digits, ...(prompt === null ? {} : { prompt }) },
      SESSION_TIMEOUT_MS,
    )
  }

  /** Sends a request, and settles with Hoot's answer; rejects with a `CliError` when there is none. */
  private ask<T extends HootAnswer<object>>(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs: number = ANSWER_TIMEOUT_MS,
  ): Promise<T> {
    const payload = body === undefined ? undefined : JSON.stringify(body)
    const headers: http.OutgoingHttpHeaders = { [SESSION_HEADER]: this.sessionId }
    if (payload !== undefined) {
      headers['content-type'] = 'application/json; charset=utf-8'
      headers['content-length'] = Buffer.byteLength(payload)
    }
    return new Promise((resolve, reject) => {
      const request = http.request(
        { socketPath: this.socket, path, method, headers, agent: false },
        (response) => {
          const chunks: Buffer[] = []
          response.on('data', (chunk: Buffer) => chunks.push(chunk))
          response.on('error', (error) => reject(new CliError(connectionProblem(error))))
          response.on('end', () => {
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T)
            } catch {
              reject(new CliError('Hoot gave an answer that hoot does not understand.'))
            }
          })
        },
      )
      request.setTimeout(timeoutMs, () =>
        request.destroy(new CliError('Hoot did not answer in time.')),
      )
      request.on('error', (error: NodeJS.ErrnoException) =>
        reject(error instanceof CliError ? error : new CliError(connectionProblem(error))),
      )
      request.end(payload)
    })
  }
}

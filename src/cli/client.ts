import http from 'node:http'
import {
  SESSION_HEADER,
  type CreatedIssueAnswer,
  type HootAnswer,
  type IssueAnswer,
  type IssueListAnswer,
  type NewHootIssue,
} from '../shared/hoot-cli'

/** Something hoot cannot do, and why; it ends hoot with exit code 1. */
export class CliError extends Error {}

/** How long hoot waits for Hoot to answer. */
const ANSWER_TIMEOUT_MS = 30_000

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

  /** Sends a request, and settles with Hoot's answer; rejects with a `CliError` when there is none. */
  private ask<T extends HootAnswer<object>>(
    method: string,
    path: string,
    body?: unknown,
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
      request.setTimeout(ANSWER_TIMEOUT_MS, () =>
        request.destroy(new CliError('Hoot did not answer in time.')),
      )
      request.on('error', (error: NodeJS.ErrnoException) =>
        reject(error instanceof CliError ? error : new CliError(connectionProblem(error))),
      )
      request.end(payload)
    })
  }
}

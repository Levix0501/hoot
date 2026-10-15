import fs from 'node:fs'
import http from 'node:http'
import { z } from 'zod'
import {
  SESSION_HEADER,
  type CreatedIssueAnswer,
  type HootAnswer,
  type HootProject,
  type IssueAnswer,
  type IssueListAnswer,
  type NewHootIssue,
  type StepReportAnswer,
  type StepReportRequest,
} from '../../shared/hoot-cli'
import type { Project } from '../../shared/ipc'
import { oneLineTitle, type Issue } from '../../shared/issues'
import { STEP_SUMMARY_MAX_LENGTH } from '../../shared/workflows'
import { issueDescription, issuePriority, issueStatus, issueTitle } from '../issues/issue-schemas'
import type { IssueStore } from '../issues/issue-store'
import type { StepReportResult } from '../workflows/workflow-executor'

/**
 * The most a request may send: a new issue at the longest Hoot saves, even
 * with every character escaped in its JSON.
 */
const MAX_BODY_BYTES = 8 * 1024 * 1024

const newHootIssue = z.strictObject({
  title: issueTitle,
  description: issueDescription,
  status: issueStatus,
  priority: issuePriority,
}) satisfies z.ZodType<NewHootIssue>

const stepReportRequest = z.strictObject({
  outcome: z.string().max(1_000),
  // Not empty, and not only whitespace.
  summary: z
    .string()
    .max(STEP_SUMMARY_MAX_LENGTH)
    .refine((summary) => summary.trim() !== ''),
}) satisfies z.ZodType<StepReportRequest>

/** The project a session runs for, or why there is none. */
export type SessionProject = { ok: true; project: Project } | { ok: false; message: string }

export interface HootServerOptions {
  /** Where to listen: the path of a Unix domain socket, or on Windows of a named pipe. */
  address: string
  platform?: NodeJS.Platform
  /** The project of the session with this id, which hoot runs in. */
  sessionProject(sessionId: string): SessionProject
  issues: Pick<IssueStore, 'listInProject' | 'getInProject' | 'create'>
  /** Called with each issue hoot creates, once it is saved. */
  issueCreated(issue: Issue): void
  /**
   * Reports an outcome, with the agent's summary, of the current step of the
   * workflow of the issue the session with this id was started from.
   */
  reportStep(sessionId: string, outcome: string, summary: string): StepReportResult
}

type Reply = { status: number; answer: HootAnswer<object> }

class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

function failure(status: number, message: string): Reply {
  return { status, answer: { ok: false, message } }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Reads a request's body as JSON. */
async function readJson(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new RequestError(413, 'The request is too large.')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new RequestError(400, 'The request is not JSON.')
  }
}

/**
 * Answers hoot, run in a session this Hoot started: it reads the issues of the
 * session's project, creates issues in it, and reports the steps of the
 * workflow of the issue the session was started from. It listens only where the
 * sessions' environment tells hoot to connect, through a Unix domain socket
 * that only the user can connect to, or on Windows a named pipe.
 */
export class HootServer {
  private readonly server = http.createServer(
    (request, response) => void this.respond(request, response),
  )
  /** Settles once the server listens, or could not. */
  private listening: Promise<void> | null = null

  constructor(private readonly options: HootServerOptions) {}

  /** Starts listening; rejects when it cannot. */
  start(): Promise<void> {
    this.listening ??= this.listen()
    return this.listening
  }

  private async listen(): Promise<void> {
    const { address } = this.options
    const unix = (this.options.platform ?? process.platform) !== 'win32'
    // A socket there is left from a Hoot that stopped without quitting: no
    // other Hoot keeps its data in the same user data directory.
    if (unix) fs.rmSync(address, { force: true })
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(address, () => {
        this.server.off('error', reject)
        resolve()
      })
    })
    // Only the user can connect to it, whatever folder it is in.
    if (unix) fs.chmodSync(address, 0o600)
  }

  /** Stops listening, once it has started to, and removes the socket. */
  async stop(): Promise<void> {
    if (this.listening === null) return
    try {
      await this.listening
    } catch {
      // It never listened.
      return
    }
    if (!this.server.listening) return
    const closed = new Promise<void>((resolve) => this.server.close(() => resolve()))
    this.server.closeAllConnections()
    await closed
  }

  private async respond(request: http.IncomingMessage, response: http.ServerResponse) {
    let reply: Reply
    try {
      reply = await this.handle(request)
    } catch (error) {
      reply =
        error instanceof RequestError
          ? failure(error.status, error.message)
          : failure(500, errorMessage(error))
    }
    const body = JSON.stringify(reply.answer)
    response.writeHead(reply.status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
    })
    response.end(body)
  }

  private async handle(request: http.IncomingMessage): Promise<Reply> {
    const sessionId = request.headers[SESSION_HEADER]
    if (typeof sessionId !== 'string' || sessionId === '') {
      return failure(400, 'The request does not say which session it comes from.')
    }
    const found = this.options.sessionProject(sessionId)
    if (!found.ok) return failure(404, found.message)
    const { id: projectId, name } = found.project
    const project: HootProject = { name }
    const { pathname } = new URL(request.url ?? '/', 'http://hoot')

    if (pathname === '/issues' && request.method === 'GET') {
      const answer: IssueListAnswer = {
        ok: true,
        project,
        issues: this.options.issues.listInProject(projectId),
      }
      return { status: 200, answer }
    }

    const numbered = /^\/issues\/(\d+)$/.exec(pathname)
    if (numbered && request.method === 'GET') {
      // A number too large to be any issue's has none.
      const number = Number(numbered[1])
      const answer: IssueAnswer = {
        ok: true,
        project,
        issue: Number.isSafeInteger(number)
          ? this.options.issues.getInProject(projectId, number)
          : null,
      }
      return { status: 200, answer }
    }

    if (pathname === '/issues' && request.method === 'POST') {
      const parsed = newHootIssue.safeParse(await readJson(request))
      if (!parsed.success) return failure(400, 'Invalid issue.')
      let issue: Issue | null
      try {
        // As the new issue dialog creates it, whose title field takes the title on one line.
        issue = this.options.issues.create({
          projectId,
          ...parsed.data,
          title: oneLineTitle(parsed.data.title),
        })
      } catch (error) {
        // Such as a title of nothing but whitespace.
        return failure(400, errorMessage(error))
      }
      if (issue === null) return failure(404, "The session's project is no longer in Hoot's list.")
      try {
        this.options.issueCreated(issue)
      } catch (error) {
        // The issue is saved all the same; the window shows it once it reads the issues again.
        console.error('Could not show the issue hoot created:', error)
      }
      const answer: CreatedIssueAnswer = { ok: true, project, issue }
      return { status: 201, answer }
    }

    if (pathname === '/steps/report' && request.method === 'POST') {
      const parsed = stepReportRequest.safeParse(await readJson(request))
      if (!parsed.success) return failure(400, 'Invalid report.')
      const { outcome, summary } = parsed.data
      const result = this.options.reportStep(sessionId, outcome, summary)
      if (!result.ok) return failure(409, result.message)
      const answer: StepReportAnswer = { ok: true, project, report: result.report }
      return { status: 200, answer }
    }

    return failure(404, 'Hoot does not know this request.')
  }
}

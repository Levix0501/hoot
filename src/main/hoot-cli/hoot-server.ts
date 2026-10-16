import fs from 'node:fs'
import http from 'node:http'
import { z } from 'zod'
import {
  SESSION_HEADER,
  type CreatedIssueAnswer,
  type EditedIssueAnswer,
  type HootAnswer,
  type HootIssue,
  type HootProject,
  type IssueAnswer,
  type IssueEdit,
  type IssueListAnswer,
  type NewHootIssue,
  type RelatedIssue,
  type StepReportAnswer,
  type StepReportRequest,
} from '../../shared/hoot-cli'
import type { Project } from '../../shared/ipc'
import { issueIdentifier, oneLineTitle, type Issue } from '../../shared/issues'
import { parentOf, type ParentChange } from '../../shared/sub-issues'
import { STEP_SUMMARY_MAX_LENGTH } from '../../shared/workflows'
import { issueDescription, issuePriority, issueStatus, issueTitle } from '../issues/issue-schemas'
import { SubIssueError, type IssueStore } from '../issues/issue-store'
import type { StepReportResult } from '../workflows/workflow-executor'

/**
 * The most a request may send: a new issue at the longest Hoot saves, even
 * with every character escaped in its JSON.
 */
const MAX_BODY_BYTES = 8 * 1024 * 1024

/** An issue's number in decimal digits, as hoot passes it on from the command line. */
const issueDigits = z.string().regex(/^\d{1,100}$/)

const newHootIssue = z.strictObject({
  title: issueTitle,
  description: issueDescription,
  status: issueStatus,
  priority: issuePriority.optional(),
  parent: issueDigits.optional(),
}) satisfies z.ZodType<NewHootIssue>

const issueEdit = z.strictObject({
  parent: issueDigits.optional(),
  removeParent: z.boolean().optional(),
  addSubIssues: z.array(issueDigits).max(1_000).optional(),
  removeSubIssues: z.array(issueDigits).max(1_000).optional(),
}) satisfies z.ZodType<IssueEdit>

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
  /** The projects in the list, which name the projects of the issues related to an issue. */
  listProjects(): Project[]
  issues: Pick<
    IssueStore,
    'list' | 'listInProject' | 'getInProject' | 'create' | 'subIssues' | 'setParents'
  >
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

/** What hoot says when the session's project has no issue with this number. */
function noSuchIssue(digits: string, project: HootProject): string {
  return `There is no issue ISS-${digits} in this session's project, ${project.name}.`
}

/**
 * Answers hoot, run in a session this Hoot started: it reads the issues of the
 * session's project, creates issues in it, changes their parents and
 * sub-issues, and reports the steps of the
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

  /** The issue with this number, given in decimal digits, if it is in the project. */
  private issueOf(projectId: number, digits: string): Issue | null {
    // A number too large to be any issue's has none.
    const number = Number(digits)
    return Number.isSafeInteger(number) ? this.options.issues.getInProject(projectId, number) : null
  }

  /**
   * Issues with their parents and sub-issues, those Hoot shows: without the
   * issues of projects removed from the list.
   */
  private withRelations(issues: readonly Issue[]): HootIssue[] {
    const shown = new Map(this.options.issues.list().map((issue) => [issue.id, issue]))
    const names = new Map(this.options.listProjects().map((project) => [project.id, project.name]))
    const { links } = this.options.issues.subIssues()
    const related = (id: number): RelatedIssue[] => {
      const issue = shown.get(id)
      if (issue === undefined) return []
      const { title, status, projectId } = issue
      const project = projectId === null ? null : (names.get(projectId) ?? null)
      return [{ id, title, status, projectId, project }]
    }
    const children = new Map<number, number[]>()
    for (const { issueId, parentId } of links) {
      children.set(parentId, [...(children.get(parentId) ?? []), issueId])
    }
    return issues.map((issue) => {
      const parentId = parentOf(links, issue.id)
      return {
        ...issue,
        parent: parentId === null ? null : (related(parentId)[0] ?? null),
        subIssues: (children.get(issue.id) ?? []).flatMap(related),
      }
    })
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
    const project: HootProject = { id: projectId, name }
    const { pathname } = new URL(request.url ?? '/', 'http://hoot')

    if (pathname === '/issues' && request.method === 'GET') {
      const answer: IssueListAnswer = {
        ok: true,
        project,
        issues: this.withRelations(this.options.issues.listInProject(projectId)),
      }
      return { status: 200, answer }
    }

    const numbered = /^\/issues\/(\d+)$/.exec(pathname)
    if (numbered && request.method === 'GET') {
      const issue = this.issueOf(projectId, numbered[1]!)
      const answer: IssueAnswer = {
        ok: true,
        project,
        issue: issue === null ? null : this.withRelations([issue])[0]!,
      }
      return { status: 200, answer }
    }

    if (pathname === '/issues' && request.method === 'POST') {
      const parsed = newHootIssue.safeParse(await readJson(request))
      if (!parsed.success) return failure(400, 'Invalid issue.')
      const { parent: parentDigits, priority, ...fields } = parsed.data
      let parent: Issue | null = null
      if (parentDigits !== undefined) {
        parent = this.issueOf(projectId, parentDigits)
        if (parent === null) return failure(404, noSuchIssue(parentDigits, project))
      }
      let issue: Issue | null
      try {
        // As the new issue dialog creates it, whose title field takes the title on one line.
        issue = this.options.issues.create(
          {
            projectId,
            ...fields,
            priority: priority ?? parent?.priority ?? 0,
            title: oneLineTitle(fields.title),
          },
          parent?.id ?? null,
        )
      } catch (error) {
        // Such as a title of nothing but whitespace, or a parent with all the sub-issues it can have.
        return failure(error instanceof SubIssueError ? 409 : 400, errorMessage(error))
      }
      if (issue === null) return failure(404, "The session's project is no longer in Hoot's list.")
      try {
        this.options.issueCreated(issue)
      } catch (error) {
        // The issue is saved all the same; the window shows it once it reads the issues again.
        console.error('Could not show the issue hoot created:', error)
      }
      const answer: CreatedIssueAnswer = {
        ok: true,
        project,
        issue: this.withRelations([issue])[0]!,
      }
      return { status: 201, answer }
    }

    if (numbered && request.method === 'PATCH') {
      const parsed = issueEdit.safeParse(await readJson(request))
      if (!parsed.success) return failure(400, 'Invalid change.')
      return this.edit(projectId, project, numbered[1]!, parsed.data)
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

  /**
   * Changes the parent and the sub-issues of an issue of the project, all
   * together or not at all.
   */
  private edit(projectId: number, project: HootProject, digits: string, edit: IssueEdit): Reply {
    const { parent, removeParent = false, addSubIssues = [], removeSubIssues = [] } = edit
    if (
      parent === undefined &&
      !removeParent &&
      addSubIssues.length + removeSubIssues.length === 0
    ) {
      return failure(400, 'Nothing to change.')
    }
    if (parent !== undefined && removeParent) {
      return failure(400, 'An issue cannot both get a parent and lose its parent.')
    }
    const issue = this.issueOf(projectId, digits)
    if (issue === null) return failure(404, noSuchIssue(digits, project))
    const ids = new Map<string, number>()
    for (const given of [parent, ...addSubIssues, ...removeSubIssues]) {
      if (given === undefined) continue
      const found = this.issueOf(projectId, given)
      if (found === null) return failure(404, noSuchIssue(given, project))
      ids.set(given, found.id)
    }
    const identifier = issueIdentifier(issue.id)
    const { links } = this.options.issues.subIssues()
    // Not one of a project removed from the list, which hoot does not show.
    if (removeParent && this.withRelations([issue])[0]!.parent === null) {
      return failure(409, `${identifier} has no parent issue.`)
    }
    const added = addSubIssues.map((given) => ids.get(given)!)
    const removed = removeSubIssues.map((given) => ids.get(given)!)
    for (const id of removed) {
      if (parentOf(links, id) !== issue.id) {
        return failure(409, `${issueIdentifier(id)} is not a sub-issue of ${identifier}.`)
      }
      if (added.includes(id)) {
        return failure(
          409,
          `${issueIdentifier(id)} cannot both become and stop being a sub-issue of ${identifier}.`,
        )
      }
    }
    const changes: ParentChange[] = [
      ...removed.map((id) => ({ issueId: id, parentId: null })),
      ...(parent !== undefined ? [{ issueId: issue.id, parentId: ids.get(parent)! }] : []),
      ...(removeParent ? [{ issueId: issue.id, parentId: null }] : []),
      ...added.map((id) => ({ issueId: id, parentId: issue.id })),
    ]
    try {
      this.options.issues.setParents(changes)
    } catch (error) {
      return failure(error instanceof SubIssueError ? 409 : 400, errorMessage(error))
    }
    const answer: EditedIssueAnswer = {
      ok: true,
      project,
      issue: this.withRelations([
        this.options.issues.getInProject(projectId, issue.id) ?? issue,
      ])[0]!,
    }
    return { status: 200, answer }
  }
}

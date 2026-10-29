import fs from 'node:fs'
import http from 'node:http'
import { z } from 'zod'
import {
  HOOK_EVENTS,
  SESSION_HEADER,
  type BatchAnswer,
  type BatchIssue,
  type BatchRequest,
  type CreatedIssueAnswer,
  type DeletedLabelAnswer,
  type EditedIssueAnswer,
  type HookEventAnswer,
  type HookEventReport,
  type HootAnswer,
  type HootIssue,
  type HootLabel,
  type HootProject,
  MAX_PROMPT_LENGTH,
  type IssueAnswer,
  type IssueEdit,
  type IssueListAnswer,
  type LabelAnswer,
  type LabelEdit,
  type LabelListAnswer,
  type NewHootIssue,
  type NewHootLabel,
  type RelatedIssue,
  type SessionAnswer,
  type SessionRequest,
} from '../../shared/hoot-cli'
import { blockedByIdsOf, blockingIdsOf, type Dependency } from '../../shared/dependencies'
import type { Project } from '../../shared/ipc'
import {
  issueIdentifier,
  issueTitle as savedTitle,
  oneLineTitle,
  type Issue,
} from '../../shared/issues'
import { labelText as writtenLabel, type NamedLabel } from '../../shared/labels'
import { startBlockerText, type StartBlocker } from '../../shared/start-blockers'
import { parentOf, type ParentChange } from '../../shared/sub-issues'
import { issueDescription, issuePriority, issueStatus, issueTitle } from '../issues/issue-schemas'
import {
  DependencyError,
  SubIssueError,
  type IssueReference,
  type IssueStore,
} from '../issues/issue-store'
import { LabelError, type LabelStore } from '../labels/label-store'

/**
 * The most a request may send: a new issue at the longest Hoot saves, even
 * with every character escaped in its JSON.
 */
const MAX_BODY_BYTES = 8 * 1024 * 1024

/** An issue's number in decimal digits, as hoot passes it on from the command line. */
const issueDigits = z.string().regex(/^\d{1,100}$/)
const issueList = z.array(issueDigits).max(1_000)
/** Names of labels, as hoot passes them on from the command line. */
const labelNames = z.array(z.string().max(1_000)).max(1_000)

const newHootIssue = z.strictObject({
  title: issueTitle,
  description: issueDescription,
  status: issueStatus,
  priority: issuePriority.optional(),
  parent: issueDigits.optional(),
  blockedBy: issueList.optional(),
  blocking: issueList.optional(),
  labels: labelNames.optional(),
}) satisfies z.ZodType<NewHootIssue>

const issueEdit = z.strictObject({
  parent: issueDigits.optional(),
  removeParent: z.boolean().optional(),
  addSubIssues: issueList.optional(),
  removeSubIssues: issueList.optional(),
  addBlockedBy: issueList.optional(),
  removeBlockedBy: issueList.optional(),
  addBlocking: issueList.optional(),
  removeBlocking: issueList.optional(),
  addLabels: labelNames.optional(),
  removeLabels: labelNames.optional(),
}) satisfies z.ZodType<IssueEdit>

const batchReference = z.union([
  z.strictObject({ item: z.number().int().min(1).max(1_000) }),
  z.strictObject({ issue: issueDigits }),
])
const batchRequest = z.strictObject({
  issues: z
    .array(
      z.strictObject({
        title: issueTitle,
        description: issueDescription,
        status: issueStatus,
        priority: issuePriority.optional(),
        blockedBy: z.array(batchReference).max(1_000),
        blocking: z.array(batchReference).max(1_000),
        labels: labelNames,
      }) satisfies z.ZodType<BatchIssue>,
    )
    .max(1_000),
}) satisfies z.ZodType<BatchRequest>

const labelText = z.string().max(100_000)
const newHootLabel = z.strictObject({
  name: labelText,
  color: labelText.optional(),
  description: labelText.optional(),
}) satisfies z.ZodType<NewHootLabel>
const labelEdit = z.strictObject({
  name: labelText.optional(),
  color: labelText.optional(),
  description: labelText.optional(),
}) satisfies z.ZodType<LabelEdit>

const sessionRequest = z.strictObject({
  issue: issueDigits,
  prompt: z.string().max(MAX_PROMPT_LENGTH).optional(),
}) satisfies z.ZodType<SessionRequest>

const hookEventReport = z.strictObject({
  event: z.enum(HOOK_EVENTS),
  startedAt: z.number().finite(),
  subagent: z.boolean(),
  turn: z.string().min(1).nullable(),
  conversationId: z.string().min(1).nullable().optional(),
  source: z.string().min(1).nullable().optional(),
  reason: z.string().min(1).nullable().optional(),
  folder: z.string().min(1).nullable().optional(),
}) satisfies z.ZodType<HookEventReport>

/** The project a session runs for, or why there is none. */
export type SessionProject = { ok: true; project: Project } | { ok: false; message: string }

/** A session started for an issue: the root of the worktree it runs in; or why it did not start. */
export type StartedSession = { ok: true; worktreePath: string } | { ok: false; message: string }

export interface HootServerOptions {
  /** Where to listen: the path of a Unix domain socket, or on Windows of a named pipe. */
  address: string
  platform?: NodeJS.Platform
  /** Whether this Hoot runs a session with this id, which a chat's session has without a project. */
  hasSession(sessionId: string): boolean
  /** The project of the session with this id, which hoot runs in. */
  sessionProject(sessionId: string): SessionProject
  /** The projects in the list, which name the projects of the issues related to an issue. */
  listProjects(): Project[]
  issues: Pick<
    IssueStore,
    | 'list'
    | 'listInProject'
    | 'getInProject'
    | 'create'
    | 'createSubIssues'
    | 'subIssues'
    | 'dependencies'
    | 'changeRelations'
  >
  labels: Pick<
    LabelStore,
    | 'list'
    | 'labelsOf'
    | 'findByName'
    | 'createLabel'
    | 'editLabel'
    | 'deleteLabel'
    | 'changeIssueLabels'
  >
  /** Makes the changes `body` makes all together, or, when it throws, none of them. */
  together<T>(body: () => T): T
  /** Called with each issue hoot creates, once it is saved. */
  issueCreated(issue: Issue): void
  /** Why work on an issue cannot be started now; none when it can. */
  startBlockers(issue: Issue): StartBlocker[]
  /**
   * Starts a session for an issue, as its start button does, without showing
   * it, with `prompt` as its first message when one is given; settles once
   * it has started, or could not.
   */
  startSession(issueId: number, prompt: string | null): Promise<StartedSession>
  /**
   * Called with each event of a hook of a session's Claude Code or Codex, or
   * of the plugin Hoot gives its OpenCode, that hoot reports.
   */
  hookEvent(sessionId: string, report: HookEventReport): void
}

type Reply = { status: number; answer: HootAnswer<object> | HookEventAnswer }

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

/** What hoot says when no label has this name. */
function noSuchLabel(name: string): string {
  return `There is no label named "${name}". Run "hoot label list" for the labels there are.`
}

/** The status of an answer to a change that cannot be made, by what was thrown. */
function refusal(error: unknown): number {
  // Such as a parent with all the sub-issues it can have, an issue that would wait for itself, or a label name taken.
  return error instanceof SubIssueError ||
    error instanceof DependencyError ||
    error instanceof LabelError
    ? 409
    : 400
}

/** Something wrong with what was asked, which an answer says. */
class Refusal extends Error {
  constructor(readonly reply: Reply) {
    super(reply.answer.ok ? '' : reply.answer.message)
  }
}

/** A label as hoot gets it. */
function hootLabel(label: NamedLabel): HootLabel {
  return {
    name: label.name,
    color: label.color,
    description: label.description,
    group: label.group,
  }
}

/**
 * Answers hoot, run in a session this Hoot started: it reads the issues of the
 * session's project, creates issues in it, alone or as sub-issues of an issue
 * all at once, changes their parents, sub-issues, dependencies and labels,
 * reads, creates, changes and deletes labels, starts sessions for the
 * issues, and takes the events of the hooks Hoot adds to the sessions'
 * Claude Code and Codex and of the plugin it gives their OpenCode. It listens
 * only where the sessions' environment tells hoot to connect, through a Unix
 * domain socket that only the user can connect to, or on Windows a named
 * pipe.
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
   * The issues of the project with these numbers, in decimal digits, by
   * their ids; a `Refusal` when one is not.
   */
  private issuesOf(projectId: number, project: HootProject, list: readonly string[]): number[] {
    return list.map((digits) => {
      const found = this.issueOf(projectId, digits)
      if (found === null) throw new Refusal(failure(404, noSuchIssue(digits, project)))
      return found.id
    })
  }

  /** The ids of the labels with these names; a `Refusal` when one has none. */
  private labelsNamed(names: readonly string[]): number[] {
    return names.map((name) => {
      const found = this.options.labels.findByName(name)
      if (found === undefined) throw new Refusal(failure(404, noSuchLabel(name)))
      return found.id
    })
  }

  /** The label with this name; a `Refusal` when there is none. */
  private labelNamed(name: string): NamedLabel {
    const found = this.options.labels.findByName(name)
    if (found === undefined) throw new Refusal(failure(404, noSuchLabel(name)))
    return found
  }

  /**
   * Issues with their parents, sub-issues, dependencies and labels, those
   * Hoot shows: without the issues of projects removed from the list.
   */
  private withRelations(issues: readonly Issue[]): HootIssue[] {
    const shown = new Map(this.options.issues.list().map((issue) => [issue.id, issue]))
    const names = new Map(this.options.listProjects().map((project) => [project.id, project.name]))
    const { links } = this.options.issues.subIssues()
    const dependencies = this.options.issues.dependencies().links
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
        blockedBy: blockedByIdsOf(dependencies, issue.id).flatMap(related),
        blocking: blockingIdsOf(dependencies, issue.id).flatMap(related),
        labels: this.options.labels.labelsOf(issue.id).map(hootLabel),
      }
    })
  }

  /** The issue with this id as it is saved now, with its relations, or as it was. */
  private current(projectId: number, issue: Issue): HootIssue {
    return this.withRelations([this.options.issues.getInProject(projectId, issue.id) ?? issue])[0]!
  }

  /** Tells the window of each issue hoot created, once it is saved. */
  private reportCreated(issues: readonly Issue[]): void {
    for (const issue of issues) {
      try {
        this.options.issueCreated(issue)
      } catch (error) {
        // The issue is saved all the same; the window shows it once it reads the issues again.
        console.error('Could not show the issue hoot created:', error)
      }
    }
  }

  private async respond(request: http.IncomingMessage, response: http.ServerResponse) {
    let reply: Reply
    try {
      reply = await this.handle(request)
    } catch (error) {
      if (error instanceof Refusal) reply = error.reply
      else if (error instanceof RequestError) reply = failure(error.status, error.message)
      else reply = failure(500, errorMessage(error))
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
    const { pathname } = new URL(request.url ?? '/', 'http://hoot')
    // A chat's session has no project, but its agent's hooks still tell Hoot
    // which conversation it is in.
    if (pathname === '/hook-events' && request.method === 'POST') {
      if (!this.options.hasSession(sessionId)) return failure(404, 'No such session.')
      const parsed = hookEventReport.safeParse(await readJson(request))
      if (!parsed.success) return failure(400, 'Invalid hook event.')
      this.options.hookEvent(sessionId, parsed.data)
      const answer: HookEventAnswer = { ok: true }
      return { status: 200, answer }
    }
    const found = this.options.sessionProject(sessionId)
    if (!found.ok) return failure(404, found.message)
    const { id: projectId, name } = found.project
    const project: HootProject = { id: projectId, name }

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
      return this.create(projectId, project, parsed.data)
    }

    if (numbered && request.method === 'PATCH') {
      const parsed = issueEdit.safeParse(await readJson(request))
      if (!parsed.success) return failure(400, 'Invalid change.')
      return this.edit(projectId, project, numbered[1]!, parsed.data)
    }

    const batch = /^\/issues\/(\d+)\/sub-issues$/.exec(pathname)
    if (batch && request.method === 'POST') {
      const parsed = batchRequest.safeParse(await readJson(request))
      if (!parsed.success) return failure(400, 'Invalid issues.')
      return this.createBatch(projectId, project, batch[1]!, parsed.data.issues)
    }

    if (pathname === '/labels' && request.method === 'GET') {
      const answer: LabelListAnswer = {
        ok: true,
        project,
        labels: this.options.labels.list().map(hootLabel),
      }
      return { status: 200, answer }
    }

    if (pathname === '/labels' && request.method === 'POST') {
      const parsed = newHootLabel.safeParse(await readJson(request))
      if (!parsed.success) return failure(400, 'Invalid label.')
      const { name: labelName, color, description } = parsed.data
      try {
        const label = this.options.labels.createLabel({
          name: labelName,
          ...(color === undefined ? {} : { color }),
          ...(description === undefined ? {} : { description }),
        })
        const answer: LabelAnswer = { ok: true, project, label: hootLabel(label) }
        return { status: 201, answer }
      } catch (error) {
        return failure(refusal(error), errorMessage(error))
      }
    }

    // On the path as sent: parsing the URL takes a name of `.` or `..` for a
    // part of the path, and drops it.
    const labelPath = /^\/labels\/(.+)$/.exec((request.url ?? '/').split('?')[0]!)
    if (labelPath && (request.method === 'PATCH' || request.method === 'DELETE')) {
      let given: string
      try {
        given = decodeURIComponent(labelPath[1]!)
      } catch {
        return failure(400, 'Invalid label.')
      }
      if (request.method === 'DELETE') {
        const label = this.labelNamed(given)
        try {
          this.options.labels.deleteLabel(label.id)
        } catch (error) {
          return failure(refusal(error), errorMessage(error))
        }
        const answer: DeletedLabelAnswer = { ok: true, project }
        return { status: 200, answer }
      }
      const parsed = labelEdit.safeParse(await readJson(request))
      if (!parsed.success) return failure(400, 'Invalid change.')
      const changes = parsed.data
      if (Object.keys(changes).length === 0) return failure(400, 'Nothing to change.')
      const label = this.labelNamed(given)
      try {
        const edited = this.options.labels.editLabel(label.id, changes)
        const answer: LabelAnswer = { ok: true, project, label: hootLabel(edited) }
        return { status: 200, answer }
      } catch (error) {
        return failure(refusal(error), errorMessage(error))
      }
    }

    if (pathname === '/sessions' && request.method === 'POST') {
      const parsed = sessionRequest.safeParse(await readJson(request))
      if (!parsed.success) return failure(400, 'Invalid session.')
      return this.startSession(projectId, project, parsed.data)
    }

    if (pathname === '/hook-events' && request.method === 'POST') {
      const parsed = hookEventReport.safeParse(await readJson(request))
      if (!parsed.success) return failure(400, 'Invalid hook event.')
      this.options.hookEvent(sessionId, parsed.data)
      const answer: HookEventAnswer = { ok: true }
      return { status: 200, answer }
    }

    return failure(404, 'Hoot does not know this request.')
  }

  /** Creates an issue in the project, with its parent, dependencies and labels, or nothing. */
  private create(projectId: number, project: HootProject, request: NewHootIssue): Reply {
    const {
      parent: parentDigits,
      priority,
      blockedBy = [],
      blocking = [],
      labels = [],
      ...fields
    } = request
    let parent: Issue | null = null
    if (parentDigits !== undefined) {
      parent = this.issueOf(projectId, parentDigits)
      if (parent === null) return failure(404, noSuchIssue(parentDigits, project))
    }
    const dependencies = {
      blockedBy: this.issuesOf(projectId, project, blockedBy),
      blocking: this.issuesOf(projectId, project, blocking),
    }
    const labelIds = this.labelsNamed(labels)
    let issue: Issue | null
    try {
      issue = this.options.together(() => {
        // As the new issue dialog creates it, whose title field takes the title on one line.
        const created = this.options.issues.create(
          {
            projectId,
            ...fields,
            priority: priority ?? parent?.priority ?? 0,
            title: oneLineTitle(fields.title),
          },
          parent?.id ?? null,
          dependencies,
        )
        if (created !== null && labelIds.length > 0) {
          this.options.labels.changeIssueLabels(created.id, { add: labelIds }, 'agent')
        }
        return created
      })
    } catch (error) {
      // Such as a title of nothing but whitespace, or a parent with all the sub-issues it can have.
      return failure(refusal(error), errorMessage(error))
    }
    if (issue === null) return failure(404, "The session's project is no longer in Hoot's list.")
    this.reportCreated([issue])
    const answer: CreatedIssueAnswer = { ok: true, project, issue: this.current(projectId, issue) }
    return { status: 201, answer }
  }

  /**
   * Changes the parent, the sub-issues, the dependencies and the labels of an
   * issue of the project, all together or not at all.
   */
  private edit(projectId: number, project: HootProject, digits: string, edit: IssueEdit): Reply {
    const {
      parent,
      removeParent = false,
      addSubIssues = [],
      removeSubIssues = [],
      addBlockedBy = [],
      removeBlockedBy = [],
      addBlocking = [],
      removeBlocking = [],
      addLabels = [],
      removeLabels = [],
    } = edit
    const listed =
      addSubIssues.length +
      removeSubIssues.length +
      addBlockedBy.length +
      removeBlockedBy.length +
      addBlocking.length +
      removeBlocking.length
    const labelled = addLabels.length + removeLabels.length
    if (parent === undefined && !removeParent && listed === 0 && labelled === 0) {
      return failure(400, 'Nothing to change.')
    }
    if (parent !== undefined && removeParent) {
      return failure(400, 'An issue cannot both get a parent and lose its parent.')
    }
    const issue = this.issueOf(projectId, digits)
    if (issue === null) return failure(404, noSuchIssue(digits, project))
    const ids = new Map<string, number>()
    for (const given of [
      parent,
      ...addSubIssues,
      ...removeSubIssues,
      ...addBlockedBy,
      ...removeBlockedBy,
      ...addBlocking,
      ...removeBlocking,
    ]) {
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
    const of = (list: readonly string[]) => list.map((given) => ids.get(given)!)
    const blockedBy = (id: number): Dependency => ({ issueId: issue.id, blockedById: id })
    const blocking = (id: number): Dependency => ({ issueId: id, blockedById: issue.id })
    for (const id of of(removeBlockedBy)) {
      if (of(addBlockedBy).includes(id)) {
        return failure(
          409,
          `${identifier} cannot both become blocked by ${issueIdentifier(id)} and stop being ` +
            'blocked by it.',
        )
      }
    }
    for (const id of of(removeBlocking)) {
      if (of(addBlocking).includes(id)) {
        return failure(
          409,
          `${issueIdentifier(id)} cannot both become blocked by ${identifier} and stop being ` +
            'blocked by it.',
        )
      }
    }
    const labelsAdded = this.labelsNamed(addLabels)
    const labelsRemoved = this.labelsNamed(removeLabels)
    // Refused before anything changes: the store of the issues tells the
    // window of the parents and dependencies it changed before the labels
    // would be refused, and the window would show them though none is saved.
    const both = labelsRemoved.findIndex((id) => labelsAdded.includes(id))
    if (both !== -1) {
      const label = this.labelNamed(removeLabels[both]!)
      return failure(
        409,
        `${writtenLabel(label.name, label.group)} cannot both be given to ${identifier} and taken off it.`,
      )
    }
    try {
      this.options.together(() => {
        if (parent !== undefined || removeParent || listed > 0) {
          this.options.issues.changeRelations({
            parents: changes,
            removeDependencies: [
              ...of(removeBlockedBy).map(blockedBy),
              ...of(removeBlocking).map(blocking),
            ],
            addDependencies: [...of(addBlockedBy).map(blockedBy), ...of(addBlocking).map(blocking)],
          })
        }
        if (labelled > 0) {
          this.options.labels.changeIssueLabels(
            issue.id,
            { add: labelsAdded, remove: labelsRemoved },
            'agent',
          )
        }
      })
    } catch (error) {
      return failure(refusal(error), errorMessage(error))
    }
    const answer: EditedIssueAnswer = { ok: true, project, issue: this.current(projectId, issue) }
    return { status: 200, answer }
  }

  /**
   * Creates sub-issues of an issue of the project, with their dependencies
   * and labels, all together or, when one of them cannot be created, none,
   * and reports each once it is saved.
   */
  private createBatch(
    projectId: number,
    project: HootProject,
    digits: string,
    issues: readonly BatchIssue[],
  ): Reply {
    const parent = this.issueOf(projectId, digits)
    if (parent === null) return failure(404, noSuchIssue(digits, project))
    const reference = (given: BatchIssue['blockedBy'][number], index: number): IssueReference => {
      if ('issue' in given) return { issueId: this.issuesOf(projectId, project, [given.issue])[0]! }
      if (given.item > issues.length) {
        throw new Refusal(
          failure(
            400,
            `Item ${index + 1} names item ${given.item}, and there ${
              issues.length === 1 ? 'is only 1 item' : `are only ${issues.length} items`
            }.`,
          ),
        )
      }
      return { item: given.item - 1 }
    }
    const items = issues.map((issue, index) => {
      // As the new issue dialog creates it, whose title field takes the title on one line.
      const title = oneLineTitle(issue.title)
      if (savedTitle(title) === '') {
        throw new Refusal(failure(400, `Item ${index + 1} has an empty title: an issue needs one.`))
      }
      return {
        projectId,
        title,
        description: issue.description,
        status: issue.status,
        priority: issue.priority ?? parent.priority,
        blockedBy: issue.blockedBy.map((given) => reference(given, index)),
        blocking: issue.blocking.map((given) => reference(given, index)),
      }
    })
    const labelIds = issues.map((issue) => this.labelsNamed(issue.labels))
    let created: Issue[] | null
    try {
      created = this.options.together(() => {
        const saved = this.options.issues.createSubIssues(
          parent.id,
          items,
          (index) => `item ${index + 1}`,
        )
        saved?.forEach((issue, index) => {
          const add = labelIds[index]!
          if (add.length > 0) this.options.labels.changeIssueLabels(issue.id, { add }, 'agent')
        })
        return saved
      })
    } catch (error) {
      return failure(refusal(error), errorMessage(error))
    }
    if (created === null) return failure(404, "The session's project is no longer in Hoot's list.")
    this.reportCreated(created)
    const answer: BatchAnswer = {
      ok: true,
      project,
      issues: created.map((issue) => this.current(projectId, issue)),
    }
    return { status: 201, answer }
  }

  /**
   * Starts a session for an issue of the project, unless work on it cannot
   * be started now, and answers once it has started with the worktree it
   * runs in.
   */
  private async startSession(
    projectId: number,
    project: HootProject,
    request: SessionRequest,
  ): Promise<Reply> {
    const issue = this.issueOf(projectId, request.issue)
    if (issue === null) return failure(404, noSuchIssue(request.issue, project))
    const blockers = this.options.startBlockers(issue)
    if (blockers.length > 0) {
      return failure(
        409,
        [
          `Work on ${issueIdentifier(issue.id)} cannot be started now:`,
          ...blockers.map((blocker) => `- ${startBlockerText(blocker)}`),
        ].join('\n'),
      )
    }
    const started = await this.options.startSession(issue.id, request.prompt ?? null)
    if (!started.ok) return failure(409, started.message)
    const answer: SessionAnswer = { ok: true, project, worktreePath: started.worktreePath }
    return { status: 201, answer }
  }
}

import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { ISSUE_WORKFLOW } from '../../shared/built-in-workflow'
import { waitedOnIds } from '../../shared/dependencies'
import type { HookEventReport } from '../../shared/hoot-cli'
import type { ToolsState } from '../../shared/ipc'
import { issueIdentifier, type Issue } from '../../shared/issues'
import { startBlockers } from '../../shared/start-blockers'
import { databaseFile, transaction } from '../database/database'
import { openTestDatabase } from '../database/test-support'
import { IssueStore } from '../issues/issue-store'
import { LabelStore } from '../labels/label-store'
import { ProjectStore } from '../projects/project-store'
import { WorkflowExecutor } from '../workflows/workflow-executor'
import { HootServer, type StartedSession } from './hoot-server'

/** The tools state once a detection has found Claude Code. */
export const CLAUDE_FOUND: ToolsState = {
  detecting: false,
  tools: [
    { id: 'claude', available: true, path: '/bin/claude' },
    { id: 'shell', available: true, path: '/bin/zsh' },
  ],
  error: null,
}

/**
 * A Hoot for hoot to talk to in tests: its database in a temporary folder,
 * with the projects `gamma` and `hotel`, a session in each, the labels, the
 * executor of the issues' workflow, and the server that answers hoot,
 * listening on a socket in the same folder (see `socketIn`). Sessions it is
 * asked for are started as `setStartSession` says, by default in the worktree
 * `/worktrees/<project>/iss-<n>`, giving the issue the label of the step it
 * starts at as the window does.
 */
export async function startTestHoot() {
  const directory = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-cli-')))
  const db: DatabaseSync = openTestDatabase(databaseFile(directory))
  let clock = Date.UTC(2026, 9, 12, 6, 3)
  const projects = new ProjectStore(db)
  const issues = new IssueStore(db, () => clock)
  const labels = new LabelStore(db, () => clock)
  const workflows = new WorkflowExecutor(db, ISSUE_WORKFLOW, labels, () => clock)
  let tools: ToolsState = CLAUDE_FOUND
  /** The sessions asked for, in order: the issue and the first message given, if any. */
  const startedSessions: Array<{ issueId: number; prompt: string | null }> = []
  let startSession = async (issueId: number): Promise<StartedSession> => {
    const issue = issues.get(issueId)!
    const project = projects.list().find((candidate) => candidate.id === issue.projectId)!
    const start = workflows.sessionStart(issueId, issueIdentifier(issueId))
    if (start.ok) workflows.sessionStarted(issueId, start.step, 'agent')
    return { ok: true, worktreePath: `/worktrees/${project.name}/iss-${issueId}` }
  }
  const gamma = projects.add('/work/gamma').project
  const hotel = projects.add('/work/hotel').project
  /** The project root of each session Hoot knows, by the session's id. */
  const sessions = new Map([
    ['gamma-session', gamma.root],
    ['hotel-session', hotel.root],
  ])
  const created: Issue[] = []
  /** The events of hooks reported, in order, with the session each came from. */
  const hookEvents: Array<{ sessionId: string } & HookEventReport> = []
  const socket = socketIn(directory, 'hoot.sock')
  const server = new HootServer({
    address: socket,
    sessionProject: (sessionId) => {
      const root = sessions.get(sessionId)
      const project = root === undefined ? undefined : projects.find(root)
      return project ? { ok: true, project } : { ok: false, message: 'No such session.' }
    },
    listProjects: () => projects.list(),
    issues,
    labels,
    together: (body) => transaction(db, body),
    issueCreated: (issue) => created.push(issue),
    startBlockers: (issue) =>
      startBlockers(
        tools,
        issue,
        waitedOnIds(
          new Map(issues.list().map((shown) => [shown.id, shown])),
          issues.dependencies().links,
          issue.id,
        ),
        workflows.progress(issue.id),
      ),
    startSession: (issueId, prompt) => {
      startedSessions.push({ issueId, prompt })
      return startSession(issueId)
    },
    hookEvent: (sessionId, report) => hookEvents.push({ sessionId, ...report }),
  })
  await server.start()
  return {
    directory,
    socket,
    server,
    projects,
    issues,
    gamma,
    hotel,
    sessions,
    labels,
    workflows,
    /** The sessions hoot asked for, in order. */
    startedSessions,
    /** Sets what Hoot knows of the tools from now on. */
    setTools(state: ToolsState) {
      tools = state
    },
    /** Sets how the sessions hoot asks for start from now on. */
    setStartSession(start: (issueId: number) => Promise<StartedSession>) {
      startSession = start
    },
    /** The issues the server reported created, in order. */
    created,
    /** The events of hooks the server was told of, in order. */
    hookEvents,
    /** Sets the time the issues record from now on, in milliseconds since the Unix epoch. */
    setClock(time: number) {
      clock = time
    },
    async stop() {
      await server.stop()
      db.close()
      fs.rmSync(directory, { recursive: true, force: true })
    },
  }
}

export type TestHoot = Awaited<ReturnType<typeof startTestHoot>>

/**
 * Where a server of the tests listens: the socket `name` in `directory`; on
 * Windows, where Hoot listens on a named pipe, which is no file, a pipe named
 * after both.
 */
export function socketIn(directory: string, name: string): string {
  if (process.platform !== 'win32') return path.join(directory, name)
  return `\\\\.\\pipe\\${path.basename(directory)}-${name}`
}

/**
 * Leaves a socket at a path as a Hoot that stopped without quitting leaves
 * it: a process listened on it, and was killed. Only outside Windows: a named
 * pipe goes with the last process that listens on it.
 */
export async function leaveSocket(socket: string): Promise<void> {
  const listener = spawn(
    process.execPath,
    [
      '-e',
      'require("node:net").createServer().listen(process.argv[1], () => console.log("ready"))',
      socket,
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  )
  await once(listener.stdout, 'data')
  listener.kill('SIGKILL')
  await once(listener, 'exit')
}

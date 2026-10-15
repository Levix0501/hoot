import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { ISSUE_WORKFLOW } from '../../shared/built-in-workflow'
import type { Issue } from '../../shared/issues'
import { databaseFile, openDatabase } from '../database/database'
import { IssueStore } from '../issues/issue-store'
import { ProjectStore } from '../projects/project-store'
import { WorkflowExecutor } from '../workflows/workflow-executor'
import { HootServer } from './hoot-server'

/**
 * A Hoot for hoot to talk to in tests: its database in a temporary folder,
 * with the projects `gamma` and `hotel`, a session in each, the executor of
 * the issues' workflow, and the server that answers hoot, listening on a
 * socket in the same folder.
 */
export async function startTestHoot() {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-cli-')))
  const db: DatabaseSync = openDatabase(databaseFile(directory))
  let clock = Date.UTC(2026, 9, 12, 6, 3)
  const projects = new ProjectStore(db)
  const issues = new IssueStore(db, () => clock)
  const workflows = new WorkflowExecutor(db, ISSUE_WORKFLOW, () => clock)
  const gamma = projects.add('/work/gamma').project
  const hotel = projects.add('/work/hotel').project
  /** The project root of each session Hoot knows, by the session's id. */
  const sessions = new Map([
    ['gamma-session', gamma.root],
    ['hotel-session', hotel.root],
  ])
  /** The issue each session started from an issue's start button was started from, by its id. */
  const sessionIssues = new Map<string, number>()
  const created: Issue[] = []
  const socket = path.join(directory, 'hoot.sock')
  const server = new HootServer({
    address: socket,
    sessionProject: (sessionId) => {
      const root = sessions.get(sessionId)
      const project = root === undefined ? undefined : projects.find(root)
      return project ? { ok: true, project } : { ok: false, message: 'No such session.' }
    },
    issues,
    issueCreated: (issue) => created.push(issue),
    reportStep: (sessionId, outcome, summary) =>
      workflows.reportFromSession(
        sessionId,
        sessionIssues.get(sessionId) ?? null,
        outcome,
        summary,
      ),
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
    workflows,
    /**
     * Starts a session in a project, by default gamma, as an issue's start
     * button does: the session is started from the issue, and starts work
     * on it.
     */
    startIssueSession(sessionId: string, issueId: number, root: string = gamma.root) {
      sessions.set(sessionId, root)
      sessionIssues.set(sessionId, issueId)
      workflows.sessionStarted(sessionId, issueId)
    },
    /** The issues the server reported created, in order. */
    created,
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
 * Leaves a socket at a path as a Hoot that stopped without quitting leaves
 * it: a process listened on it, and was killed.
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

import { EventEmitter } from 'node:events'
import type { DatabaseSync } from 'node:sqlite'
import type { StepReport } from '../../shared/hoot-cli'
import { issueIdentifier } from '../../shared/issues'
import { stepsFileText, WORKFLOW_FINISHED } from '../../shared/workflow-text'
import {
  firstStep,
  outcomeLabel,
  reportsThisRound,
  stepName,
  stepOutcome,
  workflowProgress,
  workflowStep,
  type StepReporter,
  type WorkflowDefinition,
  type WorkflowProgress,
  type WorkflowRecord,
  type WorkflowStep,
} from '../../shared/workflows'
import { transaction } from '../database/database'

interface RecordRow {
  id: number
  issue_id: number
  kind: WorkflowRecord['kind']
  step: string | null
  outcome: string | null
  reporter: StepReporter | null
  /** The summary's UTF-8 bytes. */
  summary: Uint8Array | null
  at: number
}

/**
 * Text read back exactly as it was saved, from its UTF-8 bytes: some
 * versions of Node's SQLite cut text at its first NUL character when they
 * read it, though they save all of it.
 */
function savedText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
}

function recordFromRow(row: RecordRow): WorkflowRecord {
  switch (row.kind) {
    case 'step-started':
      return { kind: row.kind, id: row.id, step: row.step!, at: row.at }
    case 'step-reported':
      return {
        kind: row.kind,
        id: row.id,
        step: row.step!,
        outcome: row.outcome!,
        summary: row.summary === null ? null : savedText(row.summary),
        reporter: row.reporter!,
        at: row.at,
      }
    case 'started-over':
      return { kind: row.kind, id: row.id, at: row.at }
  }
}

const COLUMNS = 'id, issue_id, kind, step, outcome, reporter, CAST(summary AS BLOB) AS summary, at'
/** The issues Hoot shows: those without a project, and those of the projects in the list. */
const SHOWN_ISSUES = `SELECT id FROM issues WHERE project_id IS NULL OR project_id IN
  (SELECT id FROM projects WHERE list_position IS NOT NULL)`

/** Why `hoot step report` cannot report anything in a session not started from an issue. */
export const NOT_FROM_AN_ISSUE = 'this session was not started from an issue.'

/** What happened to a change to an issue's progress, or why it was not made. */
export type WorkflowChange = { ok: true } | { ok: false; message: string }

/** What an outcome reported from a session recorded, or why it was refused. */
export type StepReportResult = { ok: true; report: StepReport } | { ok: false; message: string }

/**
 * Where a new session started from an issue starts: the step, and the text
 * of the file of what earlier steps found, `null` when there is none to write.
 */
export type SessionStart =
  | { ok: true; step: WorkflowStep; stepsFile: string | null }
  | { ok: false; message: string }

/** A refusal, which leaves the records as they are. */
class Refusal extends Error {}

/** Says that an issue moved on in Hoot since a session's run started, and where it is now. */
function movedOn(identifier: string, now: string): string {
  return (
    `${identifier} was moved on in Hoot; it is now ${now}. ` +
    'Close this session and start the issue again to continue.'
  )
}

/**
 * Runs the issues' workflow as its definition says, whatever the definition:
 * starts a step when a session started from an issue starts, records the
 * outcomes the agents report with `hoot step report` and the user picks in
 * Hoot, starting the step each leads to or finishing the workflow, and starts
 * the workflow over. It keeps the records in the database, and knows which
 * run of a step each session started from an issue is in, so that it refuses
 * a report of a session whose issue was moved on since. It says when an
 * issue's records change.
 */
export class WorkflowExecutor extends EventEmitter<{
  changed: [issueId: number, records: WorkflowRecord[]]
}> {
  private readonly statements
  /**
   * The run of a step each session started from an issue is in, by the
   * session's id; `null` once it is in none, as when the workflow is finished.
   */
  private readonly sessionRuns = new Map<string, number | null>()

  constructor(
    private readonly db: DatabaseSync,
    private readonly workflow: WorkflowDefinition,
    /** The time to record, in milliseconds since the Unix epoch. */
    private readonly now: () => number = Date.now,
  ) {
    super()
    this.statements = {
      records: db.prepare(`SELECT ${COLUMNS} FROM workflow_records WHERE issue_id = ? ORDER BY id`),
      shown: db.prepare(
        `SELECT ${COLUMNS} FROM workflow_records WHERE issue_id IN (${SHOWN_ISSUES}) ORDER BY id`,
      ),
      issue: db.prepare('SELECT id FROM issues WHERE id = ?'),
      insert: db.prepare(
        `INSERT INTO workflow_records (issue_id, kind, step, outcome, reporter, summary, at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ),
    }
  }

  /** An issue's records, in the order they were made. */
  records(issueId: number): WorkflowRecord[] {
    return (this.statements.records.all(issueId) as unknown as RecordRow[]).map(recordFromRow)
  }

  /** The records of the issues Hoot shows, by issue; an issue without any is left out. */
  listShown(): Record<number, WorkflowRecord[]> {
    const records: Record<number, WorkflowRecord[]> = {}
    for (const row of this.statements.shown.all() as unknown as RecordRow[]) {
      ;(records[row.issue_id] ??= []).push(recordFromRow(row))
    }
    return records
  }

  /**
   * Where a new session started from the issue starts: at the first step
   * when the issue has not started, or at the step it is at. With it, the
   * file of what earlier steps found, when an outcome reported since the
   * issue last started over has a summary. Refused when the workflow is
   * finished.
   */
  sessionStart(issueId: number): SessionStart {
    const records = this.records(issueId)
    const progress = workflowProgress(records)
    if (progress.kind === 'finished') return { ok: false, message: WORKFLOW_FINISHED }
    const id = progress.kind === 'not-started' ? firstStep(this.workflow).id : progress.step
    const step = workflowStep(this.workflow, id)
    if (step === undefined) {
      return { ok: false, message: `The workflow has no step "${id}" any more.` }
    }
    const reports = reportsThisRound(records)
    const stepsFile = reports.some((report) => report.summary !== null)
      ? stepsFileText(
          reports.map((report) => ({
            step: stepName(this.workflow, report.step),
            outcome: outcomeLabel(this.workflow, report.step, report.outcome),
            summary: report.summary,
          })),
        )
      : null
    return { ok: true, step, stepsFile }
  }

  /**
   * A session started from the issue's start button has started. An issue
   * not started starts its first step now; the session is in that run, or
   * in the run of the step the issue is at.
   */
  sessionStarted(sessionId: string, issueId: number): void {
    let started = false
    const run = transaction(this.db, () => {
      if (!this.exists(issueId)) return null
      const progress = workflowProgress(this.records(issueId))
      switch (progress.kind) {
        case 'at-step':
          return progress.run
        case 'finished':
          return null
        case 'not-started':
          started = true
          return this.insertStart(issueId, firstStep(this.workflow), this.now())
      }
    })
    this.sessionRuns.set(sessionId, run)
    if (started) this.emitChanged(issueId)
  }

  /** Forgets a session that is closed. */
  forgetSession(sessionId: string): void {
    this.sessionRuns.delete(sessionId)
  }

  /**
   * Records the outcome the agent of a session started from an issue
   * reports, with its summary, for the run of a step the session is in:
   * the step the outcome leads to starts, or the workflow is finished. The
   * session is in the new run from then on. Refused, recording nothing, for
   * a session started from no issue (`issueId` is `null`), an issue that no
   * longer exists, a finished workflow, a session whose run is no longer the
   * issue's current one, and an outcome the step does not have.
   */
  reportFromSession(
    sessionId: string,
    issueId: number | null,
    outcome: string,
    summary: string,
  ): StepReportResult {
    if (issueId === null) return { ok: false, message: NOT_FROM_AN_ISSUE }
    const identifier = issueIdentifier(issueId)
    const result = this.change(() => {
      if (!this.exists(issueId)) throw new Refusal(`${identifier} no longer exists in Hoot.`)
      const progress = workflowProgress(this.records(issueId))
      if (progress.kind === 'finished') {
        throw new Refusal(
          `The workflow for ${identifier} is finished; there is no step left to report.`,
        )
      }
      if (progress.kind === 'not-started') throw new Refusal(movedOn(identifier, 'Not started'))
      if (this.sessionRuns.get(sessionId) !== progress.run) {
        throw new Refusal(movedOn(identifier, `at ${stepName(this.workflow, progress.step)}`))
      }
      return this.report(issueId, progress, outcome, 'agent', summary)
    })
    if (!result.ok) return result
    this.sessionRuns.set(sessionId, result.value.nextRun)
    this.emitChanged(issueId)
    return { ok: true, report: result.value.report }
  }

  /**
   * Records an outcome the user picked in Hoot for the run of a step `run`,
   * without a summary: the step the outcome leads to starts, or the workflow
   * is finished. Refused when that run is no longer the issue's current one,
   * or the step has no such outcome.
   */
  reportByUser(issueId: number, run: number, outcome: string): WorkflowChange {
    const result = this.change(() => {
      if (!this.exists(issueId)) throw new Refusal('The issue no longer exists.')
      const progress = workflowProgress(this.records(issueId))
      if (progress.kind !== 'at-step' || progress.run !== run) {
        throw new Refusal(`${issueIdentifier(issueId)} has moved on to another step meanwhile.`)
      }
      return this.report(issueId, progress, outcome, 'user', null)
    })
    if (!result.ok) return result
    this.emitChanged(issueId)
    return { ok: true }
  }

  /**
   * Starts the issue's workflow over: it is not started again, and keeps its
   * records. Refused for an issue that has not started.
   */
  startOver(issueId: number): WorkflowChange {
    const result = this.change(() => {
      if (!this.exists(issueId)) throw new Refusal('The issue no longer exists.')
      if (workflowProgress(this.records(issueId)).kind === 'not-started') {
        throw new Refusal(`${issueIdentifier(issueId)} has not started.`)
      }
      this.insert(issueId, 'started-over', null, null, null, null, this.now())
    })
    if (!result.ok) return result
    this.emitChanged(issueId)
    return { ok: true }
  }

  /** Runs a change in a transaction; a refusal rolls it back and says why. */
  private change<T>(body: () => T): { ok: true; value: T } | { ok: false; message: string } {
    try {
      return { ok: true, value: transaction(this.db, body) }
    } catch (error) {
      if (error instanceof Refusal) return { ok: false, message: error.message }
      throw error
    }
  }

  /**
   * Records an outcome of the current run of the step the issue is at, and
   * the run of the step it leads to, which starts at the same time.
   */
  private report(
    issueId: number,
    progress: Extract<WorkflowProgress, { kind: 'at-step' }>,
    name: string,
    reporter: StepReporter,
    summary: string | null,
  ): { report: StepReport; nextRun: number | null } {
    const step = workflowStep(this.workflow, progress.step)
    if (step === undefined) {
      throw new Refusal(`The workflow has no step "${progress.step}" any more.`)
    }
    const outcome = stepOutcome(step, name)
    if (outcome === undefined) {
      throw new Refusal(
        `${name} is not an outcome of ${step.name}.\n` +
          `Outcomes: ${step.outcomes.map((candidate) => candidate.name).join(', ')}`,
      )
    }
    const at = this.now()
    this.insert(issueId, 'step-reported', step.id, outcome.name, reporter, summary, at)
    const next = outcome.next === null ? null : (workflowStep(this.workflow, outcome.next) ?? null)
    const nextRun = next === null ? null : this.insertStart(issueId, next, at)
    return {
      report: { issue: issueIdentifier(issueId), step: step.name, outcome: outcome.label, next },
      nextRun,
    }
  }

  /** Records that a run of a step started, and returns its id. */
  private insertStart(issueId: number, step: WorkflowStep, at: number): number {
    return this.insert(issueId, 'step-started', step.id, null, null, null, at)
  }

  private insert(
    issueId: number,
    kind: WorkflowRecord['kind'],
    step: string | null,
    outcome: string | null,
    reporter: StepReporter | null,
    summary: string | null,
    at: number,
  ): number {
    const { lastInsertRowid } = this.statements.insert.run(
      issueId,
      kind,
      step,
      outcome,
      reporter,
      summary,
      at,
    )
    return Number(lastInsertRowid)
  }

  /** Whether the issue exists, whichever project it is in. */
  private exists(issueId: number): boolean {
    return this.statements.issue.get(issueId) !== undefined
  }

  private emitChanged(issueId: number): void {
    this.emit('changed', issueId, this.records(issueId))
  }
}

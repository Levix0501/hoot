import { EventEmitter } from 'node:events'
import type { DatabaseSync } from 'node:sqlite'
import { isCompleted, type Issue, type IssuePriority, type IssueStatus } from '../../shared/issues'
import type { LabelActor } from '../../shared/labels'
import { firstMessage, goesOn, workflowFileText } from '../../shared/workflow-text'
import {
  firstStep,
  workflowLabels,
  workflowProgress,
  type WorkflowDefinition,
  type WorkflowProgress,
  type WorkflowStep,
} from '../../shared/workflows'
import { observeTransactions } from '../database/database'
import { LabelError, type LabelStore } from '../labels/label-store'

/** The files of a session started from an issue, and the branch of its worktree. */
export interface SessionFiles {
  /** The absolute path of the issue's file. */
  issueFile: string
  /** The absolute path of the workflow's file, which is there when the session has one. */
  workflowFile: string
  branch: string
}

/**
 * How a new session started from an issue starts: at a step, with the text
 * of the workflow's file and the first message, once the files are written;
 * or why it cannot start, as when the workflow is finished.
 */
export type SessionStart =
  | {
      ok: true
      step: WorkflowStep
      /** `null` when the session needs no file of the workflow: when it cannot go on from its step. */
      workflowFile: string | null
      firstMessage(files: SessionFiles): string
    }
  | { ok: false; message: string }

interface IssueRow {
  id: number
  project_id: number | null
  title: string
  description: string
  status: IssueStatus
  priority: IssuePriority
  created_at: number
  completed_at: number | null
}

/** A sub-issue Hoot shows: one without a project, or of a project in the list. */
const SHOWN_CHILD = `(c.project_id IS NULL OR c.project_id IN
  (SELECT id FROM projects WHERE list_position IS NOT NULL))`

/**
 * Runs the issues' workflow as its definition says, whatever the
 * definition: puts the workflow's group of labels in place; tells where an
 * issue is in the workflow by the label of the group it carries; says how a
 * session started from an issue starts, with the file of the workflow and
 * the first message, and gives an issue not started, or ready for the step,
 * the label of the step once its session has started; and completes an
 * issue carrying an end label that says so once its sub-issues are
 * completed. It says which issues it completed, once the change that made it
 * do so is saved.
 */
export class WorkflowExecutor extends EventEmitter<{ 'issues-completed': [issues: Issue[]] }> {
  private readonly statements
  private readonly groupId: number
  /** The ids of the workflow's labels, by their names in the workflow. */
  private readonly labelIds: Map<string, number>
  /** The ids of the end labels that complete an issue once its sub-issues are. */
  private readonly completing: number[]
  /** The issues the condition held for when the transaction under way began. */
  private heldBefore = new Set<number>()
  /** The issues completed in the transaction under way. */
  private completedNow: number[] = []

  constructor(
    db: DatabaseSync,
    private readonly workflow: WorkflowDefinition,
    private readonly labels: LabelStore,
    /** The time to record, in milliseconds since the Unix epoch. */
    private readonly now: () => number = Date.now,
  ) {
    super()
    const { groupId, labelIds } = labels.ensureWorkflowGroup(
      workflow.name,
      workflow.group,
      workflowLabels(workflow),
    )
    this.groupId = groupId
    this.labelIds = labelIds
    this.completing = workflow.endLabels
      .filter((end) => end.completeWithSubIssues)
      .map((end) => labelIds.get(end.name)!)
    this.statements = {
      held: db.prepare(
        `SELECT p.id AS id, p.status AS status,
           EXISTS (SELECT 1 FROM sub_issues s JOIN issues c ON c.id = s.issue_id
                   WHERE s.parent_id = p.id AND c.status = 'done' AND ${SHOWN_CHILD}) AS any_done
         FROM issues p
         WHERE EXISTS (SELECT 1 FROM issue_labels l
                       WHERE l.issue_id = p.id AND l.label_id IN (SELECT value FROM json_each(?)))
           AND EXISTS (SELECT 1 FROM sub_issues s JOIN issues c ON c.id = s.issue_id
                       WHERE s.parent_id = p.id AND ${SHOWN_CHILD})
           AND NOT EXISTS (SELECT 1 FROM sub_issues s JOIN issues c ON c.id = s.issue_id
                           WHERE s.parent_id = p.id AND ${SHOWN_CHILD}
                             AND c.status NOT IN ('done', 'canceled'))`,
      ),
      complete: db.prepare('UPDATE issues SET status = ?, completed_at = ? WHERE id = ?'),
      issue: db.prepare(
        `SELECT id, project_id, title, description, status, priority, created_at, completed_at
         FROM issues WHERE id = ?`,
      ),
    }
    // Every change, wherever it comes from, may complete issues.
    observeTransactions(db, {
      begin: () => {
        this.heldBefore = new Set(this.held().map((row) => row.id))
        this.completedNow = []
      },
      beforeCommit: () => this.completeIssues(),
      end: (committed) => {
        const completed = this.completedNow
        this.completedNow = []
        this.heldBefore = new Set()
        if (!committed || completed.length === 0) return
        this.emit(
          'issues-completed',
          completed.flatMap((id) => {
            const row = this.statements.issue.get(id) as IssueRow | undefined
            return row ? [issueFromRow(row)] : []
          }),
        )
      },
    })
  }

  /** Where an issue is in the workflow: by the label of the workflow's group it carries. */
  progress(issueId: number): WorkflowProgress {
    return workflowProgress(
      this.workflow,
      this.labels
        .labelsOf(issueId)
        .filter((label) => label.groupId === this.groupId)
        .map((label) => label.name),
    )
  }

  /**
   * How a new session started from the issue starts: at the step the issue
   * is ready for or at, or at the first step when it has not started;
   * refused once its workflow is finished. `identifier` is the issue's, such
   * as `ISS-12`.
   */
  sessionStart(issueId: number, identifier: string): SessionStart {
    const progress = this.progress(issueId)
    if (progress.kind === 'finished') {
      return {
        ok: false,
        message: `The workflow of ${identifier} is finished: it has the label "${progress.label.name}".`,
      }
    }
    const step = progress.kind === 'not-started' ? firstStep(this.workflow) : progress.step
    return {
      ok: true,
      step,
      workflowFile: goesOn(step) ? workflowFileText(this.workflow, identifier) : null,
      firstMessage: (files) =>
        firstMessage({ workflow: this.workflow, identifier, step, ...files }),
    }
  }

  /**
   * A session started from the issue at `step` has started, opened by
   * `actor`: an issue still waiting for it, not started when `step` is the
   * first step or ready for `step`, is given the step's label. One whose
   * label was changed meanwhile keeps it.
   */
  sessionStarted(issueId: number, step: WorkflowStep, actor: LabelActor): void {
    const progress = this.progress(issueId)
    const waiting =
      progress.kind === 'not-started'
        ? firstStep(this.workflow).name === step.name
        : progress.kind === 'ready' && progress.step.name === step.name
    if (!waiting) return
    const label = this.labelIds.get(step.label.name)!
    try {
      this.labels.changeIssueLabels(issueId, { add: [label] }, actor)
    } catch (error) {
      // Deleted meanwhile.
      if (!(error instanceof LabelError)) throw error
    }
  }

  /** The issues the condition of completing holds for now, with their status. */
  private held(): Array<{ id: number; status: IssueStatus; any_done: number }> {
    if (this.completing.length === 0) return []
    return this.statements.held.all(JSON.stringify(this.completing)) as unknown as Array<{
      id: number
      status: IssueStatus
      any_done: number
    }>
  }

  /**
   * Completes each issue neither done nor canceled for which the condition
   * of completing came to hold in the transaction under way: it carries an
   * end label that says so, it has at least one sub-issue Hoot shows, and
   * each of them is done or canceled. It becomes done when one of them is
   * done, canceled otherwise. One completed may complete its parent in turn.
   */
  private completeIssues(): void {
    for (;;) {
      const newly = this.held().filter(
        (row) =>
          !this.heldBefore.has(row.id) &&
          !this.completedNow.includes(row.id) &&
          !isCompleted(row.status),
      )
      if (newly.length === 0) return
      const at = this.now()
      for (const row of newly) {
        this.statements.complete.run(row.any_done ? 'done' : 'canceled', at, row.id)
        this.completedNow.push(row.id)
      }
    }
  }
}

function issueFromRow(row: IssueRow): Issue {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }
}

import type { DatabaseSync } from 'node:sqlite'
import {
  isCompleted,
  issueTitle,
  type Issue,
  type IssueChanges,
  type IssuePriority,
  type IssueStatus,
  type NewIssue,
} from '../../shared/issues'
import { transaction } from '../database/database'

interface IssueRow {
  id: number
  project_id: number
  number: number
  title: string
  description: string
  status: IssueStatus
  priority: IssuePriority
  created_at: number
  completed_at: number | null
}

function issueFromRow(row: IssueRow): Issue {
  return {
    id: row.id,
    projectId: row.project_id,
    number: row.number,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }
}

const COLUMNS =
  'id, project_id, number, title, description, status, priority, created_at, completed_at'
/** Limits a statement to the issues of the projects in the list. */
const LISTED = 'project_id IN (SELECT id FROM projects WHERE list_position IS NOT NULL)'

/** The title to save, or an error when nothing but whitespace was entered. */
function savedTitle(entered: string): string {
  const title = issueTitle(entered)
  if (title === '') throw new Error('An issue needs a title.')
  return title
}

/**
 * The issues of the projects, kept in the database. Only the issues of the
 * projects in the list can be read or changed; those of a removed project
 * stay in the database until it is added again.
 */
export class IssueStore {
  private readonly statements

  constructor(
    private readonly db: DatabaseSync,
    /** The time to record, in milliseconds since the Unix epoch. */
    private readonly now: () => number = Date.now,
  ) {
    this.statements = {
      list: db.prepare(
        `SELECT ${COLUMNS} FROM issues WHERE project_id = ? AND ${LISTED} ORDER BY id`,
      ),
      get: db.prepare(`SELECT ${COLUMNS} FROM issues WHERE id = ? AND ${LISTED}`),
      byNumber: db.prepare(
        `SELECT ${COLUMNS} FROM issues WHERE project_id = ? AND number = ? AND ${LISTED}`,
      ),
      nextNumber: db.prepare(
        'SELECT next_issue_number FROM projects WHERE id = ? AND list_position IS NOT NULL',
      ),
      takeNumber: db.prepare(
        'UPDATE projects SET next_issue_number = next_issue_number + 1 WHERE id = ?',
      ),
      insert: db.prepare(
        `INSERT INTO issues
           (project_id, number, title, description, status, priority, created_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      update: db.prepare(
        `UPDATE issues SET title = ?, description = ?, status = ?, priority = ?, completed_at = ?
         WHERE id = ? AND ${LISTED}`,
      ),
      delete: db.prepare(`DELETE FROM issues WHERE id = ? AND ${LISTED}`),
    }
  }

  /** The issues of a project in the list, in the order they were created. */
  list(projectId: number): Issue[] {
    return (this.statements.list.all(projectId) as unknown as IssueRow[]).map(issueFromRow)
  }

  get(id: number): Issue | null {
    const row = this.statements.get.get(id) as IssueRow | undefined
    return row ? issueFromRow(row) : null
  }

  /** The issue with this number in a project in the list, if any. */
  byNumber(projectId: number, number: number): Issue | null {
    const row = this.statements.byNumber.get(projectId, number) as IssueRow | undefined
    return row ? issueFromRow(row) : null
  }

  /**
   * Creates an issue in a project in the list, created now, with the
   * project's next number; `null` when the project is not in the list.
   * Throws when the title is empty.
   */
  create(issue: NewIssue): Issue | null {
    const title = savedTitle(issue.title)
    return transaction(this.db, () => {
      const project = this.statements.nextNumber.get(issue.projectId) as
        | { next_issue_number: number }
        | undefined
      if (!project) return null
      this.statements.takeNumber.run(issue.projectId)
      const now = this.now()
      const { lastInsertRowid } = this.statements.insert.run(
        issue.projectId,
        project.next_issue_number,
        title,
        issue.description,
        issue.status,
        issue.priority,
        now,
        isCompleted(issue.status) ? now : null,
      )
      return this.get(Number(lastInsertRowid))
    })
  }

  /**
   * Changes what `changes` gives of an issue; `null` when there is no such
   * issue. A new status that is done or canceled records when; any other
   * clears it. Throws when the title is empty.
   */
  update(id: number, changes: IssueChanges): Issue | null {
    const title = changes.title === undefined ? undefined : savedTitle(changes.title)
    return transaction(this.db, () => {
      const issue = this.get(id)
      if (!issue) return null
      const status = changes.status ?? issue.status
      let completedAt = issue.completedAt
      if (status !== issue.status) completedAt = isCompleted(status) ? this.now() : null
      this.statements.update.run(
        title ?? issue.title,
        changes.description ?? issue.description,
        status,
        changes.priority ?? issue.priority,
        completedAt,
        id,
      )
      return this.get(id)
    })
  }

  /** Deletes an issue for good; false when there is no such issue. */
  delete(id: number): boolean {
    return this.statements.delete.run(id).changes > 0
  }
}

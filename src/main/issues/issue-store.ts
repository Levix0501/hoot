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
  project_id: number | null
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
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }
}

const COLUMNS = 'id, project_id, title, description, status, priority, created_at, completed_at'
/** The projects in the list. */
const LISTED_PROJECTS = 'SELECT id FROM projects WHERE list_position IS NOT NULL'
/** Limits a statement to the issues Hoot shows: those without a project, and those of the projects in the list. */
const SHOWN = `(project_id IS NULL OR project_id IN (${LISTED_PROJECTS}))`

/** The title to save, or an error when nothing but whitespace was entered. */
function savedTitle(entered: string): string {
  const title = issueTitle(entered)
  if (title === '') throw new Error('An issue needs a title.')
  return title
}

/**
 * The issues, kept in the database: those without a project, and those of the
 * projects. Only the issues without a project and those of the projects in
 * the list can be read or changed; those of a removed project stay in the
 * database until it is added again.
 */
export class IssueStore {
  private readonly statements

  constructor(
    private readonly db: DatabaseSync,
    /** The time to record, in milliseconds since the Unix epoch. */
    private readonly now: () => number = Date.now,
  ) {
    this.statements = {
      list: db.prepare(`SELECT ${COLUMNS} FROM issues WHERE ${SHOWN} ORDER BY id`),
      listInProject: db.prepare(
        `SELECT ${COLUMNS} FROM issues WHERE project_id = ? AND ${SHOWN} ORDER BY id`,
      ),
      get: db.prepare(`SELECT ${COLUMNS} FROM issues WHERE id = ? AND ${SHOWN}`),
      getInProject: db.prepare(
        `SELECT ${COLUMNS} FROM issues WHERE id = ? AND project_id = ? AND ${SHOWN}`,
      ),
      listedProject: db.prepare(
        'SELECT id FROM projects WHERE id = ? AND list_position IS NOT NULL',
      ),
      insert: db.prepare(
        `INSERT INTO issues
           (project_id, title, description, status, priority, created_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ),
      update: db.prepare(
        `UPDATE issues SET project_id = ?, title = ?, description = ?, status = ?, priority = ?,
           completed_at = ?
         WHERE id = ? AND ${SHOWN}`,
      ),
      delete: db.prepare(`DELETE FROM issues WHERE id = ? AND ${SHOWN}`),
    }
  }

  /**
   * The issues without a project and those of the projects in the list, in
   * the order they were created.
   */
  list(): Issue[] {
    return (this.statements.list.all() as unknown as IssueRow[]).map(issueFromRow)
  }

  get(id: number): Issue | null {
    const row = this.statements.get.get(id) as IssueRow | undefined
    return row ? issueFromRow(row) : null
  }

  /** The issues of a project in the list, in the order they were created; none for any other project. */
  listInProject(projectId: number): Issue[] {
    return (this.statements.listInProject.all(projectId) as unknown as IssueRow[]).map(issueFromRow)
  }

  /** The issue with this id, if it belongs to this project and the project is in the list. */
  getInProject(projectId: number, id: number): Issue | null {
    const row = this.statements.getInProject.get(id, projectId) as IssueRow | undefined
    return row ? issueFromRow(row) : null
  }

  /**
   * Creates an issue, created now, with the next number: in a project in the
   * list, or in none. `null` when the project is not in the list. Throws when
   * the title is empty.
   */
  create(issue: NewIssue): Issue | null {
    const title = savedTitle(issue.title)
    return transaction(this.db, () => {
      if (issue.projectId !== null && !this.isListed(issue.projectId)) return null
      const now = this.now()
      const { lastInsertRowid } = this.statements.insert.run(
        issue.projectId,
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
   * clears it. Throws when the title is empty, or the project is not in the
   * list.
   */
  update(id: number, changes: IssueChanges): Issue | null {
    const title = changes.title === undefined ? undefined : savedTitle(changes.title)
    return transaction(this.db, () => {
      const issue = this.get(id)
      if (!issue) return null
      const projectId = changes.projectId === undefined ? issue.projectId : changes.projectId
      if (projectId !== null && !this.isListed(projectId)) {
        throw new Error('The project is not in the list.')
      }
      const status = changes.status ?? issue.status
      let completedAt = issue.completedAt
      if (status !== issue.status) completedAt = isCompleted(status) ? this.now() : null
      this.statements.update.run(
        projectId,
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

  /** Whether a project is in the list. */
  private isListed(projectId: number): boolean {
    return this.statements.listedProject.get(projectId) !== undefined
  }
}

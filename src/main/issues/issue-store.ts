import type { DatabaseSync } from 'node:sqlite'
import {
  issueTitle,
  type Issue,
  type IssueChanges,
  type IssueState,
  type NewIssue,
} from '../../shared/issues'
import { transaction } from '../database/database'

interface IssueRow {
  id: number
  project_id: number
  title: string
  description: string
  state: IssueState
  created_at: number
  closed_at: number | null
}

function issueFromRow(row: IssueRow): Issue {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    state: row.state,
    createdAt: row.created_at,
    closedAt: row.closed_at,
  }
}

const COLUMNS = 'id, project_id, title, description, state, created_at, closed_at'
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
      listedProject: db.prepare(
        'SELECT 1 FROM projects WHERE id = ? AND list_position IS NOT NULL',
      ),
      insert: db.prepare(
        `INSERT INTO issues (project_id, title, description, state, created_at)
         VALUES (?, ?, ?, 'open', ?)`,
      ),
      update: db.prepare(`UPDATE issues SET title = ?, description = ? WHERE id = ? AND ${LISTED}`),
      close: db.prepare(
        `UPDATE issues SET state = 'closed', closed_at = ? WHERE id = ? AND state = 'open' AND ${LISTED}`,
      ),
      reopen: db.prepare(`UPDATE issues SET state = 'open' WHERE id = ? AND ${LISTED}`),
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

  /**
   * Creates an open issue in a project in the list, created now; `null` when
   * the project is not in the list. Throws when the title is empty.
   */
  create(issue: NewIssue): Issue | null {
    const title = savedTitle(issue.title)
    return transaction(this.db, () => {
      if (!this.statements.listedProject.get(issue.projectId)) return null
      const { lastInsertRowid } = this.statements.insert.run(
        issue.projectId,
        title,
        issue.description,
        this.now(),
      )
      return this.get(Number(lastInsertRowid))
    })
  }

  /** Changes an issue's title and description; `null` when there is no such issue. */
  update(id: number, changes: IssueChanges): Issue | null {
    const title = savedTitle(changes.title)
    return transaction(this.db, () => {
      this.statements.update.run(title, changes.description, id)
      return this.get(id)
    })
  }

  /**
   * Closes an open issue, recording when, or opens a closed one again;
   * `null` when there is no such issue. Nothing else about it changes.
   */
  setState(id: number, state: IssueState): Issue | null {
    return transaction(this.db, () => {
      if (state === 'closed') this.statements.close.run(this.now(), id)
      else this.statements.reopen.run(id)
      return this.get(id)
    })
  }

  /** Deletes an issue for good; false when there is no such issue. */
  delete(id: number): boolean {
    return this.statements.delete.run(id).changes > 0
  }
}

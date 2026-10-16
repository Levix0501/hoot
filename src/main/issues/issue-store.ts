import { EventEmitter } from 'node:events'
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
import {
  newSubIssueProblem,
  parentOf,
  subIssueProblem,
  withParents,
  type ParentChange,
  type SubIssueLink,
  type SubIssues,
} from '../../shared/sub-issues'
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

/** Why issues cannot get the parents asked for: it would break the rules of sub-issues. */
export class SubIssueError extends Error {}

/** The title to save, or an error when nothing but whitespace was entered. */
function savedTitle(entered: string): string {
  const title = issueTitle(entered)
  if (title === '') throw new Error('An issue needs a title.')
  return title
}

/**
 * The issues, kept in the database: those without a project, and those of the
 * projects, with the parent of each sub-issue. Only the issues without a
 * project and those of the projects in the list can be read or changed; those
 * of a removed project stay in the database until it is added again, and so
 * do their parents and sub-issues. It says when the parents of issues change,
 * also when an issue with a parent or sub-issues is deleted.
 */
export class IssueStore extends EventEmitter<{ 'sub-issues-changed': [subIssues: SubIssues] }> {
  private readonly statements
  /** Grows with every change of the parents of issues. */
  private subIssueVersion = 0

  constructor(
    private readonly db: DatabaseSync,
    /** The time to record, in milliseconds since the Unix epoch. */
    private readonly now: () => number = Date.now,
  ) {
    super()
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
      links: db.prepare('SELECT issue_id, parent_id FROM sub_issues ORDER BY id'),
      linked: db.prepare('SELECT 1 FROM sub_issues WHERE issue_id = ? OR parent_id = ? LIMIT 1'),
      link: db.prepare('INSERT INTO sub_issues (issue_id, parent_id) VALUES (?, ?)'),
      unlink: db.prepare('DELETE FROM sub_issues WHERE issue_id = ?'),
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
   * list, or in none; and with a parent, after the parent's other
   * sub-issues. `null` when the project is not in the list. Throws when the
   * title is empty, when there is no such parent, and with a `SubIssueError`
   * when the parent cannot have another sub-issue.
   */
  create(issue: NewIssue, parentId: number | null = null): Issue | null {
    const title = savedTitle(issue.title)
    const created = transaction(this.db, () => {
      if (issue.projectId !== null && !this.isListed(issue.projectId)) return null
      if (parentId !== null) {
        if (this.get(parentId) === null) throw new Error('The parent issue no longer exists.')
        const problem = newSubIssueProblem(this.links(), parentId)
        if (problem !== null) throw new SubIssueError(problem)
      }
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
      const id = Number(lastInsertRowid)
      if (parentId !== null) this.statements.link.run(id, parentId)
      return this.get(id)
    })
    if (created !== null && parentId !== null) this.subIssuesChanged()
    return created
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

  /**
   * Deletes an issue for good; false when there is no such issue. Its
   * sub-issues, also those of removed projects, become top-level issues.
   */
  delete(id: number): boolean {
    const linked = this.statements.linked.get(id, id) !== undefined
    const deleted = this.statements.delete.run(id).changes > 0
    if (deleted && linked) this.subIssuesChanged()
    return deleted
  }

  /** The parent of every issue that has one, those of removed projects included. */
  subIssues(): SubIssues {
    return { version: this.subIssueVersion, links: this.links() }
  }

  /**
   * Gives issues other parents, or none, one after another and all together:
   * an issue that gets another parent goes after that parent's other
   * sub-issues. Throws, changing nothing, when an issue or a parent is not
   * one that can be read, and with a `SubIssueError` when the changes would
   * break the rules of sub-issues.
   */
  setParents(changes: readonly ParentChange[]): void {
    const changed = transaction(this.db, () => {
      for (const { issueId, parentId } of changes) {
        for (const id of parentId === null ? [issueId] : [issueId, parentId]) {
          if (this.get(id) === null) throw new Error('The issue no longer exists.')
        }
      }
      const links = this.links()
      const problem = subIssueProblem(
        withParents(links, changes),
        changes.map((change) => change.issueId),
      )
      if (problem !== null) throw new SubIssueError(problem)
      let current = links
      for (const change of changes) {
        if (parentOf(current, change.issueId) === change.parentId) continue
        current = withParents(current, [change])
        this.statements.unlink.run(change.issueId)
        if (change.parentId !== null) this.statements.link.run(change.issueId, change.parentId)
      }
      return current !== links
    })
    if (changed) this.subIssuesChanged()
  }

  private links(): SubIssueLink[] {
    return (
      this.statements.links.all() as unknown as Array<{ issue_id: number; parent_id: number }>
    ).map((row) => ({ issueId: row.issue_id, parentId: row.parent_id }))
  }

  private subIssuesChanged(): void {
    this.subIssueVersion++
    this.emit('sub-issues-changed', this.subIssues())
  }

  /** Whether a project is in the list. */
  private isListed(projectId: number): boolean {
    return this.statements.listedProject.get(projectId) !== undefined
  }
}

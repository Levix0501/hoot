import { EventEmitter } from 'node:events'
import type { DatabaseSync } from 'node:sqlite'
import {
  dependencyProblem,
  hasDependency,
  withDependencies,
  type Dependencies,
  type Dependency,
} from '../../shared/dependencies'
import {
  isCompleted,
  issueIdentifier,
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

/** How an issue Hoot does not show, as one of a removed project, is named in a reason. */
const UNSHOWN_ISSUE = 'an issue Hoot does not show'

/** Why issues cannot get the parents asked for: it would break the rules of sub-issues. */
export class SubIssueError extends Error {}

/**
 * Why dependencies cannot be made or removed as asked: one is there already,
 * or not there, or they would break the rules of dependencies.
 */
export class DependencyError extends Error {}

/** Until they are saved, new issues go by -1, -2 and on, which no issue has, by their place from 0. */
const placeholder = (index: number) => -(index + 1)
/** The place of a new issue, from 0, by the id it goes by until it is saved. */
const placeOf = (id: number) => -id - 1

/** The title to save, or an error when nothing but whitespace was entered. */
function savedTitle(entered: string): string {
  const title = issueTitle(entered)
  if (title === '') throw new Error('An issue needs a title.')
  return title
}

/** The issues a new issue is to be blocked by, and those it is to block, by their ids. */
export interface NewIssueDependencies {
  blockedBy?: readonly number[]
  blocking?: readonly number[]
}

/**
 * An issue among those created together, by its place among them from 0, or
 * an issue there is, by its id.
 */
export type IssueReference = { item: number } | { issueId: number }

/** One of the sub-issues created together, with the issues it is to be blocked by and to block. */
export interface NewSubIssue extends NewIssue {
  blockedBy: readonly IssueReference[]
  blocking: readonly IssueReference[]
}

/**
 * Changes to the parents and dependencies of issues, made together: issues
 * given other parents, or none, one after another; dependencies removed; and
 * dependencies made.
 */
export interface RelationChange {
  parents?: readonly ParentChange[]
  removeDependencies?: readonly Dependency[]
  addDependencies?: readonly Dependency[]
}

/**
 * The issues, kept in the database: those without a project, and those of the
 * projects, with the parent of each sub-issue and the issues each is blocked
 * by. Only the issues without a project and those of the projects in the list
 * can be read or changed; those of a removed project stay in the database
 * until it is added again, and so do their parents, sub-issues and
 * dependencies. It says when the parents of issues change, and when their
 * dependencies do, also when an issue with any is deleted.
 */
export class IssueStore extends EventEmitter<{
  'sub-issues-changed': [subIssues: SubIssues]
  'dependencies-changed': [dependencies: Dependencies]
}> {
  private readonly statements
  /** Grows with every change of the parents of issues. */
  private subIssueVersion = 0
  /** Grows with every change of the dependencies. */
  private dependencyVersion = 0

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
      dependencies: db.prepare(
        'SELECT issue_id, blocked_by_id FROM issue_dependencies ORDER BY id',
      ),
      dependent: db.prepare(
        'SELECT 1 FROM issue_dependencies WHERE issue_id = ? OR blocked_by_id = ? LIMIT 1',
      ),
      depend: db.prepare('INSERT INTO issue_dependencies (issue_id, blocked_by_id) VALUES (?, ?)'),
      undepend: db.prepare(
        'DELETE FROM issue_dependencies WHERE issue_id = ? AND blocked_by_id = ?',
      ),
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
   * list, or in none; with a parent, after the parent's other sub-issues; and
   * blocked by issues and blocking others. `null` when the project is not in
   * the list. Throws, creating nothing, when the title is empty, when the
   * parent or an issue of a dependency cannot be read, with a
   * `SubIssueError` when the parent cannot have another sub-issue, and with a
   * `DependencyError` when the dependencies would break their rules.
   */
  create(
    issue: NewIssue,
    parentId: number | null = null,
    { blockedBy = [], blocking = [] }: NewIssueDependencies = {},
  ): Issue | null {
    const created = this.createAll(
      parentId,
      [
        {
          ...issue,
          blockedBy: blockedBy.map((issueId) => ({ issueId })),
          blocking: blocking.map((issueId) => ({ issueId })),
        },
      ],
      () => 'the new issue',
    )
    return created?.[0] ?? null
  }

  /**
   * Creates issues together as a parent's last sub-issues, in order, each
   * blocked by issues and blocking others, among them or not; or, when one of
   * them cannot be, none of them. `null` when a project is not in the list.
   * Throws, creating nothing, when a title is empty, when the parent or an
   * issue of a dependency cannot be read, with a `SubIssueError` when the
   * parent cannot have that many more sub-issues, and with a
   * `DependencyError` when the dependencies would break their rules; a reason
   * names each new issue by `itemName`, given its place from 0.
   */
  createSubIssues(
    parentId: number,
    issues: readonly NewSubIssue[],
    itemName: (index: number) => string = (index) => `new issue ${index + 1}`,
  ): Issue[] | null {
    return this.createAll(parentId, issues, itemName)
  }

  private createAll(
    parentId: number | null,
    issues: readonly NewSubIssue[],
    itemName: (index: number) => string,
  ): Issue[] | null {
    const titles = issues.map((issue) => savedTitle(issue.title))
    const created = transaction(this.db, () => {
      if (issues.some(({ projectId }) => projectId !== null && !this.isListed(projectId))) {
        return null
      }
      if (parentId !== null) {
        if (this.get(parentId) === null) throw new Error('The parent issue no longer exists.')
        const problem =
          issues.length === 0 ? null : newSubIssueProblem(this.links(), parentId, issues.length)
        if (problem !== null) throw new SubIssueError(problem)
      }
      const resolve = (reference: IssueReference) => {
        if ('item' in reference) return placeholder(reference.item)
        if (this.get(reference.issueId) === null) throw new Error('The issue no longer exists.')
        return reference.issueId
      }
      const added = withDependencies([], {
        add: issues.flatMap((issue, index) => [
          ...issue.blockedBy.map((reference) => ({
            issueId: placeholder(index),
            blockedById: resolve(reference),
          })),
          ...issue.blocking.map((reference) => ({
            issueId: resolve(reference),
            blockedById: placeholder(index),
          })),
        ]),
      })
      const newIds = issues.map((_issue, index) => placeholder(index))
      const links =
        parentId === null
          ? this.links()
          : withParents(
              this.links(),
              newIds.map((issueId) => ({ issueId, parentId })),
            )
      const problem = dependencyProblem(
        links,
        withDependencies(this.dependencyLinks(), { add: added }),
        { added, moved: parentId === null ? [] : newIds },
        (id) => (id < 0 ? itemName(placeOf(id)) : this.nameOf(id)),
      )
      if (problem !== null) throw new DependencyError(problem)
      const now = this.now()
      const ids = issues.map((issue, index) => {
        const { lastInsertRowid } = this.statements.insert.run(
          issue.projectId,
          titles[index]!,
          issue.description,
          issue.status,
          issue.priority,
          now,
          isCompleted(issue.status) ? now : null,
        )
        const id = Number(lastInsertRowid)
        if (parentId !== null) this.statements.link.run(id, parentId)
        return id
      })
      const saved = (id: number) => (id < 0 ? ids[placeOf(id)]! : id)
      for (const { issueId, blockedById } of added) {
        this.statements.depend.run(saved(issueId), saved(blockedById))
      }
      return { issues: ids.map((id) => this.get(id)!), dependent: added.length > 0 }
    })
    if (created === null) return null
    if (parentId !== null && created.issues.length > 0) this.subIssuesChanged()
    if (created.dependent) this.dependenciesChanged()
    return created.issues
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
   * sub-issues, also those of removed projects, become top-level issues, and
   * its dependencies, both ways, go with it.
   */
  delete(id: number): boolean {
    const linked = this.statements.linked.get(id, id) !== undefined
    const dependent = this.statements.dependent.get(id, id) !== undefined
    const deleted = this.statements.delete.run(id).changes > 0
    if (deleted && linked) this.subIssuesChanged()
    if (deleted && dependent) this.dependenciesChanged()
    return deleted
  }

  /** The parent of every issue that has one, those of removed projects included. */
  subIssues(): SubIssues {
    return { version: this.subIssueVersion, links: this.links() }
  }

  /** Every dependency, those of the issues of removed projects included, in the order they were made. */
  dependencies(): Dependencies {
    return { version: this.dependencyVersion, links: this.dependencyLinks() }
  }

  /**
   * Gives issues other parents, or none, one after another and all together:
   * an issue that gets another parent goes after that parent's other
   * sub-issues. Throws, changing nothing, when an issue or a parent is not
   * one that can be read, with a `SubIssueError` when the changes would
   * break the rules of sub-issues, and with a `DependencyError` when they
   * would break those of dependencies.
   */
  setParents(changes: readonly ParentChange[]): void {
    this.changeRelations({ parents: changes })
  }

  /**
   * Changes the parents and the dependencies of issues, all together: gives
   * issues other parents, or none, one after another, removes dependencies,
   * and makes others, each once, after the others. Throws, changing nothing,
   * when an issue is not one that can be read; with a `DependencyError` when
   * a dependency to remove is not there or one to make is there already; with
   * a `SubIssueError` when the changes would break the rules of sub-issues;
   * and with a `DependencyError` when they would break those of
   * dependencies.
   */
  changeRelations({
    parents = [],
    removeDependencies = [],
    addDependencies = [],
  }: RelationChange): void {
    const changed = transaction(this.db, () => {
      const ids = [
        ...parents.flatMap(({ issueId, parentId }) =>
          parentId === null ? [issueId] : [issueId, parentId],
        ),
        ...[...removeDependencies, ...addDependencies].flatMap(({ issueId, blockedById }) => [
          issueId,
          blockedById,
        ]),
      ]
      for (const id of ids) {
        if (this.get(id) === null) throw new Error('The issue no longer exists.')
      }
      const name = (id: number) => this.nameOf(id)
      const current = this.dependencyLinks()
      for (const dependency of removeDependencies) {
        if (!hasDependency(current, dependency)) {
          throw new DependencyError(
            `${name(dependency.issueId)} is not blocked by ${name(dependency.blockedById)}.`,
          )
        }
      }
      const kept = withDependencies(current, { remove: removeDependencies })
      const added = withDependencies([], { add: addDependencies })
      for (const dependency of added) {
        if (hasDependency(kept, dependency)) {
          throw new DependencyError(
            `${name(dependency.issueId)} is blocked by ${name(dependency.blockedById)} already.`,
          )
        }
      }
      const links = this.links()
      const moved = withParents(links, parents)
      if (parents.length > 0) {
        const problem = subIssueProblem(
          moved,
          parents.map((change) => change.issueId),
          // Not naming an issue of a removed project, which Hoot does not show.
          (id) => this.get(id) !== null,
        )
        if (problem !== null) throw new SubIssueError(problem)
      }
      const problem = dependencyProblem(
        moved,
        withDependencies(kept, { add: added }),
        {
          added,
          moved: [...new Set(parents.map((change) => change.issueId))].filter((id) => {
            const parentId = parentOf(moved, id)
            return parentId !== null && parentId !== parentOf(links, id)
          }),
        },
        name,
      )
      if (problem !== null) throw new DependencyError(problem)
      let applied = links
      for (const change of parents) {
        if (parentOf(applied, change.issueId) === change.parentId) continue
        applied = withParents(applied, [change])
        this.statements.unlink.run(change.issueId)
        if (change.parentId !== null) this.statements.link.run(change.issueId, change.parentId)
      }
      for (const { issueId, blockedById } of removeDependencies) {
        this.statements.undepend.run(issueId, blockedById)
      }
      for (const { issueId, blockedById } of added) {
        this.statements.depend.run(issueId, blockedById)
      }
      return {
        parents: applied !== links,
        dependencies: removeDependencies.length + added.length > 0,
      }
    })
    if (changed.parents) this.subIssuesChanged()
    if (changed.dependencies) this.dependenciesChanged()
  }

  /** How a reason names an issue: by its identifier, unless Hoot does not show it. */
  private nameOf(id: number): string {
    return this.get(id) === null ? UNSHOWN_ISSUE : issueIdentifier(id)
  }

  private links(): SubIssueLink[] {
    return (
      this.statements.links.all() as unknown as Array<{ issue_id: number; parent_id: number }>
    ).map((row) => ({ issueId: row.issue_id, parentId: row.parent_id }))
  }

  private dependencyLinks(): Dependency[] {
    return (
      this.statements.dependencies.all() as unknown as Array<{
        issue_id: number
        blocked_by_id: number
      }>
    ).map((row) => ({ issueId: row.issue_id, blockedById: row.blocked_by_id }))
  }

  private subIssuesChanged(): void {
    this.subIssueVersion++
    this.emit('sub-issues-changed', this.subIssues())
  }

  private dependenciesChanged(): void {
    this.dependencyVersion++
    this.emit('dependencies-changed', this.dependencies())
  }

  /** Whether a project is in the list. */
  private isListed(projectId: number): boolean {
    return this.statements.listedProject.get(projectId) !== undefined
  }
}

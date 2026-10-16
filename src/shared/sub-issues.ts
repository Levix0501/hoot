import { issueIdentifier, type IssueStatus } from './issues'

/** The most sub-issues an issue can have, as on GitHub. */
export const MAX_SUB_ISSUES = 100

/**
 * The deepest level an issue can be at, as on GitHub: the sub-issues of a
 * top-level issue are at level 1, theirs at level 2, and so on.
 */
export const MAX_SUB_ISSUE_LEVEL = 8

/** That an issue is a sub-issue of another, its parent. */
export interface SubIssueLink {
  issueId: number
  parentId: number
}

/**
 * The parent of every issue that has one, those of removed projects included,
 * in the order the sub-issues last became sub-issues of their parent: an
 * issue's sub-issues in this order are in the order its page lists them.
 * `version` grows with every change, so that the latest one known wins.
 */
export interface SubIssues {
  version: number
  links: SubIssueLink[]
}

/** A change of an issue's parent: to another issue, or to none for a top-level issue. */
export interface ParentChange {
  issueId: number
  parentId: number | null
}

/** The parent of an issue, or `null` for a top-level issue. */
export function parentOf(links: readonly SubIssueLink[], issueId: number): number | null {
  return links.find((link) => link.issueId === issueId)?.parentId ?? null
}

/** The sub-issues of an issue, in the order its page lists them. */
export function subIssueIdsOf(links: readonly SubIssueLink[], parentId: number): number[] {
  return links.filter((link) => link.parentId === parentId).map((link) => link.issueId)
}

/** An issue's parent, its parent's parent, and so on. */
export function ancestorsOf(links: readonly SubIssueLink[], issueId: number): Set<number> {
  const parents = new Map(links.map((link) => [link.issueId, link.parentId]))
  const ancestors = new Set<number>()
  for (
    let id = parents.get(issueId);
    id !== undefined && !ancestors.has(id);
    id = parents.get(id)
  ) {
    ancestors.add(id)
  }
  return ancestors
}

/** An issue's sub-issues, theirs, and so on. */
export function descendantsOf(links: readonly SubIssueLink[], issueId: number): Set<number> {
  const descendants = new Set<number>()
  const pending = [issueId]
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    for (const child of subIssueIdsOf(links, id)) {
      if (descendants.has(child) || child === issueId) continue
      descendants.add(child)
      pending.push(child)
    }
  }
  return descendants
}

/**
 * The links once these changes are made, one after another. An issue that
 * gets another parent goes after that parent's other sub-issues; one given
 * the parent it has keeps its place.
 */
export function withParents(
  links: readonly SubIssueLink[],
  changes: readonly ParentChange[],
): SubIssueLink[] {
  let result = [...links]
  for (const { issueId, parentId } of changes) {
    if (parentOf(result, issueId) === parentId) continue
    result = result.filter((link) => link.issueId !== issueId)
    if (parentId !== null) result.push({ issueId, parentId })
  }
  return result
}

/** The level of an issue: 0 for a top-level issue, 1 for a sub-issue of one, and so on. */
function levelOf(parents: ReadonlyMap<number, number>, issueId: number): number {
  const seen = new Set<number>()
  for (let id = parents.get(issueId); id !== undefined && !seen.has(id); id = parents.get(id)) {
    seen.add(id)
  }
  return seen.size
}

/** The deepest of an issue's descendants, and how many levels below the issue it is: 0 for the issue itself. */
function deepestBelow(
  children: ReadonlyMap<number, readonly number[]>,
  issueId: number,
): { issueId: number; depth: number } {
  let deepest = { issueId, depth: 0 }
  const seen = new Set([issueId])
  let level = [issueId]
  for (let depth = 1; level.length > 0; depth++) {
    const next = level.flatMap((id) => children.get(id) ?? []).filter((id) => !seen.has(id))
    for (const id of next) seen.add(id)
    if (next.length > 0) deepest = { issueId: next[0]!, depth }
    level = next
  }
  return deepest
}

/**
 * Why links, once issues got the parents they have in them, break the rules
 * of sub-issues; `null` when they do not. An issue cannot be below itself,
 * no issue can have more than `MAX_SUB_ISSUES` sub-issues, and no issue can
 * be below `MAX_SUB_ISSUE_LEVEL`. `changed` are the issues whose parent
 * changed, the only ones checked.
 */
export function subIssueProblem(
  links: readonly SubIssueLink[],
  changed: readonly number[],
): string | null {
  const parents = new Map(links.map((link) => [link.issueId, link.parentId]))
  const children = new Map<number, number[]>()
  for (const link of links) {
    const siblings = children.get(link.parentId)
    if (siblings) siblings.push(link.issueId)
    else children.set(link.parentId, [link.issueId])
  }
  const moved = changed.filter((id) => parents.has(id))
  for (const issueId of moved) {
    const parentId = parents.get(issueId)!
    if (parentId === issueId) {
      return `${issueIdentifier(issueId)} cannot be a sub-issue of itself.`
    }
    if (ancestorsOf(links, parentId).has(issueId)) {
      return (
        `${issueIdentifier(issueId)} cannot be a sub-issue of ${issueIdentifier(parentId)}, ` +
        `which is below it.`
      )
    }
  }
  for (const parentId of new Set(moved.map((id) => parents.get(id)!))) {
    const count = children.get(parentId)?.length ?? 0
    if (count > MAX_SUB_ISSUES) {
      return (
        `${issueIdentifier(parentId)} would have ${count} sub-issues, and an issue can have at ` +
        `most ${MAX_SUB_ISSUES}.`
      )
    }
  }
  for (const issueId of moved) {
    const deepest = deepestBelow(children, issueId)
    const level = levelOf(parents, issueId) + deepest.depth
    if (level > MAX_SUB_ISSUE_LEVEL) {
      return (
        `${issueIdentifier(issueId)} cannot be a sub-issue of ` +
        `${issueIdentifier(parents.get(issueId)!)}: ${issueIdentifier(deepest.issueId)} would ` +
        `then be ${level} levels below a top-level issue, and an issue can be at most ` +
        `${MAX_SUB_ISSUE_LEVEL} levels below one.`
      )
    }
  }
  return null
}

/**
 * Why an issue cannot get a new sub-issue, given the parents of all issues;
 * `null` when it can.
 */
export function newSubIssueProblem(
  links: readonly SubIssueLink[],
  parentId: number,
): string | null {
  const parents = new Map(links.map((link) => [link.issueId, link.parentId]))
  if (levelOf(parents, parentId) >= MAX_SUB_ISSUE_LEVEL) {
    return (
      `${issueIdentifier(parentId)} is ${MAX_SUB_ISSUE_LEVEL} levels below a top-level issue, ` +
      `the deepest an issue can be, so it cannot have sub-issues.`
    )
  }
  if (subIssueIdsOf(links, parentId).length >= MAX_SUB_ISSUES) {
    return `${issueIdentifier(parentId)} has ${MAX_SUB_ISSUES} sub-issues, the most an issue can have.`
  }
  return null
}

/** How far an issue's sub-issues have come. */
export interface SubIssueProgress {
  /** How many are done. */
  completed: number
  /** How many are not canceled. */
  total: number
  /** How many are in progress. */
  started: number
}

/** The progress of sub-issues with these statuses: canceled ones count for nothing. */
export function subIssueProgress(statuses: Iterable<IssueStatus>): SubIssueProgress {
  const progress = { completed: 0, total: 0, started: 0 }
  for (const status of statuses) {
    if (status === 'canceled') continue
    progress.total++
    if (status === 'done') progress.completed++
    if (status === 'in_progress') progress.started++
  }
  return progress
}

/** The percentage of the sub-issues done, rounded down: 0 without any not canceled. */
export function percentCompleted({ completed, total }: SubIssueProgress): number {
  return total === 0 ? 0 : Math.floor((100 * completed) / total)
}

/**
 * How full a progress circle is, from 0 to 1, as Linear fills it: a done
 * sub-issue counts whole, one in progress a quarter; empty without any not
 * canceled.
 */
export function progressFill({ completed, total, started }: SubIssueProgress): number {
  return total === 0 ? 0 : (completed + started / 4) / total
}

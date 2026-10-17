import { issueIdentifier, isIssueOpen, type Issue } from './issues'

/** The most issues an issue can be blocked by, as on GitHub. */
export const MAX_BLOCKED_BY = 50

/** The most issues an issue can block, as on GitHub. */
export const MAX_BLOCKING = 50

/**
 * That an issue is blocked by another, as in Linear and GitHub: it waits for
 * that issue to be done first.
 */
export interface Dependency {
  /** The issue that waits. */
  issueId: number
  /** The issue it waits for. */
  blockedById: number
}

/**
 * Every dependency, those of the issues of removed projects included, in the
 * order they were made. `version` grows with every change, so that the latest
 * one known wins.
 */
export interface Dependencies {
  version: number
  links: Dependency[]
}

/** The issues an issue is blocked by, in the order it became blocked by them. */
export function blockedByIdsOf(links: readonly Dependency[], issueId: number): number[] {
  return links.filter((link) => link.issueId === issueId).map((link) => link.blockedById)
}

/** The issues blocked by an issue, in the order they became blocked by it. */
export function blockingIdsOf(links: readonly Dependency[], issueId: number): number[] {
  return links.filter((link) => link.blockedById === issueId).map((link) => link.issueId)
}

/** Whether `links` has this dependency. */
export function hasDependency(links: readonly Dependency[], dependency: Dependency): boolean {
  return links.some(
    (link) => link.issueId === dependency.issueId && link.blockedById === dependency.blockedById,
  )
}

/** The dependencies once some are removed and others added, each once, after the others. */
export function withDependencies(
  links: readonly Dependency[],
  { add = [], remove = [] }: { add?: readonly Dependency[]; remove?: readonly Dependency[] },
): Dependency[] {
  const result = links.filter((link) => !hasDependency(remove, link))
  for (const dependency of add) {
    if (!hasDependency(result, dependency)) result.push({ ...dependency })
  }
  return result
}

/** A step from an issue to one it waits for directly: an issue it is blocked by. */
export interface WaitStep {
  from: number
  to: number
}

/**
 * What each issue waits for directly, given every dependency: the issues it
 * is blocked by. Parents and sub-issues count for nothing here.
 */
export function waitSteps(dependencies: readonly Dependency[]): Map<number, WaitStep[]> {
  const steps = new Map<number, WaitStep[]>()
  for (const { issueId, blockedById } of dependencies) {
    const step = { from: issueId, to: blockedById }
    const from = steps.get(issueId)
    if (from) from.push(step)
    else steps.set(issueId, [step])
  }
  return steps
}

/**
 * The shortest way an issue waits for another, one step after another; `null`
 * when it does not wait for it, as an issue does not wait for itself unless
 * it waits for an issue that waits for it.
 */
export function waitPath(
  steps: ReadonlyMap<number, readonly WaitStep[]>,
  from: number,
  to: number,
): WaitStep[] | null {
  const reachedBy = new Map<number, WaitStep>()
  const pending = [from]
  for (let index = 0; index < pending.length; index++) {
    for (const step of steps.get(pending[index]!) ?? []) {
      if (reachedBy.has(step.to)) continue
      reachedBy.set(step.to, step)
      if (step.to === to) {
        const path = [step]
        for (let back = reachedBy.get(step.from); path[0]!.from !== from;) {
          path.unshift(back!)
          back = reachedBy.get(back!.from)
        }
        return path
      }
      pending.push(step.to)
    }
  }
  return null
}

/** The issues an issue waits for, directly or through others. */
export function waitedForBy(
  steps: ReadonlyMap<number, readonly WaitStep[]>,
  issueId: number,
): Set<number> {
  const reached = new Set<number>()
  const pending = [issueId]
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    for (const step of steps.get(id) ?? []) {
      if (reached.has(step.to)) continue
      reached.add(step.to)
      pending.push(step.to)
    }
  }
  return reached
}

/** The issues that wait for an issue, directly or through others. */
export function waitingFor(
  steps: ReadonlyMap<number, readonly WaitStep[]>,
  issueId: number,
): Set<number> {
  const reverse = new Map<number, number[]>()
  for (const list of steps.values()) {
    for (const step of list) {
      const from = reverse.get(step.to)
      if (from) from.push(step.from)
      else reverse.set(step.to, [step.from])
    }
  }
  const reached = new Set<number>()
  const pending = [issueId]
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    for (const from of reverse.get(id) ?? []) {
      if (reached.has(from)) continue
      reached.add(from)
      pending.push(from)
    }
  }
  return reached
}

/** Text that starts a sentence, with its first letter in upper case. */
function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** A way an issue waits for another, in words: "ISS-1 is blocked by ISS-2, which is blocked by ISS-3". */
function pathText(path: readonly WaitStep[], name: (issueId: number) => string): string {
  return path
    .map((step, index) =>
      index === 0
        ? `${name(step.from)} is blocked by ${name(step.to)}`
        : `which is blocked by ${name(step.to)}`,
    )
    .join(', ')
}

/**
 * Why the dependencies, once `added` are made, break the rules of
 * dependencies; `null` when they do not. No issue can wait for itself,
 * through others or not, and none can be blocked by more than
 * `MAX_BLOCKED_BY` issues or block more than `MAX_BLOCKING`. Parents and
 * sub-issues count for nothing: an issue can be blocked by an issue above or
 * below it, and block one. `dependencies` are all of them once the
 * dependencies are made, those of issues of removed projects included, and
 * only what `added` touches is checked. Issues are named by `name`, which can
 * name those Hoot does not show without their identifier.
 */
export function dependencyProblem(
  dependencies: readonly Dependency[],
  added: readonly Dependency[],
  name: (issueId: number) => string = issueIdentifier,
): string | null {
  const steps = waitSteps(dependencies)
  for (const { issueId, blockedById } of added) {
    const issue = name(issueId)
    const blocker = name(blockedById)
    if (issueId === blockedById) return `${sentence(issue)} cannot be blocked by itself.`
    const path = waitPath(steps, blockedById, issueId)
    if (path !== null) {
      return (
        `${sentence(issue)} cannot be blocked by ${blocker}, which waits for it already: ` +
        `${pathText(path, name)}.`
      )
    }
  }
  for (const issueId of new Set(added.map((dependency) => dependency.issueId))) {
    const count = blockedByIdsOf(dependencies, issueId).length
    if (count > MAX_BLOCKED_BY) {
      return (
        `${sentence(name(issueId))} would be blocked by ${count} issues, and an issue can be ` +
        `blocked by at most ${MAX_BLOCKED_BY}.`
      )
    }
  }
  for (const blockedById of new Set(added.map((dependency) => dependency.blockedById))) {
    const count = blockingIdsOf(dependencies, blockedById).length
    if (count > MAX_BLOCKING) {
      return (
        `${sentence(name(blockedById))} would block ${count} issues, and an issue can block at ` +
        `most ${MAX_BLOCKING}.`
      )
    }
  }
  return null
}

/** How many issues an issue waits on, and how many wait on it. */
export interface WaitCounts {
  waitedOn: number
  waiting: number
}

/**
 * How many issues each issue waits on, and how many wait on it, by id; an
 * issue without either is left out. An issue waits on an issue it is blocked
 * by while both are shown and neither is done nor canceled: `shown` are the
 * issues Hoot shows, and the others count for nothing.
 */
export function waitCounts(
  shown: ReadonlyMap<number, Pick<Issue, 'status'>>,
  links: readonly Dependency[],
): Map<number, WaitCounts> {
  const counts = new Map<number, WaitCounts>()
  const of = (id: number) => {
    const found = counts.get(id)
    if (found) return found
    const created = { waitedOn: 0, waiting: 0 }
    counts.set(id, created)
    return created
  }
  for (const { issueId, blockedById } of links) {
    const issue = shown.get(issueId)
    const blocker = shown.get(blockedById)
    if (!issue || !blocker || !isIssueOpen(issue) || !isIssueOpen(blocker)) continue
    of(issueId).waitedOn++
    of(blockedById).waiting++
  }
  return counts
}

/**
 * The issues an issue waits on, in the order it became blocked by them: those
 * it is blocked by while Hoot shows both and neither is done nor canceled.
 * `shown` are the issues Hoot shows.
 */
export function waitedOnIds(
  shown: ReadonlyMap<number, Pick<Issue, 'status'>>,
  links: readonly Dependency[],
  issueId: number,
): number[] {
  const issue = shown.get(issueId)
  if (!issue || !isIssueOpen(issue)) return []
  return blockedByIdsOf(links, issueId).filter((id) => {
    const blocker = shown.get(id)
    return blocker !== undefined && isIssueOpen(blocker)
  })
}

/**
 * The issues that cannot be picked to block an issue (`blocked-by`) or to be
 * blocked by it (`blocking`): the issue itself, those it has the dependency
 * with already, and those the dependency would have wait for themselves,
 * through all the issues, those Hoot does not show included. Its parent,
 * sub-issues and the issues above and below it can be picked as any other.
 */
export function unpickableForDependency(
  dependencies: readonly Dependency[],
  issueId: number,
  kind: 'blocked-by' | 'blocking',
): Set<number> {
  const steps = waitSteps(dependencies)
  return new Set([
    issueId,
    ...(kind === 'blocked-by'
      ? [...blockedByIdsOf(dependencies, issueId), ...waitingFor(steps, issueId)]
      : [...blockingIdsOf(dependencies, issueId), ...waitedForBy(steps, issueId)]),
  ])
}

import { describe, expect, it } from 'vitest'
import {
  blockedByIdsOf,
  blockingIdsOf,
  dependencyProblem,
  MAX_BLOCKED_BY,
  MAX_BLOCKING,
  unpickableForDependency,
  waitCounts,
  waitedForBy,
  waitingFor,
  waitPath,
  waitSteps,
  withDependencies,
  type Dependency,
} from './dependencies'
import type { IssueStatus } from './issues'
import { withParents, type SubIssueLink } from './sub-issues'

/** Links from [sub-issue, parent] pairs, in order. */
const links = (...pairs: Array<[number, number]>): SubIssueLink[] =>
  pairs.map(([issueId, parentId]) => ({ issueId, parentId }))

/** Dependencies from [issue, blocked by] pairs, in order. */
const blocked = (...pairs: Array<[number, number]>): Dependency[] =>
  pairs.map(([issueId, blockedById]) => ({ issueId, blockedById }))

const sorted = (ids: Iterable<number>) => [...ids].toSorted((a, b) => a - b)

// P (1) has P1 (2) and P2 (3), and P1 has Q1 (4); X (5) waits for Y (6), which
// waits for Z (7); Y has Y1 (8); W (9) has nothing to do with them.
const tree = links([2, 1], [3, 1], [4, 2], [8, 6])
const dependencies = blocked([5, 6], [6, 7])
const [P, P1, P2, Q1, X, Y, Z, Y1, W] = [1, 2, 3, 4, 5, 6, 7, 8, 9]

/** Names issues as a caller does that does not show Y. */
const unshownY = (id: number) => (id === Y ? 'an issue Hoot does not show' : `ISS-${id}`)

/** Why a dependency cannot be made, given the tree and the dependencies above. */
const added = (issueId: number, blockedById: number) =>
  dependencyProblem(
    tree,
    withDependencies(dependencies, { add: blocked([issueId, blockedById]) }),
    {
      added: blocked([issueId, blockedById]),
      moved: [],
    },
  )

/** Why an issue cannot get a parent, given the tree and the dependencies above. */
const moved = (issueId: number, parentId: number) =>
  dependencyProblem(withParents(tree, [{ issueId, parentId }]), dependencies, {
    added: [],
    moved: [issueId],
  })

describe('the dependencies of an issue', () => {
  it('are the issues it is blocked by and those it blocks, in the order they were made', () => {
    const made = blocked([1, 3], [2, 3], [1, 2])
    expect(blockedByIdsOf(made, 1)).toEqual([3, 2])
    expect(blockingIdsOf(made, 3)).toEqual([1, 2])
    expect(
      withDependencies(made, { remove: blocked([2, 3]), add: blocked([1, 2], [4, 1]) }),
    ).toEqual(blocked([1, 3], [1, 2], [4, 1]))
  })

  it('make it wait for those it is blocked by, and a parent for its sub-issues, through others too', () => {
    const steps = waitSteps(tree, dependencies)
    expect(sorted(waitedForBy(steps, X))).toEqual([Y, Z, Y1])
    expect(sorted(waitingFor(steps, Y1))).toEqual([X, Y])
    expect(sorted(waitedForBy(steps, P))).toEqual([P1, P2, Q1])
    expect(waitPath(steps, X, Y1)).toEqual([
      { from: X, to: Y, kind: 'blocked-by' },
      { from: Y, to: Y1, kind: 'parent-of' },
    ])
    expect(waitPath(steps, Y1, X)).toBeNull()
  })
})

describe('dependencyProblem', () => {
  it('finds nothing wrong with a dependency within the rules', () => {
    expect(added(X, W)).toBeNull()
    expect(added(X, Z)).toBeNull()
    expect(added(Y1, Z)).toBeNull()
    expect(added(P1, P2)).toBeNull()
    expect(moved(X, W)).toBeNull()
  })

  it('refuses an issue blocked by itself, or by an issue above or below it', () => {
    expect(added(X, X)).toBe('ISS-5 cannot be blocked by itself.')
    expect(added(P1, P)).toBe(
      'ISS-2 cannot be blocked by ISS-1, which is above it: an issue waits for the issues ' +
        'below it, so they would wait for each other.',
    )
    expect(added(P, Q1)).toBe(
      'ISS-1 cannot be blocked by ISS-4, which is below it: an issue waits for the issues below ' +
        'it already.',
    )
  })

  it('refuses an issue that would wait for itself, naming how', () => {
    expect(added(Z, X)).toBe(
      'ISS-7 cannot be blocked by ISS-5, which waits for it already: ISS-5 is blocked by ISS-6, ' +
        'which is blocked by ISS-7.',
    )
    expect(added(Y1, X)).toBe(
      'ISS-8 cannot be blocked by ISS-5, which waits for it already: ISS-5 is blocked by ISS-6, ' +
        'which is the parent of ISS-8.',
    )
  })

  it('names an issue Hoot does not show as the caller asks', () => {
    expect(
      dependencyProblem(
        tree,
        withDependencies(dependencies, { add: blocked([Z, X]) }),
        {
          added: blocked([Z, X]),
          moved: [],
        },
        unshownY,
      ),
    ).toBe(
      'ISS-7 cannot be blocked by ISS-5, which waits for it already: ISS-5 is blocked by an ' +
        'issue Hoot does not show, which is blocked by ISS-7.',
    )
    expect(
      dependencyProblem(
        tree,
        blocked([-1, -1]),
        { added: blocked([-1, -1]), moved: [] },
        () => 'item 1',
      ),
    ).toBe('Item 1 cannot be blocked by itself.')
  })

  it('refuses a parent that would put an issue above or below one of its dependencies, naming the dependency', () => {
    expect(moved(X, Y)).toBe(
      'ISS-5 cannot be a sub-issue of ISS-6: ISS-5 is blocked by ISS-6, which would then be ' +
        'above it.',
    )
    expect(moved(Z, Y)).toBe(
      'ISS-7 cannot be a sub-issue of ISS-6: ISS-6 is blocked by ISS-7, which would then be ' +
        'below it.',
    )
    // Under Y1, X would be below Y, the parent of Y1.
    expect(moved(X, Y1)).toBe(
      'ISS-5 cannot be a sub-issue of ISS-8: ISS-5 is blocked by ISS-6, which would then be ' +
        'above it.',
    )
    expect(moved(X, Z)).toBe(
      'ISS-5 cannot be a sub-issue of ISS-7, which would then wait for it while it waits for ' +
        'ISS-7: ISS-5 is blocked by ISS-6, which is blocked by ISS-7.',
    )
  })

  it(`refuses more than ${MAX_BLOCKED_BY} issues blocking an issue, or ${MAX_BLOCKING} blocked by one`, () => {
    const many = Array.from({ length: 50 }, (_, index) => 100 + index)
    const blocking = blocked(...many.map((id): [number, number] => [1, id]))
    expect(
      dependencyProblem([], withDependencies(blocking, { add: blocked([1, 99]) }), {
        added: blocked([1, 99]),
        moved: [],
      }),
    ).toBe('ISS-1 would be blocked by 51 issues, and an issue can be blocked by at most 50.')
    const waiting = blocked(...many.map((id): [number, number] => [id, 2]))
    expect(
      dependencyProblem([], withDependencies(waiting, { add: blocked([99, 2]) }), {
        added: blocked([99, 2]),
        moved: [],
      }),
    ).toBe('ISS-2 would block 51 issues, and an issue can block at most 50.')
    expect(dependencyProblem([], blocking, { added: blocked([1, 100]), moved: [] })).toBeNull()
  })
})

describe('waitCounts', () => {
  const statuses: Record<number, IssueStatus> = {
    1: 'todo',
    2: 'in_progress',
    3: 'done',
    4: 'canceled',
    5: 'backlog',
  }
  const shown = new Map(Object.entries(statuses).map(([id, status]) => [Number(id), { status }]))

  it('counts only the issues shown that are neither done nor canceled, both of them', () => {
    const counts = waitCounts(
      shown,
      blocked([1, 2], [1, 3], [1, 4], [1, 5], [1, 6], [5, 2], [3, 2]),
    )
    expect(counts.get(1)).toEqual({ waitedOn: 2, waiting: 0 })
    expect(counts.get(2)).toEqual({ waitedOn: 0, waiting: 2 })
    expect(counts.get(5)).toEqual({ waitedOn: 1, waiting: 1 })
    expect([...counts.keys()].toSorted()).toEqual([1, 2, 5])
  })
})

describe('unpickableForDependency', () => {
  it('leaves out the issue, those above and below it, those it has the dependency with, and those it would wait for itself through', () => {
    expect(sorted(unpickableForDependency(tree, dependencies, X, 'blocked-by'))).toEqual([X, Y])
    expect(sorted(unpickableForDependency(tree, dependencies, X, 'blocking'))).toEqual([
      X,
      Y,
      Z,
      Y1,
    ])
    expect(sorted(unpickableForDependency(tree, dependencies, P1, 'blocked-by'))).toEqual([
      P,
      P1,
      Q1,
    ])
    expect(sorted(unpickableForDependency(tree, dependencies, P1, 'blocking'))).toEqual([P, P1, Q1])
    expect(sorted(unpickableForDependency(tree, dependencies, Y1, 'blocked-by'))).toEqual([
      X,
      Y,
      Y1,
    ])
  })
})

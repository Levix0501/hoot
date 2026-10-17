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
  waitedOnIds,
  waitingFor,
  waitPath,
  waitSteps,
  withDependencies,
  type Dependency,
} from './dependencies'
import type { IssueStatus } from './issues'

/** Dependencies from [issue, blocked by] pairs, in order. */
const blocked = (...pairs: Array<[number, number]>): Dependency[] =>
  pairs.map(([issueId, blockedById]) => ({ issueId, blockedById }))

const sorted = (ids: Iterable<number>) => [...ids].toSorted((a, b) => a - b)

// X (5) waits for Y (6), which waits for Z (7); W (9) has nothing to do with
// them. Parents and sub-issues count for nothing in the rules.
const dependencies = blocked([5, 6], [6, 7])
const [X, Y, Z, W] = [5, 6, 7, 9]

/** Names issues as a caller does that does not show Y. */
const unshownY = (id: number) => (id === Y ? 'an issue Hoot does not show' : `ISS-${id}`)

/** Why a dependency cannot be made, given the dependencies above. */
const added = (issueId: number, blockedById: number) =>
  dependencyProblem(
    withDependencies(dependencies, { add: blocked([issueId, blockedById]) }),
    blocked([issueId, blockedById]),
  )

describe('the dependencies of an issue', () => {
  it('are the issues it is blocked by and those it blocks, in the order they were made', () => {
    const made = blocked([1, 3], [2, 3], [1, 2])
    expect(blockedByIdsOf(made, 1)).toEqual([3, 2])
    expect(blockingIdsOf(made, 3)).toEqual([1, 2])
    expect(
      withDependencies(made, { remove: blocked([2, 3]), add: blocked([1, 2], [4, 1]) }),
    ).toEqual(blocked([1, 3], [1, 2], [4, 1]))
  })

  it('make it wait for those it is blocked by, through others too, and for nothing else', () => {
    const steps = waitSteps(dependencies)
    expect(sorted(waitedForBy(steps, X))).toEqual([Y, Z])
    expect(sorted(waitingFor(steps, Z))).toEqual([X, Y])
    expect(waitPath(steps, X, Z)).toEqual([
      { from: X, to: Y },
      { from: Y, to: Z },
    ])
    expect(waitPath(steps, Z, X)).toBeNull()
  })
})

describe('dependencyProblem', () => {
  it('finds nothing wrong with a dependency within the rules', () => {
    expect(added(X, W)).toBeNull()
    expect(added(X, Z)).toBeNull()
    expect(added(W, X)).toBeNull()
  })

  it('refuses an issue blocked by itself', () => {
    expect(added(X, X)).toBe('ISS-5 cannot be blocked by itself.')
  })

  it('refuses an issue that would wait for itself, naming how', () => {
    expect(added(Z, X)).toBe(
      'ISS-7 cannot be blocked by ISS-5, which waits for it already: ISS-5 is blocked by ISS-6, ' +
        'which is blocked by ISS-7.',
    )
  })

  it('names an issue Hoot does not show as the caller asks', () => {
    expect(
      dependencyProblem(
        withDependencies(dependencies, { add: blocked([Z, X]) }),
        blocked([Z, X]),
        unshownY,
      ),
    ).toBe(
      'ISS-7 cannot be blocked by ISS-5, which waits for it already: ISS-5 is blocked by an ' +
        'issue Hoot does not show, which is blocked by ISS-7.',
    )
    expect(dependencyProblem(blocked([-1, -1]), blocked([-1, -1]), () => 'item 1')).toBe(
      'Item 1 cannot be blocked by itself.',
    )
  })

  it(`refuses more than ${MAX_BLOCKED_BY} issues blocking an issue, or ${MAX_BLOCKING} blocked by one`, () => {
    const many = Array.from({ length: 50 }, (_, index) => 100 + index)
    const blocking = blocked(...many.map((id): [number, number] => [1, id]))
    expect(
      dependencyProblem(withDependencies(blocking, { add: blocked([1, 99]) }), blocked([1, 99])),
    ).toBe('ISS-1 would be blocked by 51 issues, and an issue can be blocked by at most 50.')
    const waiting = blocked(...many.map((id): [number, number] => [id, 2]))
    expect(
      dependencyProblem(withDependencies(waiting, { add: blocked([99, 2]) }), blocked([99, 2])),
    ).toBe('ISS-2 would block 51 issues, and an issue can block at most 50.')
    expect(dependencyProblem(blocking, blocked([1, 100]))).toBeNull()
  })
})

const statuses: Record<number, IssueStatus> = {
  1: 'todo',
  2: 'in_progress',
  3: 'done',
  4: 'canceled',
  5: 'backlog',
}
const shown = new Map(Object.entries(statuses).map(([id, status]) => [Number(id), { status }]))

describe('waitCounts', () => {
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

describe('waitedOnIds', () => {
  it('lists the issues shown, neither done nor canceled, that an issue neither is waits on', () => {
    const links = blocked([1, 2], [1, 3], [1, 4], [1, 5], [1, 6], [3, 2])
    expect(waitedOnIds(shown, links, 1)).toEqual([2, 5])
    // A done issue waits on nothing.
    expect(waitedOnIds(shown, links, 3)).toEqual([])
    expect(waitedOnIds(shown, links, 6)).toEqual([])
  })
})

describe('unpickableForDependency', () => {
  it('leaves out the issue, those it has the dependency with, and those it would wait for itself through', () => {
    expect(sorted(unpickableForDependency(dependencies, X, 'blocked-by'))).toEqual([X, Y])
    expect(sorted(unpickableForDependency(dependencies, X, 'blocking'))).toEqual([X, Y, Z])
    expect(sorted(unpickableForDependency(dependencies, Z, 'blocked-by'))).toEqual([X, Y, Z])
    expect(sorted(unpickableForDependency(dependencies, W, 'blocked-by'))).toEqual([W])
  })
})

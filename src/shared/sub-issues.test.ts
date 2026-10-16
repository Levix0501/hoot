import { describe, expect, it } from 'vitest'
import {
  ancestorsOf,
  descendantsOf,
  newSubIssueProblem,
  parentOf,
  percentCompleted,
  progressFill,
  subIssueIdsOf,
  subIssueProblem,
  subIssueProgress,
  withParents,
  type SubIssueLink,
} from './sub-issues'

/** Links from [sub-issue, parent] pairs, in order. */
const links = (...pairs: Array<[number, number]>): SubIssueLink[] =>
  pairs.map(([issueId, parentId]) => ({ issueId, parentId }))

describe('the tree of sub-issues', () => {
  const tree = links([2, 1], [3, 1], [4, 2], [5, 4], [7, 6])

  it("finds an issue's parent, its sub-issues in order, its ancestors and its descendants", () => {
    expect(parentOf(tree, 4)).toBe(2)
    expect(parentOf(tree, 1)).toBeNull()
    expect(subIssueIdsOf(tree, 1)).toEqual([2, 3])
    expect(subIssueIdsOf(tree, 3)).toEqual([])
    expect([...ancestorsOf(tree, 5)]).toEqual([4, 2, 1])
    expect([...ancestorsOf(tree, 1)]).toEqual([])
    expect([...descendantsOf(tree, 1)].toSorted()).toEqual([2, 3, 4, 5])
    expect([...descendantsOf(tree, 6)]).toEqual([7])
  })

  it('puts an issue that gets another parent last, and keeps one given the parent it has', () => {
    expect(withParents(tree, [{ issueId: 2, parentId: 1 }])).toEqual(tree)
    expect(withParents(tree, [{ issueId: 2, parentId: 6 }])).toEqual(
      links([3, 1], [4, 2], [5, 4], [7, 6], [2, 6]),
    )
    expect(
      withParents(tree, [
        { issueId: 3, parentId: null },
        { issueId: 3, parentId: 1 },
      ]),
    ).toEqual(links([2, 1], [4, 2], [5, 4], [7, 6], [3, 1]))
  })

  it('finds nothing wrong with links within the rules', () => {
    expect(subIssueProblem(tree, [2, 3, 4, 5, 7])).toBeNull()
    expect(newSubIssueProblem(tree, 5)).toBeNull()
  })
})

describe('subIssueProgress', () => {
  it('counts the sub-issues done and those in progress among those not canceled', () => {
    const progress = subIssueProgress(['done', 'in_progress', 'canceled', 'backlog', 'todo'])
    expect(progress).toEqual({ completed: 1, total: 4, started: 1 })
    expect(percentCompleted(progress)).toBe(25)
    expect(progressFill(progress)).toBe((1 + 1 / 4) / 4)
  })

  it('is empty without sub-issues, or with only canceled ones', () => {
    for (const progress of [subIssueProgress([]), subIssueProgress(['canceled'])]) {
      expect(progress).toEqual({ completed: 0, total: 0, started: 0 })
      expect(percentCompleted(progress)).toBe(0)
      expect(progressFill(progress)).toBe(0)
    }
  })

  it('rounds the percentage down', () => {
    expect(percentCompleted({ completed: 1, total: 3, started: 0 })).toBe(33)
    expect(percentCompleted({ completed: 2, total: 3, started: 0 })).toBe(66)
    expect(percentCompleted({ completed: 3, total: 3, started: 0 })).toBe(100)
  })
})

import { describe, expect, it } from 'vitest'
import {
  compareWorktrees,
  defaultNestedBase,
  inspectionIsClean,
  isWithin,
  type WorktreeInfo,
} from './worktrees'

describe('defaultNestedBase', () => {
  const repository = { branches: ['develop', 'main'], current: 'main' }

  it("takes the branch named like the project's base branch", () => {
    expect(defaultNestedBase(repository, 'develop')).toBe('develop')
  })

  it('otherwise the checked-out branch, otherwise none', () => {
    expect(defaultNestedBase(repository, 'release')).toBe('main')
    expect(defaultNestedBase(repository, null)).toBe('main')
    expect(defaultNestedBase({ branches: ['trunk'], current: null }, 'main')).toBeNull()
  })
})

const named = (path: string, displayName: string) => ({ path, displayName }) as WorktreeInfo

describe('compareWorktrees', () => {
  it('orders by display name, then by path', () => {
    const sorted = [
      named('/c', 'zeta'),
      named('/b', 'alpha'),
      named('/a', 'alpha'),
      named('/d', 'beta'),
    ]
      .toSorted(compareWorktrees)
      .map((worktree) => worktree.path)
    expect(sorted).toEqual(['/a', '/b', '/d', '/c'])
  })
})

describe('isWithin', () => {
  it('matches the directory and paths below it only', () => {
    expect(isWithin('/w/G/feat', '/w/G/feat')).toBe(true)
    expect(isWithin('/w/G/feat/inner', '/w/G/feat')).toBe(true)
    expect(isWithin('/w/G/feature', '/w/G/feat')).toBe(false)
    expect(isWithin('/w/G', '/w/G/feat')).toBe(false)
  })

  it('reads the paths of Windows, with \\ between folders', () => {
    expect(isWithin('C:\\w\\G\\feat\\inner', 'C:\\w\\G\\feat')).toBe(true)
    expect(isWithin('C:\\w\\G\\feature', 'C:\\w\\G\\feat')).toBe(false)
    expect(isWithin('C:\\w', 'C:\\')).toBe(true)
  })
})

describe('inspectionIsClean', () => {
  it('is clean without changes and without foreign repositories', () => {
    const base = { root: '/r', innerMembers: [], branch: 'b', changes: [], foreignRepositories: [] }
    expect(inspectionIsClean(base)).toBe(true)
    expect(inspectionIsClean({ ...base, foreignRepositories: ['x'] })).toBe(false)
    expect(
      inspectionIsClean({
        ...base,
        changes: [{ repository: 'r', files: [], total: 0, detachedCommits: true }],
      }),
    ).toBe(false)
  })
})

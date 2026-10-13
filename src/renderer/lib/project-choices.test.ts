import { describe, expect, it } from 'vitest'
import type { Project } from '../../shared/ipc'
import type { Issue } from '../../shared/issues'
import {
  issuePageOrder,
  isOnList,
  listProject,
  projectFilterLabel,
  projectOptions,
} from './project-choices'

const gamma: Project = { id: 1, root: '/work/gamma', name: 'gamma' }
const hotel: Project = { id: 2, root: '/work/hotel', name: 'hotel' }

const ids = (issues: Issue[]) => issues.map(({ id }) => id)

function issue(id: number, changes: Partial<Issue>): Issue {
  return {
    id,
    projectId: null,
    title: `#${id}`,
    description: '',
    status: 'todo',
    priority: 0,
    createdAt: id,
    completedAt: null,
    ...changes,
  }
}

describe('projectOptions', () => {
  it('offers no project first, then the projects in the order of the list', () => {
    expect(projectOptions([gamma, hotel])).toEqual([
      { value: null, label: 'No project' },
      { value: 1, label: 'gamma' },
      { value: 2, label: 'hotel' },
    ])
    expect(projectOptions([])).toEqual([{ value: null, label: 'No project' }])
  })
})

describe('isOnList', () => {
  it('shows every issue while nothing is checked', () => {
    expect(isOnList({ projectId: 1 }, [])).toBe(true)
    expect(isOnList({ projectId: null }, [])).toBe(true)
  })

  it('shows the issues of the projects checked, and those without one when No project is', () => {
    expect(isOnList({ projectId: 1 }, [1])).toBe(true)
    expect(isOnList({ projectId: 2 }, [1])).toBe(false)
    expect(isOnList({ projectId: null }, [1])).toBe(false)
    expect(isOnList({ projectId: null }, [1, null])).toBe(true)
    expect(isOnList({ projectId: 2 }, [null])).toBe(false)
    expect(isOnList({ projectId: 2 }, [1, 2])).toBe(true)
  })
})

describe('projectFilterLabel', () => {
  it('says All projects, the one choice checked, or how many are', () => {
    const projects = [gamma, hotel]
    expect(projectFilterLabel([], projects)).toBe('All projects')
    expect(projectFilterLabel([1], projects)).toBe('gamma')
    expect(projectFilterLabel([null], projects)).toBe('No project')
    expect(projectFilterLabel([1, null], projects)).toBe('2 projects')
    expect(projectFilterLabel([null, 1, 2], projects)).toBe('3 projects')
  })
})

describe('listProject', () => {
  it('is the project checked when it is all that is checked, and none otherwise', () => {
    expect(listProject([1])).toBe(1)
    expect(listProject([])).toBeNull()
    expect(listProject([null])).toBeNull()
    expect(listProject([1, 2])).toBeNull()
    expect(listProject([1, null])).toBeNull()
  })
})

describe('issuePageOrder', () => {
  // As the list orders them in all issues with nothing checked: b, a, e, c.
  const a = issue(1, { projectId: 1, status: 'todo' })
  const b = issue(2, { projectId: 2, status: 'todo' })
  const c = issue(3, { projectId: null, status: 'backlog' })
  const e = issue(4, { projectId: 1, status: 'backlog' })
  const all = [a, b, c, e]

  it('steps through the issues of the list, in the order of its view', () => {
    const shown = all.filter((candidate) => isOnList(candidate, [1]))
    expect(ids(issuePageOrder(a.id, shown, all, 'all'))).toEqual([1, 4])
    expect(ids(issuePageOrder(e.id, shown, all, 'backlog'))).toEqual([4])
  })

  it('steps through every issue in the order of all issues when the list does not show the issue', () => {
    const shown = all.filter((candidate) => isOnList(candidate, [1]))
    // b, of hotel, is not on gamma's list.
    expect(ids(issuePageOrder(b.id, shown, all, 'all'))).toEqual([2, 1, 4, 3])
    // Nor is a in the backlog view.
    expect(ids(issuePageOrder(a.id, shown, all, 'backlog'))).toEqual([2, 1, 4, 3])
  })
})

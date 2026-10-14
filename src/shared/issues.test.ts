import { describe, expect, it } from 'vitest'
import {
  inView,
  isCompleted,
  isIssueOpen,
  issueGroups,
  issueIdentifier,
  issueTitle,
  listOrder,
  oneLineTitle,
  statusOnceStarted,
  type Issue,
} from './issues'

function issue(id: number, changes: Partial<Issue>): Issue {
  return {
    id,
    projectId: 1,
    title: `#${id}`,
    description: '',
    status: 'backlog',
    priority: 0,
    createdAt: 0,
    completedAt: null,
    ...changes,
  }
}

describe('issueTitle', () => {
  it('drops the whitespace around a title, and leaves nothing of a blank one', () => {
    expect(issueTitle('  Restore sessions  ')).toBe('Restore sessions')
    expect(issueTitle('\t a  b \n')).toBe('a  b')
    expect(issueTitle(' \t \t')).toBe('')
  })
})

describe('oneLineTitle', () => {
  it('puts a title on one line, each line break a space, and keeps everything else', () => {
    expect(oneLineTitle('Fix\r\nthe\nlogin\rbug')).toBe('Fix the login bug')
    expect(oneLineTitle('\n a\tb \r\n\r\n')).toBe('  a\tb   ')
    expect(oneLineTitle('Restore sessions')).toBe('Restore sessions')
  })
})

describe('isCompleted and isIssueOpen', () => {
  it('count done and canceled issues as completed, and every other as open', () => {
    expect(isCompleted('done')).toBe(true)
    expect(isCompleted('canceled')).toBe(true)
    for (const status of ['backlog', 'todo', 'in_progress'] as const) {
      expect(isCompleted(status)).toBe(false)
      expect(isIssueOpen({ status })).toBe(true)
    }
    expect(isIssueOpen({ status: 'done' })).toBe(false)
  })
})

describe('statusOnceStarted', () => {
  it('puts an issue in the backlog or to do in progress, and leaves every other status', () => {
    expect(statusOnceStarted('backlog')).toBe('in_progress')
    expect(statusOnceStarted('todo')).toBe('in_progress')
    expect(statusOnceStarted('in_progress')).toBe('in_progress')
    expect(statusOnceStarted('done')).toBe('done')
    expect(statusOnceStarted('canceled')).toBe('canceled')
  })
})

describe('inView', () => {
  it('shows every issue in all, those to do or in progress in active, and the backlog in backlog', () => {
    expect(inView({ status: 'canceled' }, 'all')).toBe(true)
    expect(inView({ status: 'todo' }, 'active')).toBe(true)
    expect(inView({ status: 'in_progress' }, 'active')).toBe(true)
    expect(inView({ status: 'backlog' }, 'active')).toBe(false)
    expect(inView({ status: 'done' }, 'active')).toBe(false)
    expect(inView({ status: 'backlog' }, 'backlog')).toBe(true)
    expect(inView({ status: 'todo' }, 'backlog')).toBe(false)
  })
})

describe('issueGroups', () => {
  const issues = [
    issue(1, { status: 'todo', priority: 0, createdAt: 100 }),
    issue(2, { status: 'todo', priority: 3, createdAt: 50 }),
    issue(3, { status: 'todo', priority: 1, createdAt: 10 }),
    issue(4, { status: 'todo', priority: 3, createdAt: 60 }),
    issue(5, { status: 'done', completedAt: 400, priority: 1 }),
    issue(6, { status: 'done', completedAt: 900 }),
    issue(7, { status: 'in_progress' }),
    issue(8, { status: 'canceled', completedAt: 100 }),
    issue(9, { status: 'todo', priority: 0, createdAt: 100 }),
  ]

  it('groups by status, the closest to done first, then done and canceled, without empty groups', () => {
    expect(issueGroups(issues, 'all').map((group) => group.status)).toEqual([
      'in_progress',
      'todo',
      'done',
      'canceled',
    ])
  })

  it('orders by priority, urgent first and none last, then newest first, then the later created', () => {
    const todo = issueGroups(issues, 'all').find((group) => group.status === 'todo')
    expect(todo?.issues.map(({ id }) => id)).toEqual([3, 4, 2, 9, 1])
  })

  it('orders completed issues by when they were completed, the most recent first', () => {
    const done = issueGroups(issues, 'all').find((group) => group.status === 'done')
    expect(done?.issues.map(({ id }) => id)).toEqual([6, 5])
  })

  it('shows only the groups of the view', () => {
    expect(issueGroups(issues, 'active').map((group) => group.status)).toEqual([
      'in_progress',
      'todo',
    ])
    expect(issueGroups(issues, 'backlog')).toEqual([])
  })

  it('lists the issues of a view one after another, as the list shows them', () => {
    expect(listOrder(issues, 'all').map(({ id }) => id)).toEqual([7, 3, 4, 2, 9, 1, 6, 5, 8])
    expect(listOrder(issues, 'active').map(({ id }) => id)).toEqual([7, 3, 4, 2, 9, 1])
  })
})

describe('issueIdentifier', () => {
  it('is ISS- and the number, in decimal digits without leading zeros', () => {
    expect(issueIdentifier(1)).toBe('ISS-1')
    expect(issueIdentifier(12)).toBe('ISS-12')
    expect(issueIdentifier(1_000_000)).toBe('ISS-1000000')
  })
})

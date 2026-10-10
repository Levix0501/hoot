import { describe, expect, it } from 'vitest'
import { issuesInState, issueTitle, type Issue } from './issues'

function issue(id: number, changes: Partial<Issue>): Issue {
  return {
    id,
    projectId: 1,
    title: `#${id}`,
    description: '',
    state: 'open',
    createdAt: 0,
    closedAt: null,
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

describe('issuesInState', () => {
  const issues = [
    issue(1, { createdAt: 100 }),
    issue(2, { createdAt: 300, state: 'closed', closedAt: 400 }),
    issue(3, { createdAt: 200, state: 'closed', closedAt: 900 }),
    issue(4, { createdAt: 300 }),
    issue(5, { createdAt: 300 }),
    issue(6, { createdAt: 50, state: 'closed', closedAt: 400 }),
  ]

  it('lists open issues newest first, the later created first when they were created together', () => {
    expect(issuesInState(issues, 'open').map(({ id }) => id)).toEqual([5, 4, 1])
  })

  it('lists closed issues by when they were last closed, the most recent first', () => {
    expect(issuesInState(issues, 'closed').map(({ id }) => id)).toEqual([3, 6, 2])
  })
})

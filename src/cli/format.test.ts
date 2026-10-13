import { describe, expect, it } from 'vitest'
import type { Issue } from '../shared/issues'
import { issueJson, issueListText, issueText, localMinute } from './format'
import { PRIORITY_NAME_LIST, STATUS_NAME_LIST, priorityNamed, statusNamed } from './names'

const issue: Issue = {
  id: 40,
  projectId: 3,
  number: 12,
  title: 'Restore sessions',
  description: '',
  status: 'in_progress',
  priority: 3,
  createdAt: Date.UTC(2026, 9, 12, 6, 3, 7, 89),
  completedAt: null,
}

describe('issueJson', () => {
  it('has the identifier, number, title, description, status and priority names, and the times in UTC', () => {
    expect(issueJson('hoot', issue)).toStrictEqual({
      identifier: 'HOO-12',
      number: 12,
      title: 'Restore sessions',
      description: '',
      status: 'in-progress',
      priority: 'medium',
      createdAt: '2026-10-12T06:03:07.089Z',
      completedAt: null,
    })
    expect(
      issueJson('hoot', { ...issue, status: 'canceled', completedAt: Date.UTC(2026, 9, 13) }),
    ).toMatchObject({ status: 'canceled', completedAt: '2026-10-13T00:00:00.000Z' })
  })
})

describe('issueText', () => {
  it('ends the description with a line break, without adding a second one', () => {
    const created = `Created ${localMinute(issue.createdAt)}`
    expect(issueText('hoot', { ...issue, description: 'One\n\nTwo' })).toBe(
      `HOO-12 Restore sessions\nIn Progress · Medium · ${created}\n\nOne\n\nTwo\n`,
    )
    expect(issueText('hoot', { ...issue, description: 'One\n' })).toBe(
      `HOO-12 Restore sessions\nIn Progress · Medium · ${created}\n\nOne\n`,
    )
  })
})

describe('localMinute', () => {
  it('writes a moment in local time, to the minute', () => {
    const swedish = new Intl.DateTimeFormat('sv-SE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    for (const time of [
      0,
      Date.UTC(2026, 0, 1, 0, 0, 59),
      Date.UTC(2026, 9, 12, 23, 59, 59, 999),
    ]) {
      expect(localMinute(time)).toBe(swedish.format(time))
    }
    expect(localMinute(new Date(2026, 9, 2, 4, 5).getTime())).toBe('2026-10-02 04:05')
  })
})

describe('issueListText', () => {
  it('lines the columns up, and prints nothing for no issues', () => {
    expect(
      issueListText('hoot', [
        { ...issue, number: 9, status: 'todo', priority: 0, title: 'Nine' },
        { ...issue, number: 10, status: 'backlog', priority: 1, title: 'Ten' },
      ]),
    ).toBe('HOO-9   Todo     No priority  Nine\nHOO-10  Backlog  Urgent       Ten\n')
    expect(issueListText('hoot', [])).toBe('')
  })
})

describe('the names of statuses and priorities', () => {
  it('are lower case, with a hyphen for In Progress, in the order of the interface', () => {
    expect(STATUS_NAME_LIST).toEqual(['backlog', 'todo', 'in-progress', 'done', 'canceled'])
    expect(PRIORITY_NAME_LIST).toEqual(['none', 'urgent', 'high', 'medium', 'low'])
    expect(STATUS_NAME_LIST.map(statusNamed)).toEqual([
      'backlog',
      'todo',
      'in_progress',
      'done',
      'canceled',
    ])
    expect(PRIORITY_NAME_LIST.map(priorityNamed)).toEqual([0, 1, 2, 3, 4])
    expect(statusNamed('in_progress')).toBeUndefined()
    expect(priorityNamed('p1')).toBeUndefined()
  })
})

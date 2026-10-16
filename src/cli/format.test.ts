import { describe, expect, it } from 'vitest'
import type { HootIssue, HootProject, RelatedIssue } from '../shared/hoot-cli'
import type { IssueStatus } from '../shared/issues'
import { issueJson, issueListText, issueText, localMinute } from './format'
import { PRIORITY_NAME_LIST, STATUS_NAME_LIST, priorityNamed, statusNamed } from './names'

const issue: HootIssue = {
  id: 12,
  projectId: 3,
  title: 'Restore sessions',
  description: '',
  status: 'in_progress',
  priority: 3,
  createdAt: Date.UTC(2026, 9, 12, 6, 3, 7, 89),
  completedAt: null,
  parent: null,
  subIssues: [],
  blockedBy: [],
  blocking: [],
}

const gamma: HootProject = { id: 3, name: 'gamma' }

/** An issue related to another, in gamma unless said otherwise. */
function related(
  id: number,
  status: IssueStatus,
  project: { id: number; name: string } | null = gamma,
): RelatedIssue {
  return {
    id,
    title: `Issue ${id}`,
    status,
    projectId: project?.id ?? null,
    project: project?.name ?? null,
  }
}

const family: HootIssue = {
  ...issue,
  description: 'About it',
  parent: related(4, 'todo', null),
  subIssues: [
    related(20, 'done'),
    related(21, 'in_progress', { id: 5, name: 'hotel' }),
    related(103, 'canceled'),
    related(22, 'backlog', null),
  ],
}

/** The summary of the sub-issues of an issue with sub-issues of these statuses. */
const percent = (statuses: IssueStatus[]) =>
  issueJson({ ...issue, subIssues: statuses.map((status, index) => related(index, status)) })
    .subIssuesSummary

describe('issueJson', () => {
  it('has the identifier, number, title, description, status and priority names, and the times in UTC', () => {
    expect(issueJson(issue)).toStrictEqual({
      identifier: 'ISS-12',
      number: 12,
      title: 'Restore sessions',
      description: '',
      status: 'in-progress',
      priority: 'medium',
      createdAt: '2026-10-12T06:03:07.089Z',
      completedAt: null,
      parent: null,
      subIssues: [],
      subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 },
      blockedBy: [],
      blocking: [],
    })
    expect(
      issueJson({ ...issue, status: 'canceled', completedAt: Date.UTC(2026, 9, 13) }),
    ).toMatchObject({ status: 'canceled', completedAt: '2026-10-13T00:00:00.000Z' })
  })

  it('has the parent and the sub-issues, in order, and the progress of those not canceled', () => {
    const json = issueJson(family)
    expect(json.parent).toStrictEqual({
      identifier: 'ISS-4',
      number: 4,
      title: 'Issue 4',
      status: 'todo',
      project: null,
    })
    expect(json.subIssues).toStrictEqual([
      { identifier: 'ISS-20', number: 20, title: 'Issue 20', status: 'done', project: 'gamma' },
      {
        identifier: 'ISS-21',
        number: 21,
        title: 'Issue 21',
        status: 'in-progress',
        project: 'hotel',
      },
      {
        identifier: 'ISS-103',
        number: 103,
        title: 'Issue 103',
        status: 'canceled',
        project: 'gamma',
      },
      { identifier: 'ISS-22', number: 22, title: 'Issue 22', status: 'backlog', project: null },
    ])
    expect(json.subIssuesSummary).toStrictEqual({ total: 3, completed: 1, percentCompleted: 33 })
    expect(Object.keys(json.subIssuesSummary)).toEqual(['total', 'completed', 'percentCompleted'])
  })

  it('has the issues it is blocked by and those it blocks, in order, as its sub-issues', () => {
    const json = issueJson({
      ...issue,
      blockedBy: [related(30, 'done'), related(31, 'todo', { id: 5, name: 'hotel' })],
      blocking: [related(32, 'backlog', null)],
    })
    expect(json.blockedBy).toStrictEqual([
      { identifier: 'ISS-30', number: 30, title: 'Issue 30', status: 'done', project: 'gamma' },
      { identifier: 'ISS-31', number: 31, title: 'Issue 31', status: 'todo', project: 'hotel' },
    ])
    expect(json.blocking).toStrictEqual([
      { identifier: 'ISS-32', number: 32, title: 'Issue 32', status: 'backlog', project: null },
    ])
  })

  it('rounds the percentage down, and counts nothing for sub-issues all canceled', () => {
    expect(percent(['done', 'done', 'todo'])).toEqual({
      total: 3,
      completed: 2,
      percentCompleted: 66,
    })
    expect(percent(['done', 'canceled'])).toEqual({
      total: 1,
      completed: 1,
      percentCompleted: 100,
    })
    expect(percent(['canceled', 'canceled'])).toEqual({
      total: 0,
      completed: 0,
      percentCompleted: 0,
    })
  })
})

describe('issueText', () => {
  it('ends the description with a line break, without adding a second one', () => {
    const created = `Created ${localMinute(issue.createdAt)}`
    expect(issueText({ ...issue, description: 'One\n\nTwo' }, gamma)).toBe(
      `ISS-12 Restore sessions\nIn Progress · Medium · ${created}\n\nOne\n\nTwo\n`,
    )
    expect(issueText({ ...issue, description: 'One\n' }, gamma)).toBe(
      `ISS-12 Restore sessions\nIn Progress · Medium · ${created}\n\nOne\n`,
    )
  })

  it('names the parent under the properties, and lists the sub-issues after the description', () => {
    const created = `Created ${localMinute(issue.createdAt)}`
    expect(issueText(family, gamma)).toBe(
      [
        'ISS-12 Restore sessions',
        `In Progress · Medium · ${created}`,
        'Sub-issue of ISS-4 Issue 4 (Todo · No project)',
        '',
        'About it',
        '',
        'Sub-issues · 1/3 (33%)',
        'Done         ISS-20   Issue 20',
        'In Progress  ISS-21   Issue 21 (hotel)',
        'Canceled     ISS-103  Issue 103',
        'Backlog      ISS-22   Issue 22 (No project)',
        '',
      ].join('\n'),
    )
  })

  it("names the project of a parent only when it is not the session's, and needs no description", () => {
    const created = `Created ${localMinute(issue.createdAt)}`
    expect(
      issueText({ ...issue, parent: related(4, 'done'), subIssues: [related(5, 'todo')] }, gamma),
    ).toBe(
      [
        'ISS-12 Restore sessions',
        `In Progress · Medium · ${created}`,
        'Sub-issue of ISS-4 Issue 4 (Done)',
        '',
        'Sub-issues · 0/1 (0%)',
        'Todo  ISS-5  Issue 5',
        '',
      ].join('\n'),
    )
  })
})

describe('issueText with dependencies', () => {
  it('lists the issues it is blocked by and those it blocks last, each in a section of its own', () => {
    const created = `Created ${localMinute(issue.createdAt)}`
    expect(
      issueText(
        {
          ...family,
          blockedBy: [
            related(30, 'done'),
            related(131, 'in_progress', { id: 5, name: 'hotel' }),
            related(32, 'todo', null),
          ],
          blocking: [related(33, 'backlog')],
        },
        gamma,
      ),
    ).toBe(
      [
        'ISS-12 Restore sessions',
        `In Progress · Medium · ${created}`,
        'Sub-issue of ISS-4 Issue 4 (Todo · No project)',
        '',
        'About it',
        '',
        'Sub-issues · 1/3 (33%)',
        'Done         ISS-20   Issue 20',
        'In Progress  ISS-21   Issue 21 (hotel)',
        'Canceled     ISS-103  Issue 103',
        'Backlog      ISS-22   Issue 22 (No project)',
        '',
        'Blocked by',
        'Done         ISS-30   Issue 30',
        'In Progress  ISS-131  Issue 131 (hotel)',
        'Todo         ISS-32   Issue 32 (No project)',
        '',
        'Blocking',
        'Backlog  ISS-33  Issue 33',
        '',
      ].join('\n'),
    )
  })

  it('leaves out a section without issues', () => {
    const created = `Created ${localMinute(issue.createdAt)}`
    expect(issueText({ ...issue, blocking: [related(5, 'todo')] }, gamma)).toBe(
      `ISS-12 Restore sessions\nIn Progress · Medium · ${created}\n\nBlocking\nTodo  ISS-5  Issue 5\n`,
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
      issueListText([
        { ...issue, id: 9, status: 'todo', priority: 0, title: 'Nine' },
        { ...issue, id: 10, status: 'backlog', priority: 1, title: 'Ten' },
      ]),
    ).toBe('ISS-9   Todo     No priority  Nine\nISS-10  Backlog  Urgent       Ten\n')
    expect(issueListText([])).toBe('')
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

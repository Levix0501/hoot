import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ISSUE_STATUSES, type NewIssue } from '../../shared/issues'
import { databaseFile, openDatabase } from '../database/database'
import { ProjectStore } from '../projects/project-store'
import { IssueStore } from './issue-store'

let directory: string
let file: string
let clock: number
const databases: DatabaseSync[] = []

/** Opens the database the way Hoot does when it starts, with a clock the test sets. */
function start(): { projects: ProjectStore; issues: IssueStore } {
  const db = openDatabase(file)
  databases.push(db)
  return { projects: new ProjectStore(db), issues: new IssueStore(db, () => clock) }
}

/** A new issue in the backlog, without a priority. */
function newIssue(projectId: number, title: string, changes: Partial<NewIssue> = {}): NewIssue {
  return { projectId, title, description: '', status: 'backlog', priority: 0, ...changes }
}

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-issues-'))
  file = databaseFile(directory)
  clock = 1_000_000
})

afterEach(() => {
  for (const db of databases.splice(0)) db.close()
  fs.rmSync(directory, { recursive: true, force: true })
})

describe('IssueStore', () => {
  it('creates issues, with the title trimmed and the description, status and priority as given', () => {
    const { projects, issues } = start()
    const project = projects.add('/work/alpha').project
    const created = issues.create(
      newIssue(project.id, ' \t Restore sessions  ', {
        description: '  line one\n\nline two  ',
        status: 'todo',
        priority: 2,
      }),
    )
    expect(created).toEqual({
      id: expect.any(Number),
      projectId: project.id,
      number: 1,
      title: 'Restore sessions',
      description: '  line one\n\nline two  ',
      status: 'todo',
      priority: 2,
      createdAt: 1_000_000,
      completedAt: null,
    })
    clock += 1_000
    const second = issues.create(newIssue(project.id, 'Second'))
    expect(second).toMatchObject({ number: 2, description: '', status: 'backlog', priority: 0 })
    expect(issues.list(project.id)).toEqual([created, second])
  })

  it('records when an issue created done or canceled was completed', () => {
    const { projects, issues } = start()
    const project = projects.add('/work/alpha').project
    expect(issues.create(newIssue(project.id, 'Done', { status: 'done' }))?.completedAt).toBe(
      1_000_000,
    )
    // Every status the shared code knows, the database accepts.
    for (const status of ISSUE_STATUSES) {
      expect(issues.create(newIssue(project.id, status, { status }))?.status).toBe(status)
    }
  })

  it('refuses a title of nothing but whitespace, and a project not in the list', () => {
    const { projects, issues } = start()
    const project = projects.add('/work/alpha').project
    expect(() => issues.create(newIssue(project.id, ' \t '))).toThrow('An issue needs a title.')
    expect(issues.create(newIssue(project.id + 1, 'Lost'))).toBeNull()
    expect(issues.list(project.id)).toEqual([])
    // A refused issue takes no number.
    expect(issues.create(newIssue(project.id, 'First'))?.number).toBe(1)
  })

  it('numbers the issues of each project on its own, and never gives a number again', () => {
    const { projects, issues } = start()
    const g = projects.add('/work/g').project
    const h = projects.add('/work/h').project
    expect(issues.create(newIssue(g.id, 'G one'))?.number).toBe(1)
    expect(issues.create(newIssue(h.id, 'H one'))?.number).toBe(1)
    const two = issues.create(newIssue(g.id, 'G two'))!
    expect(two.number).toBe(2)
    issues.delete(two.id)
    expect(issues.create(newIssue(g.id, 'G three'))?.number).toBe(3)
    projects.remove('/work/g')
    projects.add('/work/g')
    expect(start().issues.create(newIssue(g.id, 'G four'))?.number).toBe(4)
  })

  it('finds an issue by its number in its project, while the project is in the list', () => {
    const { projects, issues } = start()
    const g = projects.add('/work/g').project
    const h = projects.add('/work/h').project
    const gOne = issues.create(newIssue(g.id, 'G one'))!
    const gTwo = issues.create(newIssue(g.id, 'G two'))!
    const hOne = issues.create(newIssue(h.id, 'H one'))!
    expect(issues.byNumber(g.id, 1)).toEqual(gOne)
    expect(issues.byNumber(g.id, 2)).toEqual(gTwo)
    expect(issues.byNumber(h.id, 1)).toEqual(hOne)
    expect(issues.byNumber(h.id, 2)).toBeNull()
    expect(issues.byNumber(g.id, 0)).toBeNull()
    issues.delete(gTwo.id)
    expect(issues.byNumber(g.id, 2)).toBeNull()
    projects.remove('/work/g')
    expect(issues.byNumber(g.id, 1)).toBeNull()
  })

  it('changes only what it is given', () => {
    const { projects, issues } = start()
    const project = projects.add('/work/alpha').project
    const issue = issues.create(newIssue(project.id, 'Alpha', { description: 'Body' }))!
    clock += 5_000
    const renamed = issues.update(issue.id, { title: ' Beta ' })
    expect(renamed).toEqual({ ...issue, title: 'Beta' })
    expect(issues.update(issue.id, { description: 'New body\n' })).toEqual({
      ...renamed,
      description: 'New body\n',
    })
    expect(issues.update(issue.id, { priority: 1 })).toMatchObject({
      title: 'Beta',
      description: 'New body\n',
      priority: 1,
      status: 'backlog',
    })
    expect(issues.update(issue.id, {})).toEqual(issues.get(issue.id))
    expect(() => issues.update(issue.id, { title: '  ' })).toThrow('An issue needs a title.')
    expect(issues.get(issue.id)?.title).toBe('Beta')
    expect(issues.update(issue.id + 1, { title: 'Gone' })).toBeNull()
  })

  it('records when an issue last became done or canceled, and forgets it when it is reopened', () => {
    const { projects, issues } = start()
    const project = projects.add('/work/alpha').project
    const issue = issues.create(newIssue(project.id, 'P'))!
    clock = 2_000_000
    expect(issues.update(issue.id, { status: 'in_progress' })?.completedAt).toBeNull()
    expect(issues.update(issue.id, { status: 'done' })?.completedAt).toBe(2_000_000)
    clock = 3_000_000
    // Choosing the status it has changes nothing.
    expect(issues.update(issue.id, { status: 'done' })?.completedAt).toBe(2_000_000)
    expect(issues.update(issue.id, { title: 'Q' })?.completedAt).toBe(2_000_000)
    expect(issues.update(issue.id, { status: 'canceled' })?.completedAt).toBe(3_000_000)
    expect(issues.update(issue.id, { status: 'todo' })?.completedAt).toBeNull()
    clock = 4_000_000
    expect(issues.update(issue.id, { status: 'done' })).toMatchObject({
      status: 'done',
      completedAt: 4_000_000,
      createdAt: 1_000_000,
      title: 'Q',
    })
  })

  it('deletes an issue for good', () => {
    const { projects, issues } = start()
    const project = projects.add('/work/alpha').project
    const doomed = issues.create(newIssue(project.id, 'Doomed'))!
    const kept = issues.create(newIssue(project.id, 'Kept'))!
    expect(issues.delete(doomed.id)).toBe(true)
    expect(issues.delete(doomed.id)).toBe(false)
    expect(issues.get(doomed.id)).toBeNull()
    expect(start().issues.list(project.id)).toEqual([kept])
    // Its id is not given to another issue either.
    expect(issues.create(newIssue(project.id, 'Later'))!.id).toBeGreaterThan(kept.id)
  })

  it('keeps the issues of a removed project, which come back with it', () => {
    const { projects, issues } = start()
    const project = projects.add('/work/alpha').project
    const open = issues.create(newIssue(project.id, 'Open one', { description: 'a' }))!
    const done = issues.create(newIssue(project.id, 'Done one', { status: 'done' }))!
    projects.remove('/work/alpha')
    // Out of reach while the project is not in the list.
    expect(issues.list(project.id)).toEqual([])
    expect(issues.get(open.id)).toBeNull()
    expect(issues.update(open.id, { status: 'done' })).toBeNull()
    expect(issues.delete(open.id)).toBe(false)
    expect(issues.create(newIssue(project.id, 'New'))).toBeNull()

    expect(projects.add('/work/alpha').project.id).toBe(project.id)
    expect(start().issues.list(project.id)).toEqual([open, done])
  })

  it('keeps every issue across starts', () => {
    const first = start()
    const g = first.projects.add('/work/g').project
    const h = first.projects.add('/work/h').project
    const one = first.issues.create(newIssue(g.id, 'First', { description: 'Body one' }))!
    clock += 1_000
    const other = first.issues.create(newIssue(h.id, 'Other', { priority: 4 }))!
    const again = start()
    expect(again.issues.list(g.id)).toEqual([one])
    expect(again.issues.list(h.id)).toEqual([other])
  })
})

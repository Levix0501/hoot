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
function newIssue(
  projectId: number | null,
  title: string,
  changes: Partial<NewIssue> = {},
): NewIssue {
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
  it('creates issues, with the title trimmed and the description, status, priority and project as given', () => {
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
      id: 1,
      projectId: project.id,
      title: 'Restore sessions',
      description: '  line one\n\nline two  ',
      status: 'todo',
      priority: 2,
      createdAt: 1_000_000,
      completedAt: null,
    })
    clock += 1_000
    const second = issues.create(newIssue(null, 'Second'))
    expect(second).toEqual({
      id: 2,
      projectId: null,
      title: 'Second',
      description: '',
      status: 'backlog',
      priority: 0,
      createdAt: 1_001_000,
      completedAt: null,
    })
    expect(issues.list()).toEqual([created, second])
  })

  it('creates issues without a project while no project is in the list', () => {
    const { issues } = start()
    const solo = issues.create(newIssue(null, 'Solo'))
    expect(solo).toMatchObject({ id: 1, projectId: null, title: 'Solo' })
    expect(issues.list()).toEqual([solo])
    expect(issues.get(1)).toEqual(solo)
  })

  it('records when an issue created done or canceled was completed', () => {
    const { projects, issues } = start()
    const project = projects.add('/work/alpha').project
    expect(issues.create(newIssue(project.id, 'Done', { status: 'done' }))?.completedAt).toBe(
      1_000_000,
    )
    // Every status the shared code knows, the database accepts.
    for (const status of ISSUE_STATUSES) {
      expect(issues.create(newIssue(null, status, { status }))?.status).toBe(status)
    }
  })

  it('refuses a title of nothing but whitespace, and a project not in the list', () => {
    const { projects, issues } = start()
    const project = projects.add('/work/alpha').project
    expect(() => issues.create(newIssue(project.id, ' \t '))).toThrow('An issue needs a title.')
    expect(() => issues.create(newIssue(null, ''))).toThrow('An issue needs a title.')
    expect(issues.create(newIssue(project.id + 1, 'Lost'))).toBeNull()
    projects.remove('/work/alpha')
    expect(issues.create(newIssue(project.id, 'Removed'))).toBeNull()
    expect(issues.list()).toEqual([])
    // A refused issue takes no number.
    expect(issues.create(newIssue(null, 'First'))?.id).toBe(1)
  })

  it('numbers every issue after the highest number given before, whatever its project', () => {
    const { projects, issues } = start()
    const g = projects.add('/work/g').project
    const h = projects.add('/work/h').project
    expect(issues.create(newIssue(g.id, 'G one'))?.id).toBe(1)
    expect(issues.create(newIssue(h.id, 'H one'))?.id).toBe(2)
    expect(issues.create(newIssue(null, 'No project'))?.id).toBe(3)
    // Not even the number of a deleted issue is given again.
    expect(issues.delete(3)).toBe(true)
    expect(issues.create(newIssue(g.id, 'G two'))?.id).toBe(4)
    // Nor are those of a removed project's issues, which stay out of reach meanwhile.
    expect(issues.create(newIssue(h.id, 'H two'))?.id).toBe(5)
    projects.remove('/work/h')
    expect(issues.create(newIssue(null, 'While H is gone'))?.id).toBe(6)
    // Also after the highest numbered issue is deleted, and after a restart.
    issues.delete(6)
    expect(start().issues.create(newIssue(null, 'After a restart'))?.id).toBe(7)
  })

  it("reads a project's issues, and finds an issue only in its project, while the project is in the list", () => {
    const { projects, issues } = start()
    const g = projects.add('/work/g').project
    const h = projects.add('/work/h').project
    const gOne = issues.create(newIssue(g.id, 'G one'))!
    const hOne = issues.create(newIssue(h.id, 'H one'))!
    const loose = issues.create(newIssue(null, 'No project'))!
    const gTwo = issues.create(newIssue(g.id, 'G two'))!
    expect(issues.listInProject(g.id)).toEqual([gOne, gTwo])
    expect(issues.listInProject(h.id)).toEqual([hOne])
    expect(issues.getInProject(g.id, gOne.id)).toEqual(gOne)
    expect(issues.getInProject(g.id, gTwo.id)).toEqual(gTwo)
    expect(issues.getInProject(h.id, hOne.id)).toEqual(hOne)
    // Not an issue of another project or of none, nor a number no issue has.
    expect(issues.getInProject(g.id, hOne.id)).toBeNull()
    expect(issues.getInProject(g.id, loose.id)).toBeNull()
    expect(issues.getInProject(g.id, 0)).toBeNull()
    expect(issues.getInProject(g.id, 99)).toBeNull()
    // An issue that moves is found in its new project only.
    issues.update(gTwo.id, { projectId: h.id })
    expect(issues.getInProject(g.id, gTwo.id)).toBeNull()
    expect(issues.getInProject(h.id, gTwo.id)).toMatchObject({ id: gTwo.id, projectId: h.id })
    expect(issues.listInProject(g.id)).toEqual([gOne])
    issues.delete(hOne.id)
    expect(issues.getInProject(h.id, hOne.id)).toBeNull()
    projects.remove('/work/g')
    expect(issues.listInProject(g.id)).toEqual([])
    expect(issues.getInProject(g.id, gOne.id)).toBeNull()
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
      projectId: project.id,
    })
    expect(issues.update(issue.id, {})).toEqual(issues.get(issue.id))
    expect(() => issues.update(issue.id, { title: '  ' })).toThrow('An issue needs a title.')
    expect(issues.get(issue.id)?.title).toBe('Beta')
    expect(issues.update(issue.id + 1, { title: 'Gone' })).toBeNull()
  })

  it('moves an issue to another project or to none, keeping its number and the rest', () => {
    const { projects, issues } = start()
    const g = projects.add('/work/g').project
    const h = projects.add('/work/h').project
    const issue = issues.create(
      newIssue(g.id, 'Move me', { description: 'Body', status: 'todo', priority: 3 }),
    )!
    const moved = issues.update(issue.id, { projectId: h.id })
    expect(moved).toEqual({ ...issue, projectId: h.id })
    const unassigned = issues.update(issue.id, { projectId: null })
    expect(unassigned).toEqual({ ...issue, projectId: null })
    // Left out, the project stays as it is.
    expect(issues.update(issue.id, { title: 'Still none' })?.projectId).toBeNull()
    expect(issues.update(issue.id, { projectId: g.id, status: 'done' })).toMatchObject({
      id: issue.id,
      projectId: g.id,
      status: 'done',
      completedAt: 1_000_000,
    })
    expect(start().issues.get(issue.id)?.projectId).toBe(g.id)
  })

  it('refuses to move an issue to a project not in the list, changing nothing', () => {
    const { projects, issues } = start()
    const g = projects.add('/work/g').project
    const h = projects.add('/work/h').project
    projects.remove('/work/h')
    const issue = issues.create(newIssue(g.id, 'Stay'))!
    expect(() => issues.update(issue.id, { projectId: h.id, title: 'Changed' })).toThrow(
      'The project is not in the list.',
    )
    expect(() => issues.update(issue.id, { projectId: h.id + 1 })).toThrow(
      'The project is not in the list.',
    )
    expect(issues.get(issue.id)).toEqual(issue)
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
    const kept = issues.create(newIssue(null, 'Kept'))!
    const alsoDoomed = issues.create(newIssue(null, 'Also doomed'))!
    expect(issues.delete(doomed.id)).toBe(true)
    expect(issues.delete(doomed.id)).toBe(false)
    expect(issues.delete(alsoDoomed.id)).toBe(true)
    expect(issues.get(doomed.id)).toBeNull()
    expect(start().issues.list()).toEqual([kept])
  })

  it('keeps the issues of a removed project, which come back with it as they were', () => {
    const { projects, issues } = start()
    const project = projects.add('/work/alpha').project
    const open = issues.create(
      newIssue(project.id, 'Open one', { description: 'a', status: 'todo', priority: 2 }),
    )!
    const done = issues.create(newIssue(project.id, 'Done one', { status: 'done' }))!
    const loose = issues.create(newIssue(null, 'Without a project'))!
    projects.remove('/work/alpha')
    // Out of reach while the project is not in the list; those without a project are not.
    expect(issues.list()).toEqual([loose])
    expect(issues.get(open.id)).toBeNull()
    expect(issues.update(open.id, { status: 'done' })).toBeNull()
    expect(issues.update(open.id, { projectId: null })).toBeNull()
    expect(issues.delete(open.id)).toBe(false)
    expect(issues.get(loose.id)).toEqual(loose)

    expect(projects.add('/work/alpha').project.id).toBe(project.id)
    expect(start().issues.list()).toEqual([open, done, loose])
  })

  it('keeps every issue across starts', () => {
    const first = start()
    const g = first.projects.add('/work/g').project
    const one = first.issues.create(newIssue(g.id, 'First', { description: 'Body one' }))!
    clock += 1_000
    const other = first.issues.create(newIssue(null, 'Other', { priority: 4 }))!
    expect(start().issues.list()).toEqual([one, other])
  })
})

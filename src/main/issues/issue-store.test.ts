import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
  it('creates open issues, with the title trimmed and the description as entered', () => {
    const { projects, issues } = start()
    const project = projects.add('/work/alpha').project
    const created = issues.create({
      projectId: project.id,
      title: ' \t Restore sessions  ',
      description: '  line one\n\nline two  ',
    })
    expect(created).toEqual({
      id: expect.any(Number),
      projectId: project.id,
      title: 'Restore sessions',
      description: '  line one\n\nline two  ',
      state: 'open',
      createdAt: 1_000_000,
      closedAt: null,
    })
    clock += 1_000
    const empty = issues.create({ projectId: project.id, title: 'Second', description: '' })
    expect(empty?.description).toBe('')
    expect(issues.list(project.id)).toEqual([created, empty])
  })

  it('refuses a title of nothing but whitespace, and a project not in the list', () => {
    const { projects, issues } = start()
    const project = projects.add('/work/alpha').project
    expect(() => issues.create({ projectId: project.id, title: ' \t ', description: 'x' })).toThrow(
      'An issue needs a title.',
    )
    expect(issues.create({ projectId: project.id + 1, title: 'Lost', description: '' })).toBeNull()
    expect(issues.list(project.id)).toEqual([])
  })

  it('edits the title and description, and nothing else', () => {
    const { projects, issues } = start()
    const project = projects.add('/work/alpha').project
    const issue = issues.create({ projectId: project.id, title: 'Alpha', description: 'Body' })!
    clock += 5_000
    expect(issues.update(issue.id, { title: ' Beta ', description: 'New body\n' })).toEqual({
      ...issue,
      title: 'Beta',
      description: 'New body\n',
    })
    expect(() => issues.update(issue.id, { title: '  ', description: '' })).toThrow(
      'An issue needs a title.',
    )
    expect(issues.get(issue.id)?.title).toBe('Beta')
    expect(issues.update(issue.id + 1, { title: 'Gone', description: '' })).toBeNull()
  })

  it('records when an issue was last closed, and keeps the rest when it opens again', () => {
    const { projects, issues } = start()
    const project = projects.add('/work/alpha').project
    const issue = issues.create({ projectId: project.id, title: 'P', description: 'd' })!
    clock = 2_000_000
    const closed = issues.setState(issue.id, 'closed')
    expect(closed).toEqual({ ...issue, state: 'closed', closedAt: 2_000_000 })
    clock = 3_000_000
    // Closing a closed issue changes nothing.
    expect(issues.setState(issue.id, 'closed')).toEqual(closed)
    const reopened = issues.setState(issue.id, 'open')
    expect(reopened).toEqual({ ...issue, state: 'open', closedAt: 2_000_000 })
    clock = 4_000_000
    expect(issues.setState(issue.id, 'closed')).toEqual({
      ...issue,
      state: 'closed',
      closedAt: 4_000_000,
    })
    expect(issues.setState(issue.id + 1, 'closed')).toBeNull()
  })

  it('deletes an issue for good', () => {
    const { projects, issues } = start()
    const project = projects.add('/work/alpha').project
    const doomed = issues.create({ projectId: project.id, title: 'Doomed', description: '' })!
    const kept = issues.create({ projectId: project.id, title: 'Kept', description: '' })!
    expect(issues.delete(doomed.id)).toBe(true)
    expect(issues.delete(doomed.id)).toBe(false)
    expect(issues.get(doomed.id)).toBeNull()
    expect(start().issues.list(project.id)).toEqual([kept])
  })

  it('keeps the issues of a removed project, which come back with it', () => {
    const { projects, issues } = start()
    const project = projects.add('/work/alpha').project
    const open = issues.create({ projectId: project.id, title: 'Open one', description: 'a' })!
    const closed = issues.setState(
      issues.create({ projectId: project.id, title: 'Closed one', description: 'b' })!.id,
      'closed',
    )!
    projects.remove('/work/alpha')
    // Out of reach while the project is not in the list.
    expect(issues.list(project.id)).toEqual([])
    expect(issues.get(open.id)).toBeNull()
    expect(issues.setState(open.id, 'closed')).toBeNull()
    expect(issues.delete(open.id)).toBe(false)
    expect(issues.create({ projectId: project.id, title: 'New', description: '' })).toBeNull()

    expect(projects.add('/work/alpha').project.id).toBe(project.id)
    expect(start().issues.list(project.id)).toEqual([open, closed])
  })

  it('keeps every issue across starts', () => {
    const first = start()
    const g = first.projects.add('/work/g').project
    const h = first.projects.add('/work/h').project
    const one = first.issues.create({ projectId: g.id, title: 'First', description: 'Body one' })!
    clock += 1_000
    const other = first.issues.create({ projectId: h.id, title: 'Other', description: '' })!
    const again = start()
    expect(again.issues.list(g.id)).toEqual([one])
    expect(again.issues.list(h.id)).toEqual([other])
  })
})

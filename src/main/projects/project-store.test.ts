import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { databaseFile, openDatabase } from '../database/database'
import { ProjectStore } from './project-store'

let directory: string
let file: string
const databases: DatabaseSync[] = []

/** Opens the database the way Hoot does when it starts. */
function start(): ProjectStore {
  const db = openDatabase(file)
  databases.push(db)
  return new ProjectStore(db)
}

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-projects-'))
  file = databaseFile(directory)
})

afterEach(() => {
  for (const db of databases.splice(0)) db.close()
  fs.rmSync(directory, { recursive: true, force: true })
})

describe('ProjectStore', () => {
  it('starts empty, also with a projects.json beside the database', () => {
    fs.writeFileSync(
      path.join(directory, 'projects.json'),
      JSON.stringify({ projects: [{ root: '/work/alpha' }] }),
    )
    expect(start().list()).toEqual([])
  })

  it('adds a project once, at the end of the list, and names it after its folder', () => {
    const store = start()
    const alpha = store.add('/work/alpha')
    expect(alpha).toEqual({
      added: true,
      project: { id: expect.any(Number), root: '/work/alpha', name: 'alpha' },
    })
    const beta = store.add('/work/beta').project
    expect(store.add('/work/alpha')).toEqual({ added: false, project: alpha.project })
    expect(store.list()).toEqual([alpha.project, beta])
    expect(beta.id).not.toBe(alpha.project.id)
    expect(store.find('/work/beta')).toEqual(beta)
    expect(store.find('/work/gamma')).toBeUndefined()
  })

  it('keeps the list and its order across starts', () => {
    const first = start()
    for (const root of ['/work/c', '/work/a', '/work/b']) first.add(root)
    expect(first.remove('/work/a')).toBe(true)
    expect(first.remove('/work/missing')).toBe(false)
    expect(
      start()
        .list()
        .map((project) => project.root),
    ).toEqual(['/work/c', '/work/b'])
  })

  it('brings a removed project back with its id, at the end of the list', () => {
    const store = start()
    const alpha = store.add('/work/alpha').project
    store.add('/work/beta')
    expect(store.remove('/work/alpha')).toBe(true)
    expect(store.remove('/work/alpha')).toBe(false)
    expect(store.find('/work/alpha')).toBeUndefined()
    expect(store.list().map((project) => project.root)).toEqual(['/work/beta'])

    expect(store.add('/work/alpha')).toEqual({ added: true, project: alpha })
    expect(start().list()).toEqual([expect.objectContaining({ root: '/work/beta' }), alpha])
  })
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore } from './project-store'

let directory: string
let file: string

beforeEach(() => {
  directory = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-store-')), 'nested')
  file = path.join(directory, 'projects.json')
})

afterEach(() => fs.rmSync(path.dirname(directory), { recursive: true, force: true }))

describe('ProjectStore', () => {
  it('starts empty when nothing was saved', () => {
    expect(new ProjectStore(directory).list()).toEqual([])
  })

  it('adds a project once and names it after its folder', () => {
    const store = new ProjectStore(directory)
    expect(store.add('/work/alpha')).toEqual({
      added: true,
      project: { root: '/work/alpha', name: 'alpha' },
    })
    expect(store.add('/work/alpha').added).toBe(false)
    expect(store.list()).toEqual([{ root: '/work/alpha', name: 'alpha' }])
  })

  it('keeps additions and removals across instances', () => {
    const first = new ProjectStore(directory)
    first.add('/work/alpha')
    first.add('/work/beta')
    expect(first.remove('/work/beta')).toBe(true)
    expect(first.remove('/work/missing')).toBe(false)

    expect(new ProjectStore(directory).list()).toEqual([{ root: '/work/alpha', name: 'alpha' }])
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({
      projects: [{ root: '/work/alpha' }],
    })
  })

  it('treats an unreadable file as an empty list', () => {
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(file, '{ not json')
    expect(new ProjectStore(directory).list()).toEqual([])
  })

  it('ignores malformed and duplicate entries', () => {
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(
      file,
      JSON.stringify({ projects: [{ root: '/a' }, { root: 3 }, null, { root: '/a' }] }),
    )
    expect(new ProjectStore(directory).list()).toEqual([{ root: '/a', name: 'a' }])
  })
})

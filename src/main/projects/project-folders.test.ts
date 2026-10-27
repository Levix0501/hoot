import fs from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ProjectFolderInfo } from '../../shared/project-folders'
import type { GitContext } from '../worktrees/repositories'
import { addBranch, git, makeRepository, makeSandbox } from '../worktrees/test-support'
import { ProjectFolders } from './project-folders'

describe('ProjectFolders', () => {
  let root: string
  let context: GitContext
  let project: string
  let folders: ProjectFolders
  /** What `changed` reported, in order. */
  let reported: Array<[string, ProjectFolderInfo]>
  /** How many times Git was asked, by how often the tests' context was resolved. */
  let asked: number

  beforeEach(() => {
    ;({ root, context } = makeSandbox('hoot-project-folders-'))
    project = makeRepository(path.join(root, 'project'))
    addBranch(project, 'dev')
    reported = []
    asked = 0
    folders = new ProjectFolders({
      gitContext: async () => {
        asked++
        return context
      },
      intervalMs: 20,
    })
    folders.on('changed', (projectRoot, folder) => reported.push([projectRoot, folder]))
  })

  afterEach(() => {
    folders.dispose()
    fs.rmSync(root, { recursive: true, force: true })
  })

  /** Waits until `changed` last reported what `expected` says, failing after a while. */
  const reportedAs = async (expected: ProjectFolderInfo) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (JSON.stringify(reported.at(-1)?.[1]) === JSON.stringify(expected)) return
      await delay(10)
    }
    expect(reported.at(-1)?.[1]).toEqual(expected)
  }

  it('reports the branch checked out once it first looks', async () => {
    folders.addProject(project)
    expect(await folders.list()).toEqual({
      [project]: { missing: false, branch: 'main', displayName: 'main' },
    })
    expect(reported).toEqual([[project, { missing: false, branch: 'main', displayName: 'main' }]])
  })

  it('follows the branch and the commit checked out, however they change, by itself', async () => {
    folders.addProject(project)
    await folders.list()

    git(project, 'checkout', '-q', 'dev')
    await reportedAs({ missing: false, branch: 'dev', displayName: 'dev' })

    // On no branch, the commit, abbreviated as for a worktree row.
    git(project, 'checkout', '-q', '--detach', 'main')
    const first = git(project, 'rev-parse', '--short', 'HEAD')
    await reportedAs({ missing: false, branch: null, displayName: first })
    git(project, 'checkout', '-q', '--detach', 'dev')
    const second = git(project, 'rev-parse', '--short', 'HEAD')
    expect(second).not.toBe(first)
    await reportedAs({ missing: false, branch: null, displayName: second })

    git(project, 'checkout', '-q', 'main')
    await reportedAs({ missing: false, branch: 'main', displayName: 'main' })
    // Each change is reported once.
    expect(reported.map(([, folder]) => folder.displayName)).toEqual([
      'main',
      'dev',
      first,
      second,
      'main',
    ])
  })

  it('asks Git only when HEAD changes, or when it is asked to look again', async () => {
    folders.addProject(project)
    await folders.list()
    const before = asked
    await delay(150)
    expect(asked).toBe(before)

    expect(await folders.current(project)).toEqual({
      missing: false,
      branch: 'main',
      displayName: 'main',
    })
    expect(asked).toBe(before + 1)
    expect(reported).toHaveLength(1)
  })

  it('says when the folder is gone, and reads it again once it is back', async () => {
    folders.addProject(project)
    await folders.list()

    const moved = path.join(root, 'moved')
    fs.renameSync(project, moved)
    await reportedAs({ missing: true, branch: 'main', displayName: 'main' })
    expect(await folders.current(project)).toMatchObject({ missing: true })

    // Changed while it was away.
    git(moved, 'checkout', '-q', 'dev')
    fs.renameSync(moved, project)
    await reportedAs({ missing: false, branch: 'dev', displayName: 'dev' })
  })

  it('finds HEAD where a .git file says the repository is', async () => {
    const separate = path.join(root, 'separate')
    fs.mkdirSync(separate)
    git(separate, 'init', '-q', '-b', 'trunk', '--separate-git-dir', path.join(root, 'store.git'))
    fs.writeFileSync(path.join(separate, 'a.txt'), 'a\n')
    git(separate, 'add', '.')
    git(separate, 'commit', '-q', '-m', 'a')
    expect(fs.statSync(path.join(separate, '.git')).isFile()).toBe(true)

    folders.addProject(separate)
    expect((await folders.list())[separate]).toEqual({
      missing: false,
      branch: 'trunk',
      displayName: 'trunk',
    })
    git(separate, 'checkout', '-q', '-b', 'other')
    await reportedAs({ missing: false, branch: 'other', displayName: 'other' })
  })

  it('stops reporting a project removed from the list', async () => {
    folders.setProjects([project])
    await folders.list()
    folders.setProjects([])
    git(project, 'checkout', '-q', 'dev')
    await delay(150)
    expect(reported).toHaveLength(1)
    expect(await folders.list()).toEqual({})
    expect(await folders.current(project)).toBeNull()
  })
})

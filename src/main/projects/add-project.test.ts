import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { gitEnvironment } from '../git/git'
import { addProjectWithFirstCommit, inspectAddProject } from './add-project'

describe('adding a project', () => {
  let root: string
  let home: string
  let options: { git: string; env: ReturnType<typeof gitEnvironment> }

  const makeHome = (withIdentity: boolean) => {
    home = path.join(root, withIdentity ? 'home' : 'home-without-identity')
    fs.mkdirSync(home, { recursive: true })
    fs.writeFileSync(
      path.join(home, '.gitconfig'),
      withIdentity
        ? '[user]\n\tname = Test\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n'
        : // Without a name or an email, Git makes no commit, as on a computer
          // that has neither set.
          '[user]\n\tuseConfigOnly = true\n',
    )
    options = {
      git: 'git',
      env: {
        ...gitEnvironment({ PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home }),
        GIT_CONFIG_NOSYSTEM: '1',
      },
    }
  }

  const run = (...args: string[]) =>
    execFileSync(options.git, args, { env: options.env, encoding: 'utf8' }).trim()

  /** Whether the repository has a commit. */
  const hasHead = (repo: string) => {
    try {
      run('-C', repo, 'rev-parse', '--verify', '--quiet', 'HEAD')
      return true
    } catch {
      return false
    }
  }

  beforeEach(() => {
    root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-add-project-')))
    makeHome(true)
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  const folder = (name: string) => path.join(root, name)

  it('asks before initializing a folder in no repository, counting its files without changing it', async () => {
    const plain = folder('plain')
    fs.mkdirSync(plain)
    fs.writeFileSync(path.join(plain, 'README.md'), '# Readme\n')
    fs.writeFileSync(path.join(plain, '.env'), 'SECRET=1\n')

    const inspection = await inspectAddProject(plain, options)

    expect(inspection).toEqual({
      kind: 'needs-init',
      folder: plain,
      fileCount: 2,
      hasGitignore: false,
    })
    // Nothing was written: cancelling leaves the folder as it was.
    expect(fs.existsSync(path.join(plain, '.git'))).toBe(false)
    expect(fs.readdirSync(plain).toSorted()).toEqual(['.env', 'README.md'])
  })

  it('leaves out the files a .gitignore excludes', async () => {
    const ignored = folder('ignored')
    fs.mkdirSync(ignored)
    fs.writeFileSync(path.join(ignored, 'README.md'), '# Readme\n')
    fs.writeFileSync(path.join(ignored, '.env'), 'SECRET=1\n')
    fs.writeFileSync(path.join(ignored, '.gitignore'), '.env\n')

    // The .gitignore is committed too; the .env it ignores is not.
    expect(await inspectAddProject(ignored, options)).toEqual({
      kind: 'needs-init',
      folder: ignored,
      fileCount: 2,
      hasGitignore: true,
    })

    const result = await addProjectWithFirstCommit(ignored, 'init', options)
    expect(result).toEqual({ ok: true, root: ignored })
    expect(run('-C', ignored, 'branch', '--show-current')).toBe('main')
    expect(run('-C', ignored, 'ls-tree', '--name-only', 'HEAD').split('\n').toSorted()).toEqual([
      '.gitignore',
      'README.md',
    ])
    // The first commit leaves the folder without changes, as any commit does.
    expect(run('-C', ignored, 'status', '--porcelain')).toBe('')
  })

  it('makes the first commit of a folder it initialized', async () => {
    const plain = folder('commit-me')
    fs.mkdirSync(plain)
    fs.writeFileSync(path.join(plain, 'README.md'), '# Readme\n')

    const result = await addProjectWithFirstCommit(plain, 'init', options)

    expect(result).toEqual({ ok: true, root: plain })
    expect(fs.existsSync(path.join(plain, '.git'))).toBe(true)
    expect(run('-C', plain, 'rev-list', '--count', 'HEAD')).toBe('1')
    expect(run('-C', plain, 'ls-tree', '--name-only', 'HEAD')).toBe('README.md')
    // Git sees no staged deletions and no untracked copies of the files.
    expect(run('-C', plain, 'status', '--porcelain')).toBe('')
  })

  it('makes the first commit of a repository without one, keeping its staged files', async () => {
    const repo = folder('no-commits')
    fs.mkdirSync(repo)
    run('init', '-q', '-b', 'main', repo)
    fs.writeFileSync(path.join(repo, 'staged.txt'), 'staged\n')
    fs.writeFileSync(path.join(repo, 'other.txt'), 'other\n')
    run('-C', repo, 'add', 'staged.txt')

    expect(await inspectAddProject(repo, options)).toEqual({
      kind: 'needs-first-commit',
      folder: repo,
      fileCount: 2,
      hasGitignore: false,
    })

    const result = await addProjectWithFirstCommit(repo, 'first-commit', options)

    expect(result).toEqual({ ok: true, root: repo })
    expect(run('-C', repo, 'rev-list', '--count', 'HEAD')).toBe('1')
    expect(run('-C', repo, 'ls-tree', '--name-only', 'HEAD').split('\n').toSorted()).toEqual([
      'other.txt',
      'staged.txt',
    ])
    // Everything the commit made is staged too, so the folder is clean.
    expect(run('-C', repo, 'status', '--porcelain')).toBe('')
  })

  it('adds a repository with a commit as it is', async () => {
    const repo = folder('ready')
    fs.mkdirSync(repo)
    run('init', '-q', '-b', 'main', repo)
    fs.writeFileSync(path.join(repo, 'README.md'), '# Readme\n')
    run('-C', repo, 'add', '.')
    run('-C', repo, 'commit', '-q', '-m', 'first')

    expect(await inspectAddProject(repo, options)).toEqual({ kind: 'ready', root: repo })
  })

  it('removes the .git it made when the first commit fails, as without a Git identity', async () => {
    makeHome(false)
    const plain = folder('failure')
    fs.mkdirSync(plain)
    fs.writeFileSync(path.join(plain, 'README.md'), '# Readme\n')

    const result = await addProjectWithFirstCommit(plain, 'init', options)

    expect(result.ok).toBe(false)
    expect(fs.existsSync(path.join(plain, '.git'))).toBe(false)
  })

  it('leaves the staged files of a repository as they were when the first commit fails', async () => {
    const repo = folder('failure-staged')
    fs.mkdirSync(repo)
    run('init', '-q', '-b', 'main', repo)
    fs.writeFileSync(path.join(repo, 'staged.txt'), 'staged\n')
    run('-C', repo, 'add', 'staged.txt')
    makeHome(false)

    const result = await addProjectWithFirstCommit(repo, 'first-commit', options)

    expect(result.ok).toBe(false)
    expect(run('-C', repo, 'ls-files', '--cached')).toBe('staged.txt')
    expect(hasHead(repo)).toBe(false)
  })
})

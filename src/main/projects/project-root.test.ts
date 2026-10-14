import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveProjectRoot } from './project-root'

let root: string
const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: os.homedir() }

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'ignore',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  })
}

const resolve = (directory: string) => resolveProjectRoot(directory, { git: 'git', env })

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-root-')))
  const repo = path.join(root, 'repo')
  fs.mkdirSync(path.join(repo, 'sub', 'deeper'), { recursive: true })
  git(repo, 'init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(repo, 'sub', 'deeper', 'file.txt'), 'x\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'initial')
  git(repo, 'worktree', 'add', '-q', '-b', 'feature', path.join(root, 'linked'))

  // A repository nested inside another one.
  const nested = path.join(repo, 'sub', 'nested')
  fs.mkdirSync(nested)
  git(nested, 'init', '-q', '-b', 'main')

  fs.mkdirSync(path.join(root, 'plain'))
  fs.symlinkSync(path.join(root, 'plain'), path.join(root, 'link-to-plain'))
  fs.symlinkSync(path.join(repo, 'sub'), path.join(root, 'link-to-sub'))

  const seed = path.join(root, 'seed')
  fs.mkdirSync(seed)
  git(seed, 'init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(seed, 'a.txt'), 'a\n')
  git(seed, 'add', '.')
  git(seed, 'commit', '-q', '-m', 'initial')
  git(root, 'clone', '-q', '--bare', seed, path.join(root, 'bare.git'))
  git(path.join(root, 'bare.git'), 'worktree', 'add', '-q', path.join(root, 'bare-linked'), 'main')

  // A submodule checked out at `super/mod`, and a linked worktree of it.
  const superproject = path.join(root, 'super')
  fs.mkdirSync(superproject)
  git(superproject, 'init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(superproject, 'b.txt'), 'b\n')
  git(superproject, 'add', '.')
  git(superproject, 'commit', '-q', '-m', 'initial')
  git(superproject, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', repo, 'mod')
  git(superproject, 'commit', '-q', '-m', 'add submodule')
  git(
    path.join(superproject, 'mod'),
    'worktree',
    'add',
    '-q',
    '-b',
    'mod-feature',
    path.join(root, 'mod-linked'),
  )

  // A repository whose Git directory is outside its working directory, and a linked worktree of it.
  const separate = path.join(root, 'separate')
  git(
    root,
    'init',
    '-q',
    '-b',
    'main',
    `--separate-git-dir=${path.join(root, 'separate.git')}`,
    separate,
  )
  fs.mkdirSync(path.join(separate, 'docs'))
  fs.writeFileSync(path.join(separate, 'docs', 'c.txt'), 'c\n')
  git(separate, 'add', '.')
  git(separate, 'commit', '-q', '-m', 'initial')
  git(separate, 'worktree', 'add', '-q', '-b', 'feature', path.join(root, 'separate-linked'))
})

afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

describe('resolveProjectRoot', () => {
  it('uses the main worktree top level for the repository and any subdirectory', async () => {
    const expected = { kind: 'ok', root: path.join(root, 'repo') }
    expect(await resolve(path.join(root, 'repo'))).toEqual(expected)
    expect(await resolve(path.join(root, 'repo', 'sub', 'deeper'))).toEqual(expected)
  })

  it('maps a linked worktree to the main worktree', async () => {
    expect(await resolve(path.join(root, 'linked'))).toEqual({
      kind: 'ok',
      root: path.join(root, 'repo'),
    })
  })

  it('uses the innermost repository', async () => {
    expect(await resolve(path.join(root, 'repo', 'sub', 'nested'))).toEqual({
      kind: 'ok',
      root: path.join(root, 'repo', 'sub', 'nested'),
    })
  })

  it('returns the canonical path when the selection goes through a symlink', async () => {
    expect(await resolve(path.join(root, 'link-to-sub'))).toEqual({
      kind: 'ok',
      root: path.join(root, 'repo'),
    })
  })

  it('uses the checkout directory of a submodule', async () => {
    const expected = { kind: 'ok', root: path.join(root, 'super', 'mod') }
    expect(await resolve(path.join(root, 'super', 'mod'))).toEqual(expected)
    expect(await resolve(path.join(root, 'super', 'mod', 'sub', 'deeper'))).toEqual(expected)
    expect(await resolve(path.join(root, 'mod-linked'))).toEqual(expected)
    // The submodule's own Git directory records where it is checked out.
    expect(await resolve(path.join(root, 'super', '.git', 'modules', 'mod'))).toEqual(expected)
  })

  it('uses the working directory of a repository with a separate Git directory', async () => {
    const expected = { kind: 'ok', root: path.join(root, 'separate') }
    expect(await resolve(path.join(root, 'separate'))).toEqual(expected)
    expect(await resolve(path.join(root, 'separate', 'docs'))).toEqual(expected)
  })

  it('rejects folders whose main worktree Git does not record', async () => {
    const unknown = { kind: 'unknown-main-worktree' }
    expect(await resolve(path.join(root, 'separate-linked'))).toEqual(unknown)
    expect(await resolve(path.join(root, 'separate.git'))).toEqual(unknown)
  })

  it('uses a folder outside any repository as it is, by its canonical path', async () => {
    const expected = { kind: 'ok', root: path.join(root, 'plain') }
    expect(await resolve(path.join(root, 'plain'))).toEqual(expected)
    expect(await resolve(path.join(root, 'link-to-plain'))).toEqual(expected)
  })

  it('rejects bare repositories and their linked worktrees', async () => {
    expect(await resolve(path.join(root, 'bare.git'))).toEqual({ kind: 'bare' })
    expect(await resolve(path.join(root, 'bare-linked'))).toEqual({ kind: 'bare' })
  })

  it('reports folders that cannot be opened', async () => {
    const result = await resolve(path.join(root, 'missing'))
    expect(result.kind).toBe('error')
  })

  it('does not change the repository', async () => {
    const head = fs.readFileSync(path.join(root, 'repo', '.git', 'HEAD'), 'utf8')
    const entries = fs.readdirSync(path.join(root, 'repo', '.git')).toSorted()
    await resolve(path.join(root, 'repo', 'sub'))
    expect(fs.readFileSync(path.join(root, 'repo', '.git', 'HEAD'), 'utf8')).toBe(head)
    expect(fs.readdirSync(path.join(root, 'repo', '.git')).toSorted()).toEqual(entries)
  })
})

// Helpers for the unit tests of worktrees: repositories made with real git in
// a temporary directory.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gitEnvironment } from '../git/git'
import type { GitContext } from './repositories'

/** A temporary directory, with a home directory that has no Git configuration. */
export function makeSandbox(prefix: string): { root: string; home: string; context: GitContext } {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))
  const home = path.join(root, 'home')
  fs.mkdirSync(home)
  return {
    root,
    home,
    context: {
      git: 'git',
      env: gitEnvironment({ PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home }),
    },
  }
}

/** Runs git as the tests' author and returns what it printed. */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
    },
  }).trim()
}

/** A repository with one commit on `branch`, which is checked out. */
export function makeRepository(directory: string, branch = 'main'): string {
  fs.mkdirSync(directory, { recursive: true })
  git(directory, 'init', '-q', '-b', branch)
  fs.writeFileSync(path.join(directory, 'README.md'), `${path.basename(directory)}\n`)
  git(directory, 'add', '.')
  git(directory, 'commit', '-q', '-m', 'initial')
  return directory
}

/** Commits a file on a new branch, leaving the branch that was checked out checked out. */
export function addBranch(repository: string, branch: string): void {
  const current = git(repository, 'branch', '--show-current')
  git(repository, 'checkout', '-q', '-b', branch)
  fs.writeFileSync(path.join(repository, `${branch.replaceAll('/', '-')}.txt`), `${branch}\n`)
  git(repository, 'add', '.')
  git(repository, 'commit', '-q', '-m', branch)
  git(repository, 'checkout', '-q', current)
}

/** The paths of a repository's linked worktrees and whether each is prunable. */
export function linkedWorktrees(repository: string): Array<{ path: string; prunable: boolean }> {
  const entries: Array<{ path: string; prunable: boolean }> = []
  for (const field of git(repository, 'worktree', 'list', '--porcelain', '-z').split('\0')) {
    if (field.startsWith('worktree ')) {
      entries.push({ path: field.slice('worktree '.length), prunable: false })
    } else if (field.startsWith('prunable') && entries.length > 0) {
      entries.at(-1)!.prunable = true
    }
  }
  return entries.slice(1)
}

export function branches(repository: string): string[] {
  return git(repository, 'for-each-ref', '--format=%(refname:short)', 'refs/heads')
    .split('\n')
    .filter(Boolean)
}

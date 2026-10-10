import fs from 'node:fs/promises'
import path from 'node:path'
import type { Env } from '../env/env'
import { gitEnvironment, parseWorktreeList, runGit } from '../git/git'

export type ProjectRootResult =
  | { kind: 'ok'; root: string }
  | { kind: 'not-git' }
  | { kind: 'bare' }
  /** Git does not record where the repository's main worktree is. */
  | { kind: 'unknown-main-worktree' }
  | { kind: 'error'; message: string }

interface RepositoryLocation {
  /** The repository's Git directory, shared by all of its worktrees. */
  commonDir: string
  /** The Git directory of the worktree the directory is in. */
  gitDir: string
  insideWorkTree: boolean
}

/**
 * Finds the top-level directory of a repository's main worktree, the working
 * directory it was created with, or `null` when Git does not record it.
 * `git worktree list` cannot be used for this: for submodules and repositories
 * with a separate Git directory it lists the Git directory instead.
 */
async function findMainWorktree(
  git: string,
  env: Env,
  directory: string,
  location: RepositoryLocation,
): Promise<string | null> {
  // A configured working tree, as Git records it for submodules.
  const configured = await runGit(
    git,
    ['--git-dir', location.commonDir, 'config', '--local', '--get', 'core.worktree'],
    env,
  )
  const worktree = configured.code === 0 ? configured.stdout.trim() : ''
  if (worktree) return path.resolve(location.commonDir, worktree)

  // The usual layout: the Git directory is the `.git` directory of the main worktree.
  if (path.basename(location.commonDir) === '.git') return path.dirname(location.commonDir)

  // Otherwise only a directory in the main worktree itself shows where it is.
  if (location.insideWorkTree && location.gitDir === location.commonDir) {
    const top = await runGit(git, ['-C', directory, 'rev-parse', '--show-toplevel'], env)
    if (top.code === 0 && top.stdout.trim()) return top.stdout.trim()
  }
  return null
}

/**
 * Finds the project root of a directory: the top-level directory of the main
 * worktree of the innermost Git repository that contains it, as a canonical
 * path. Directories of bare repositories (including their linked worktrees),
 * and directories whose main worktree Git does not record, are rejected.
 */
export async function resolveProjectRoot(
  directory: string,
  options: { git: string; env: Env },
): Promise<ProjectRootResult> {
  let canonical: string
  try {
    canonical = await fs.realpath(directory)
  } catch (error) {
    return { kind: 'error', message: `Cannot open the folder: ${(error as Error).message}` }
  }

  const env = gitEnvironment(options.env)
  const list = await runGit(
    options.git,
    ['-C', canonical, 'worktree', 'list', '--porcelain', '-z'],
    env,
  )
  if (list.code !== 0) {
    if (/not a git repository/i.test(list.stderr)) return { kind: 'not-git' }
    const message = list.stderr.trim() || `git exited with code ${list.code}.`
    return { kind: 'error', message }
  }
  // Git lists the main worktree first, marked bare for a bare repository.
  const first = parseWorktreeList(list.stdout)[0]
  if (!first) return { kind: 'error', message: 'Git did not report the main worktree.' }
  if (first.bare) return { kind: 'bare' }

  const located = await runGit(
    options.git,
    [
      '-C',
      canonical,
      'rev-parse',
      '--path-format=absolute',
      '--git-common-dir',
      '--git-dir',
      '--is-inside-work-tree',
    ],
    env,
  )
  const [commonDir, gitDir, insideWorkTree] = located.stdout.split('\n')
  if (located.code !== 0 || !commonDir || !gitDir) {
    const message = located.stderr.trim() || `git exited with code ${located.code}.`
    return { kind: 'error', message }
  }
  const mainWorktree = await findMainWorktree(options.git, env, canonical, {
    commonDir,
    gitDir,
    insideWorkTree: insideWorkTree === 'true',
  })
  if (!mainWorktree) return { kind: 'unknown-main-worktree' }
  try {
    return { kind: 'ok', root: await fs.realpath(mainWorktree) }
  } catch (error) {
    return {
      kind: 'error',
      message: `Cannot open the main worktree ${mainWorktree}: ${(error as Error).message}`,
    }
  }
}

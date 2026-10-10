import fs from 'node:fs/promises'
import path from 'node:path'
import type { Env } from '../env/env'
import { runGit, shortBranchName, type GitResult } from '../git/git'

/** How to run git: the executable and the environment it runs with. */
export interface GitContext {
  git: string
  env: Env
}

export function git(context: GitContext, args: readonly string[], timeout?: number) {
  return runGit(context.git, args, context.env, { timeout })
}

/**
 * Directories whose repositories are dependencies that package managers
 * download, at any depth: they are neither inner repositories nor foreign
 * repositories.
 */
export const DEPENDENCY_DIRECTORIES: ReadonlySet<string> = new Set([
  'node_modules',
  'bower_components',
  'vendor',
  'Pods',
  'Carthage',
  '.venv',
  'venv',
])

const WALK_CONCURRENCY = 16

/**
 * Walks the directories below `root` without following symbolic links and
 * without entering `.git` and dependency directories. `visit` is called for
 * each directory below `root` that has a `.git` entry, with the context of the
 * directory it is in, and returns the context for the directories inside it,
 * or `null` to leave them out.
 */
export async function walkRepositories<Context>(
  root: string,
  rootContext: Context,
  visit: (directory: string, context: Context) => Promise<Context | null>,
): Promise<void> {
  const pending: Array<{ directory: string; context: Context; isRoot: boolean }> = [
    { directory: root, context: rootContext, isRoot: true },
  ]
  const explore = async (item: (typeof pending)[number]) => {
    let entries
    try {
      entries = await fs.readdir(item.directory, { withFileTypes: true })
    } catch {
      return
    }
    let context = item.context
    if (!item.isRoot && entries.some((entry) => entry.name === '.git')) {
      const next = await visit(item.directory, item.context).catch(() => null)
      if (next === null) return
      context = next
    }
    for (const entry of entries) {
      // A symbolic link is not a directory here: links are never followed.
      if (!entry.isDirectory() || entry.name === '.git') continue
      if (DEPENDENCY_DIRECTORIES.has(entry.name)) continue
      pending.push({ directory: path.join(item.directory, entry.name), context, isRoot: false })
    }
  }
  await new Promise<void>((resolve) => {
    let active = 0
    const pump = () => {
      while (active < WALK_CONCURRENCY && pending.length > 0) {
        const item = pending.pop()!
        active++
        void explore(item).finally(() => {
          active--
          if (active === 0 && pending.length === 0) resolve()
          else pump()
        })
      }
    }
    pump()
  })
}

/**
 * Whether a directory is the working directory of a Git repository, or holds
 * one at any depth as `walkRepositories` finds them: without following
 * symbolic links and outside `.git` and dependency directories.
 */
export async function holdsRepository(directory: string): Promise<boolean> {
  const stats = await fs.lstat(directory).catch(() => null)
  if (!stats?.isDirectory()) return false
  if (await fs.lstat(path.join(directory, '.git')).then(Boolean, () => false)) return true
  let found = false
  await walkRepositories(directory, null, async () => {
    found = true
    return null
  })
  return found
}

async function realpath(file: string): Promise<string> {
  return fs.realpath(file).catch(() => path.resolve(file))
}

/** A repository's working directory, its Git directory and the Git directory its worktrees share. */
export interface RepositoryLocation {
  topLevel: string
  gitDir: string
  commonDir: string
}

/** Where a working directory's repository keeps its data, or `null` when it is not one. */
export async function locateRepository(
  context: GitContext,
  directory: string,
): Promise<RepositoryLocation | null> {
  const result = await git(context, [
    '-C',
    directory,
    'rev-parse',
    '--path-format=absolute',
    '--show-toplevel',
    '--git-dir',
    '--git-common-dir',
  ])
  const [topLevel, gitDir, commonDir] = result.stdout.split('\n')
  if (result.code !== 0 || !topLevel || !gitDir || !commonDir) return null
  return {
    topLevel: await realpath(topLevel),
    gitDir: await realpath(gitDir),
    commonDir: await realpath(commonDir),
  }
}

/** Paths that a repository's `.gitmodules` file registers as submodules. */
async function registeredSubmodulePaths(context: GitContext, repository: string) {
  const file = path.join(repository, '.gitmodules')
  if (!(await fs.lstat(file).catch(() => null))) return new Set<string>()
  const result = await git(context, [
    'config',
    '-z',
    '-f',
    file,
    '--get-regexp',
    '^submodule\\..*\\.path$',
  ])
  const paths = new Set<string>()
  for (const entry of result.stdout.split('\0')) {
    const value = entry.slice(entry.indexOf('\n') + 1)
    if (entry.includes('\n') && value) paths.add(value.replace(/\/+$/, ''))
  }
  return paths
}

/**
 * Whether a repository records anything at a path: tracked files under it, or
 * a submodule there (a gitlink in its index or in its HEAD commit, or an entry
 * in its `.gitmodules`).
 */
async function recordsPath(
  context: GitContext,
  repository: string,
  relativePath: string,
  submodulePaths: () => Promise<Set<string>>,
): Promise<boolean> {
  const index = await git(context, [
    '-C',
    repository,
    '--literal-pathspecs',
    'ls-files',
    '-z',
    '--',
    relativePath,
  ])
  if (index.code === 0 && index.stdout !== '') return true
  const head = await git(context, [
    '-C',
    repository,
    '--literal-pathspecs',
    'ls-tree',
    '-z',
    'HEAD',
    '--',
    relativePath,
  ])
  if (head.code === 0 && head.stdout.startsWith('160000 ')) return true
  return (await submodulePaths()).has(relativePath)
}

/** A repository inside the project's main worktree that worktrees include. */
export interface InnerRepository {
  /** Its working directory in the project's main worktree. */
  path: string
  /** Its path relative to the project root, which its worktrees also have. */
  relativePath: string
  commonDir: string
}

/**
 * Finds the project's inner repositories: the working directories of Git
 * repositories at any depth in the project's main worktree that the innermost
 * repository containing them ignores or does not track. Submodules, linked
 * worktrees of the project's repository or of an inner repository,
 * repositories in dependency directories and repositories reached only
 * through symbolic links are not inner repositories.
 */
export async function findInnerRepositories(
  context: GitContext,
  projectRoot: string,
): Promise<InnerRepository[]> {
  const project = await locateRepository(context, projectRoot)
  if (!project) return []
  const main: InnerRepository[] = []
  const linked: InnerRepository[] = []
  const submodules = new Map<string, Promise<Set<string>>>()
  const submodulePathsOf = (repository: string) => () => {
    let paths = submodules.get(repository)
    if (!paths) {
      paths = registeredSubmodulePaths(context, repository)
      submodules.set(repository, paths)
    }
    return paths
  }

  await walkRepositories(projectRoot, projectRoot, async (directory, container) => {
    const location = await locateRepository(context, directory)
    const canonical = await realpath(directory)
    if (!location || location.topLevel !== canonical) return null
    const withinContainer = path.relative(container, directory)
    if (await recordsPath(context, container, withinContainer, submodulePathsOf(container))) {
      return null
    }
    const repository = {
      path: canonical,
      relativePath: path.relative(projectRoot, directory),
      commonDir: location.commonDir,
    }
    // A linked worktree: its files belong to the repository it was made from.
    if (location.gitDir !== location.commonDir) {
      linked.push(repository)
      return null
    }
    main.push(repository)
    return directory
  })

  // Linked worktrees of the project's repository and of inner repositories are
  // left out. A linked worktree of a repository outside the project stands for
  // that repository, once.
  const taken = new Set([project.commonDir, ...main.map((repository) => repository.commonDir)])
  const byPath = (a: InnerRepository, b: InnerRepository) =>
    a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0
  for (const repository of linked.toSorted(byPath)) {
    if (taken.has(repository.commonDir)) continue
    taken.add(repository.commonDir)
    main.push(repository)
  }
  return main.toSorted(byPath)
}

/** A repository's local branches and the one its working directory has checked out. */
export interface BranchInfo {
  branches: string[]
  /** The checked-out branch; `null` on a detached HEAD or an unborn branch. */
  current: string | null
  hasCommits: boolean
}

export async function readBranches(context: GitContext, repository: string): Promise<BranchInfo> {
  const [refs, head, verified] = await Promise.all([
    git(context, ['-C', repository, 'for-each-ref', '--format=%(refname)', 'refs/heads']),
    git(context, ['-C', repository, 'symbolic-ref', '-q', 'HEAD']),
    git(context, ['-C', repository, 'rev-parse', '--verify', '-q', 'HEAD']),
  ])
  const branches =
    refs.code === 0
      ? refs.stdout
          .split('\n')
          .filter((line) => line !== '')
          .map(shortBranchName)
      : []
  const checkedOut = head.code === 0 ? shortBranchName(head.stdout.trim()) : null
  return {
    branches,
    current: checkedOut !== null && branches.includes(checkedOut) ? checkedOut : null,
    hasCommits: branches.length > 0 || verified.code === 0,
  }
}

/** Whether a repository has a local branch of that name. */
export async function hasBranch(
  context: GitContext,
  repository: string,
  branch: string,
): Promise<boolean> {
  const result: GitResult = await git(context, [
    '-C',
    repository,
    'show-ref',
    '--verify',
    '--quiet',
    `refs/heads/${branch}`,
  ])
  return result.code === 0
}

/** Paths of the submodules (gitlinks) in a commit of a repository. */
export async function submodulesAt(
  context: GitContext,
  repository: string,
  commit: string,
): Promise<string[]> {
  const result = await runGit(
    context.git,
    ['-C', repository, 'ls-tree', '-r', '-z', '--full-tree', commit],
    context.env,
    { maxBuffer: 256 * 1024 * 1024 },
  )
  if (result.code !== 0) return []
  return result.stdout
    .split('\0')
    .filter((entry) => entry.startsWith('160000 '))
    .map((entry) => entry.slice(entry.indexOf('\t') + 1))
}

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Env } from '../env/env'
import { gitErrorMessage, runGit } from '../git/git'
import { resolveProjectRoot } from './project-root'

/** Creating the first commit may write many files: no short limit. */
const ADD_PROJECT_TIMEOUT = 10 * 60_000

/** The message of the first commit Hoot makes in a folder without one. */
const INITIAL_COMMIT_MESSAGE = 'Initial commit'

/**
 * What adding a folder as a project takes: nothing, if it is in a Git
 * repository with a commit already; or a confirmation, because Hoot would
 * run `git init` and make its first commit, or make the first commit of a
 * repository that has none.
 */
export type AddProjectInspection =
  | { kind: 'ready'; root: string }
  | { kind: 'needs-init'; folder: string; fileCount: number; hasGitignore: boolean }
  | { kind: 'needs-first-commit'; folder: string; fileCount: number; hasGitignore: boolean }
  | { kind: 'bare' }
  | { kind: 'unknown-main-worktree' }
  | { kind: 'error'; message: string }

export interface GitOptions {
  git: string
  env: Env
}

async function exists(file: string): Promise<boolean> {
  return (await fs.lstat(file).catch(() => null)) !== null
}

/** Whether a folder has a `.gitignore`, whose rules leave files out of the first commit. */
function hasGitignore(folder: string): Promise<boolean> {
  return exists(path.join(folder, '.gitignore'))
}

/**
 * How many files `git add -A` would commit in a folder that is in no
 * repository: a temporary repository elsewhere, with the folder as its
 * working tree, lists what the folder's `.gitignore` files leave in.
 * `null` when they cannot be listed, as without Git.
 */
async function countOutsideRepository(folder: string, options: GitOptions): Promise<number | null> {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'hoot-add-project-'))
  try {
    const initialized = await runGit(options.git, ['init', '-q', temporary], options.env)
    if (initialized.code !== 0) return null
    const listed = await runGit(
      options.git,
      [
        `--git-dir=${path.join(temporary, '.git')}`,
        `--work-tree=${folder}`,
        'ls-files',
        '--others',
        '--exclude-standard',
        '-z',
      ],
      options.env,
    )
    if (listed.code !== 0) return null
    return listed.stdout.split('\0').filter(Boolean).length
  } finally {
    await fs.rm(temporary, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** How many files the first commit of a repository would hold: the staged ones and the rest. */
async function countInRepository(root: string, options: GitOptions): Promise<number | null> {
  const listed = await runGit(
    options.git,
    ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    options.env,
  )
  if (listed.code !== 0) return null
  return listed.stdout.split('\0').filter(Boolean).length
}

/**
 * What adding a folder as a project takes. A folder in a Git repository with
 * a commit is added as it is; one that is in no repository, or in one without
 * a commit, needs a confirmation first, which says how many files the first
 * commit would hold and whether the folder has a `.gitignore`.
 */
export async function inspectAddProject(
  directory: string,
  options: GitOptions,
): Promise<AddProjectInspection> {
  const resolved = await resolveProjectRoot(directory, options)
  switch (resolved.kind) {
    case 'bare':
      return { kind: 'bare' }
    case 'unknown-main-worktree':
      return { kind: 'unknown-main-worktree' }
    case 'error':
      return { kind: 'error', message: resolved.message }
    case 'ok':
      break
  }
  const root = resolved.root
  const inside = await runGit(
    options.git,
    ['-C', root, 'rev-parse', '--is-inside-work-tree'],
    options.env,
  )
  if (inside.code !== 0) {
    if (!/not a git repository/i.test(inside.stderr)) {
      return { kind: 'error', message: gitErrorMessage(inside) }
    }
    const fileCount = await countOutsideRepository(root, options)
    if (fileCount === null) {
      return { kind: 'error', message: `Could not read the files of ${root}.` }
    }
    return {
      kind: 'needs-init',
      folder: root,
      fileCount,
      hasGitignore: await hasGitignore(root),
    }
  }
  const head = await runGit(
    options.git,
    ['-C', root, 'rev-parse', '--verify', '--quiet', 'HEAD^{commit}'],
    options.env,
  )
  if (head.code === 0) return { kind: 'ready', root }
  const fileCount = await countInRepository(root, options)
  if (fileCount === null) {
    return { kind: 'error', message: `Could not read the files of ${root}.` }
  }
  return {
    kind: 'needs-first-commit',
    folder: root,
    fileCount,
    hasGitignore: await hasGitignore(root),
  }
}

/**
 * Makes the first commit of a folder's files, from an index of its own: one
 * that the commit cannot make leaves the repository's staged files as they
 * were, so a repository without commits keeps its index when the commit
 * fails.
 */
async function makeFirstCommit(
  folder: string,
  options: GitOptions,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'hoot-add-project-index-'))
  try {
    const env: Env = { ...options.env, GIT_INDEX_FILE: path.join(temporary, 'index') }
    const added = await runGit(options.git, ['-C', folder, 'add', '-A', '--', '.'], env, {
      timeout: ADD_PROJECT_TIMEOUT,
    })
    if (added.code !== 0) return { ok: false, message: gitErrorMessage(added) }
    const committed = await runGit(
      options.git,
      ['-C', folder, 'commit', '-q', '--allow-empty', '-m', INITIAL_COMMIT_MESSAGE],
      env,
      { timeout: ADD_PROJECT_TIMEOUT },
    )
    if (committed.code !== 0) return { ok: false, message: gitErrorMessage(committed) }
    return { ok: true }
  } finally {
    await fs.rm(temporary, { recursive: true, force: true }).catch(() => undefined)
  }
}

/**
 * Runs `git init` in a folder and makes its first commit, or makes the first
 * commit of a repository without one, as the confirmation said. A failed
 * `git init` or commit leaves the folder as it was: the `.git` Hoot made is
 * removed again, and a repository's staged files stay as they were.
 */
export async function addProjectWithFirstCommit(
  folder: string,
  mode: 'init' | 'first-commit',
  options: GitOptions,
): Promise<{ ok: true; root: string } | { ok: false; message: string }> {
  const inspection = await inspectAddProject(folder, options)
  if (mode === 'init' && inspection.kind !== 'needs-init') {
    return { ok: false, message: 'The folder is now in a Git repository with a commit.' }
  }
  if (mode === 'first-commit' && inspection.kind !== 'needs-first-commit') {
    return { ok: false, message: 'The repository now has a commit.' }
  }
  if (inspection.kind !== 'needs-init' && inspection.kind !== 'needs-first-commit') {
    return {
      ok: false,
      message:
        inspection.kind === 'error' ? inspection.message : 'The folder cannot be added as it is.',
    }
  }
  const root = inspection.folder
  if (mode === 'init') {
    const gitDirectory = path.join(root, '.git')
    const hadGit = await exists(gitDirectory)
    const initialized = await runGit(options.git, ['init', '-q', root], options.env)
    if (initialized.code !== 0) return { ok: false, message: gitErrorMessage(initialized) }
    const committed = await makeFirstCommit(root, options)
    if (!committed.ok) {
      if (!hadGit) {
        await fs.rm(gitDirectory, { recursive: true, force: true }).catch(() => undefined)
      }
      return committed
    }
    return { ok: true, root }
  }
  const committed = await makeFirstCommit(root, options)
  return committed.ok ? { ok: true, root } : committed
}

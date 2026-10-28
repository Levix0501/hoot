import fs from 'node:fs/promises'
import path from 'node:path'
import type { RepositoryChanges } from '../../shared/worktrees'
import { gitErrorMessage, runGit } from '../git/git'
import { git, relativeGitPath, walkRepositories, type GitContext } from './repositories'

/** How many changed files are listed for a repository; the total is always given. */
export const LISTED_FILES = 10

/** Generous limits: a large worktree can take a while to check. */
const CHECK_TIMEOUT = 5 * 60_000
const CHECK_OUTPUT = 512 * 1024 * 1024

export class InspectionError extends Error {}

/** A changed path in `git status --porcelain=v1` output, with its two-letter status. */
export interface StatusEntry {
  status: string
  file: string
}

/** The entries of `git status --porcelain=v1 -z` output, one per changed file. */
export function parseStatusEntries(output: string): StatusEntry[] {
  const fields = output.split('\0')
  const entries: StatusEntry[] = []
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index]!
    if (field.length < 4) continue
    entries.push({ status: field.slice(0, 2), file: field.slice(3) })
    // A rename or copy is followed by the path it came from.
    if (/[RC]/.test(field.slice(0, 2))) index++
  }
  return entries
}

/** The changed paths in `git status --porcelain=v1 -z` output, one per changed file. */
export function parseStatus(output: string): string[] {
  return parseStatusEntries(output).map((entry) => entry.file)
}

/** Whether a path is one of the given directories or inside one. */
function isWithin(file: string, directories: readonly string[]): boolean {
  const normalized = file.replace(/\/+$/, '')
  return directories.some(
    (directory) => normalized === directory || normalized.startsWith(`${directory}/`),
  )
}

/** A member of a worktree to check: its outer member or an inner member. */
export interface MemberToCheck {
  /** How the member is named to the user: the project name, or its relative path. */
  label: string
  path: string
  /** Its path relative to the worktree root; empty for the outer member. */
  relativePath: string
}

/**
 * The paths of the inner repositories, or inner members, that are inside the
 * one at `relativePath`, relative to it; all of them for the outer one, at ''.
 */
export function nestedBelow(relativePath: string, inner: readonly string[]): string[] {
  const prefix = relativePath === '' ? '' : `${relativePath}/`
  return inner
    .filter((candidate) => prefix === '' || candidate.startsWith(prefix))
    .map((candidate) => candidate.slice(prefix.length))
    .filter((candidate) => candidate !== '')
}

/** `git status` of a working directory, as entries, or why it could not be read. */
async function statusOf(context: GitContext, member: MemberToCheck): Promise<StatusEntry[]> {
  const result = await runGit(
    context.git,
    [
      '-C',
      member.path,
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
      '--ignore-submodules=none',
    ],
    context.env,
    { timeout: CHECK_TIMEOUT, maxBuffer: CHECK_OUTPUT },
  )
  if (result.code !== 0) {
    throw new InspectionError(`Could not check ${member.label}: ${gitErrorMessage(result)}`)
  }
  return parseStatusEntries(result.stdout)
}

/**
 * The uncommitted changes of a member: modified, deleted and staged tracked
 * files and untracked files that are not ignored, in the member and its
 * populated submodules, leaving out the paths of inner members inside it.
 */
async function uncommittedChanges(
  context: GitContext,
  member: MemberToCheck,
  innerMembers: readonly string[],
): Promise<string[]> {
  const nested = nestedBelow(member.relativePath, innerMembers)
  return (await statusOf(context, member))
    .map((entry) => entry.file)
    .filter((file) => !isWithin(file, nested))
}

/**
 * The uncommitted changes of a working directory, as a merge must not find
 * them: modified, deleted and staged tracked files and untracked files that
 * are not ignored, in it and its populated submodules, leaving out what is in
 * another Git repository inside it, such as an inner repository at one of the
 * `nested` paths, relative to it, or one Git lists as an untracked folder.
 * Throws an `InspectionError` when Git cannot tell.
 */
export async function changesBeforeMerge(
  context: GitContext,
  directory: MemberToCheck,
  nested: readonly string[],
): Promise<string[]> {
  return (
    (await statusOf(context, directory))
      // Git lists a repository inside, and only that, as an untracked folder.
      .filter((entry) => !(entry.status === '??' && entry.file.endsWith('/')))
      .map((entry) => entry.file)
      .filter((file) => !isWithin(file, nested))
  )
}

/**
 * Whether a repository is on a detached HEAD whose commit is in no local or
 * remote-tracking branch.
 */
export async function hasDetachedCommit(context: GitContext, repository: string) {
  const head = await git(context, ['-C', repository, 'symbolic-ref', '-q', 'HEAD'])
  if (head.code === 0) return false
  const containing = await runGit(
    context.git,
    [
      '-C',
      repository,
      'for-each-ref',
      '--count=1',
      '--contains',
      'HEAD',
      '--format=%(refname)',
      'refs/heads',
      'refs/remotes',
    ],
    context.env,
    { timeout: CHECK_TIMEOUT },
  )
  // A HEAD that cannot be checked is reported, so that nothing is lost unnoticed.
  return containing.code !== 0 || containing.stdout.trim() === ''
}

/** The paths of a repository's gitlinks, relative to the repository. */
async function gitlinks(context: GitContext, repository: string): Promise<string[]> {
  const result = await runGit(
    context.git,
    ['-C', repository, 'ls-files', '--stage', '-z'],
    context.env,
    { timeout: CHECK_TIMEOUT, maxBuffer: CHECK_OUTPUT },
  )
  if (result.code !== 0) return []
  return result.stdout
    .split('\0')
    .filter((entry) => entry.startsWith('160000 '))
    .map((entry) => entry.slice(entry.indexOf('\t') + 1))
}

async function hasGitEntry(directory: string): Promise<boolean> {
  return (await fs.lstat(path.join(directory, '.git')).catch(() => null)) !== null
}

/** The populated submodules of a repository, nested ones included, relative to it. */
async function populatedSubmodules(context: GitContext, repository: string): Promise<string[]> {
  const found: string[] = []
  const visit = async (directory: string, prefix: string) => {
    for (const link of await gitlinks(context, directory)) {
      const submodule = path.join(directory, link)
      if (!(await hasGitEntry(submodule))) continue
      const relativePath = prefix === '' ? link : `${prefix}/${link}`
      found.push(relativePath)
      await visit(submodule, relativePath)
    }
  }
  await visit(repository, '')
  return found
}

/**
 * Git repositories inside the worktree root that are not part of it: not a
 * member, not a submodule of a member, not in a dependency directory and not
 * reached only through a symbolic link. Paths are relative to the root.
 */
async function foreignRepositories(
  context: GitContext,
  root: string,
  innerMembers: readonly string[],
): Promise<string[]> {
  const found: string[] = []
  const members = new Set(innerMembers)
  /** Adds a member's (or its submodule's) gitlinks to the submodules known below it. */
  const withSubmodulesOf = async (
    directory: string,
    relativePath: string,
    known: ReadonlySet<string>,
  ) => {
    const links = await gitlinks(context, directory)
    if (links.length === 0) return known
    const next = new Set(known)
    for (const link of links) next.add(relativePath === '' ? link : `${relativePath}/${link}`)
    return next
  }
  const rootSubmodules = await withSubmodulesOf(root, '', new Set())
  await walkRepositories(root, rootSubmodules, async (directory, submodules) => {
    const relativePath = relativeGitPath(root, directory)
    if (members.has(relativePath) || submodules.has(relativePath)) {
      return withSubmodulesOf(directory, relativePath, submodules)
    }
    found.push(relativePath)
    return submodules
  })
  return found.toSorted()
}

/**
 * Checks a worktree before it is deleted: the uncommitted changes and
 * detached commits of each member and of their populated submodules, and the
 * foreign repositories inside its root.
 */
export async function inspectMembers(
  context: GitContext,
  root: string,
  members: readonly MemberToCheck[],
): Promise<{ changes: RepositoryChanges[]; foreignRepositories: string[] }> {
  const innerMembers = members
    .map((member) => member.relativePath)
    .filter((relativePath) => relativePath !== '')
  const changes: RepositoryChanges[] = []
  for (const member of members) {
    const files = await uncommittedChanges(context, member, innerMembers)
    const detached = await hasDetachedCommit(context, member.path)
    if (files.length > 0 || detached) {
      changes.push({
        repository: member.label,
        files: files.slice(0, LISTED_FILES),
        total: files.length,
        detachedCommits: detached,
      })
    }
    // Uncommitted changes in a submodule show in its member's status; its
    // detached commits do not.
    for (const submodule of await populatedSubmodules(context, member.path)) {
      if (await hasDetachedCommit(context, path.join(member.path, submodule))) {
        changes.push({
          repository:
            member.relativePath === '' ? submodule : `${member.relativePath}/${submodule}`,
          files: [],
          total: 0,
          detachedCommits: true,
        })
      }
    }
  }
  return { changes, foreignRepositories: await foreignRepositories(context, root, innerMembers) }
}

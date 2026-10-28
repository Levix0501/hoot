import fs from 'node:fs/promises'
import path from 'node:path'
import { shortBranchName } from '../git/git'
import { git, type GitContext } from './repositories'

/** A repository of a worktree whose branch a merge session merges in the project folder. */
export interface MergeRepository {
  /** The project name for the project repository, otherwise its path relative to the project folder. */
  label: string
  /** Its working directory in the project folder. */
  path: string
  /** The branch the worktree has checked out in it. */
  branch: string
  /** The branch checked out in the project folder, which the worktree's branch is merged into. */
  into: string
}

/** What a merge session is asked to merge. */
export interface MergePlan {
  /** The name the worktree's row shows. */
  worktreeName: string
  /** The worktree's root. */
  worktreePath: string
  /** The project's own folder, where the merge is made. */
  projectFolder: string
  /** The project repository first, then the inner repositories the worktree has members of. */
  repositories: MergeRepository[]
}

/** What the checks before a merge found that stops it, each naming the repositories concerned. */
export interface MergeFindings {
  /** Repositories in the project folder whose HEAD is on no branch. */
  detachedInFolder: string[]
  /** Repositories in the project folder with uncommitted changes. */
  changedInFolder: string[]
  /** Repositories in the project folder with a merge or rebase under way. */
  unfinishedInFolder: string[]
  /** Members of the worktree with uncommitted changes. */
  changedInWorktree: string[]
  /** How many sessions run in the worktree. */
  runningSessions: number
  /** Set when the worktree is locked, with the reason Git recorded, if any. */
  locked: { reason: string | null } | null
  /** Members of the worktree whose HEAD is on no branch. */
  detachedInWorktree: string[]
}

export function noFindings(): MergeFindings {
  return {
    detachedInFolder: [],
    changedInFolder: [],
    unfinishedInFolder: [],
    changedInWorktree: [],
    runningSessions: 0,
    locked: null,
    detachedInWorktree: [],
  }
}

function listed(names: readonly string[]): string {
  return new Intl.ListFormat('en', { type: 'conjunction' }).format(names)
}

/** The repositories and what they have, with the verb agreeing: "a has", "a and b have". */
function have(names: readonly string[], what: string): string {
  return `${listed(names)} ${names.length === 1 ? 'has' : 'have'} ${what}`
}

/** What stops the merge, a sentence for each check that found something, in the order of the checks. */
export function describeMergeFindings(findings: MergeFindings): string[] {
  const sentences: string[] = []
  if (findings.detachedInFolder.length > 0) {
    sentences.push(
      `${have(findings.detachedInFolder, 'no branch checked out')} in the project folder.`,
    )
  }
  if (findings.changedInFolder.length > 0) {
    sentences.push(
      `${have(findings.changedInFolder, 'uncommitted changes')} in the project folder: commit or stash them first.`,
    )
  }
  if (findings.unfinishedInFolder.length > 0) {
    sentences.push(
      `${have(findings.unfinishedInFolder, 'a merge or rebase in progress')} in the project folder: finish or abort it first.`,
    )
  }
  if (findings.changedInWorktree.length > 0) {
    sentences.push(
      `${have(findings.changedInWorktree, 'uncommitted changes')} in the worktree: commit them first.`,
    )
  }
  if (findings.runningSessions > 0) {
    sentences.push(
      findings.runningSessions === 1
        ? 'A session is still running in the worktree: close it first.'
        : `${findings.runningSessions} sessions are still running in the worktree: close them first.`,
    )
  }
  if (findings.locked !== null) {
    sentences.push(
      findings.locked.reason
        ? `The worktree is locked: ${findings.locked.reason}${/[.!?]$/.test(findings.locked.reason) ? '' : '.'}`
        : 'The worktree is locked.',
    )
  }
  if (findings.detachedInWorktree.length > 0) {
    sentences.push(`${have(findings.detachedInWorktree, 'no branch checked out')} in the worktree.`)
  }
  return sentences
}

/**
 * What Hoot says when the worktree's branch is merged already in every
 * repository: that there is nothing new to merge, and that Delete cleans it up.
 */
export function nothingToMerge(worktreeName: string, intos: readonly string[]): string {
  const unique = [...new Set(intos)]
  const into = unique.length === 1 ? unique[0]! : 'the branches checked out in the project folder'
  return `${worktreeName} has no new commits to merge into ${into}. You can delete the worktree with Delete.`
}

/**
 * The branch checked out in a working directory, or `null` when its HEAD is
 * on no branch, or Git cannot tell.
 */
export async function checkedOutBranch(
  context: GitContext,
  directory: string,
): Promise<string | null> {
  const result = await git(context, ['-C', directory, 'symbolic-ref', '-q', 'HEAD'])
  const ref = result.stdout.trim()
  return result.code === 0 && ref !== '' ? shortBranchName(ref) : null
}

async function exists(file: string): Promise<boolean> {
  return (await fs.lstat(file).catch(() => null)) !== null
}

/**
 * Whether a `git merge` or `git rebase` was started in a working directory
 * and has neither been finished nor aborted: what Git keeps meanwhile is in
 * the working directory's own Git directory.
 */
export async function hasUnfinishedMerge(context: GitContext, directory: string): Promise<boolean> {
  const result = await git(context, ['-C', directory, 'rev-parse', '--absolute-git-dir'])
  if (result.code !== 0) return false
  const gitDirectory = result.stdout.trim()
  for (const marker of ['MERGE_HEAD', 'rebase-merge', 'rebase-apply']) {
    if (await exists(path.join(gitDirectory, marker))) return true
  }
  return false
}

/**
 * Whether a branch of a repository is merged into another: it points to the
 * same commit, or to one in the other's history.
 */
export async function isMergedInto(
  context: GitContext,
  repository: string,
  branch: string,
  into: string,
): Promise<boolean> {
  const result = await git(context, [
    '-C',
    repository,
    'merge-base',
    '--is-ancestor',
    `refs/heads/${branch}`,
    `refs/heads/${into}`,
  ])
  return result.code === 0
}

/**
 * The first message of a merge session, which its agent is sent when it first
 * starts: the repositories to merge, each with its path in the project folder,
 * the worktree's branch in it and the branch checked out there; how to merge
 * them, with `git merge` in the project folder, resolving conflicts and asking
 * when unsure; what not to do; and to say, once done, that the worktree can be
 * deleted, and wait.
 */
export function mergeInstruction(plan: MergePlan): string {
  const one = plan.repositories.length === 1
  const repositories = plan.repositories.map(
    (repository) =>
      `- ${repository.path}: merge \`${repository.branch}\` into \`${repository.into}\``,
  )
  return [
    `Merge the worktree ${plan.worktreeName}, at ${plan.worktreePath}, into the project folder, ${plan.projectFolder}.`,
    '',
    one
      ? "Merge the worktree's branch into the branch checked out in this repository of the project folder:"
      : "In each of these repositories of the project folder, merge the worktree's branch into the branch checked out there:",
    '',
    ...repositories,
    '',
    'How to merge:',
    '',
    '- Work in the project folder, and make each merge with `git merge`: do not rebase, and do not squash. Finish each merge, and commit the merge commit when one is needed.',
    '- If there are conflicts, resolve them, keeping the intent of the changes on both sides, and make no changes unrelated to the merge. When you are unsure how to resolve something, stop and ask me.',
    '- Do not push, do not delete any branch, and do not delete the worktree.',
    '',
    `When ${one ? 'the repository is' : 'every repository is'} merged, tell me that the merge is complete and that the worktree can be deleted now. Then stop and wait for me.`,
  ].join('\n')
}

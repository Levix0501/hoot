import { shortBranchName } from '../git/git'
import { git, type GitContext } from './repositories'

/** A repository of a worktree whose branch a merge session merges in the project folder. */
export interface MergeRepository {
  /** Its working directory in the project folder. */
  path: string
  /** The branch the worktree has checked out in it; `null` when that HEAD is on no branch. */
  branch: string | null
  /**
   * The branch checked out in the project folder, which the worktree's branch
   * is merged into; `null` when that HEAD is on no branch.
   */
  into: string | null
}

/** What a merge session is asked to merge. */
export interface MergePlan {
  /** The name the worktree's row shows. */
  worktreeName: string
  /** The worktree's root. */
  worktreePath: string
  /** The project repository first, then the inner repositories the worktree has members of. */
  repositories: MergeRepository[]
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

/** What to merge into what in a repository, saying so for a HEAD on no branch. */
function repositoryMerge(repository: MergeRepository): string {
  const branch =
    repository.branch === null ? "the worktree's detached HEAD" : `\`${repository.branch}\``
  const into = repository.into === null ? 'the detached HEAD' : `\`${repository.into}\``
  return `${branch} into ${into} in ${repository.path}`
}

/**
 * The first message of a merge session, which its agent is sent when it first
 * starts: one sentence that says what to merge, the worktree's branch into
 * the branch checked out in the project folder, in each of its repositories,
 * with their paths there. How to merge, and what to do about anything in the
 * way, is the agent's to judge: Hoot neither says nor checks.
 */
export function mergeInstruction(plan: MergePlan): string {
  const merges = new Intl.ListFormat('en', { type: 'conjunction' }).format(
    plan.repositories.map(repositoryMerge),
  )
  return `Merge the worktree ${plan.worktreeName}, at ${plan.worktreePath}, into the project folder: ${merges}.`
}

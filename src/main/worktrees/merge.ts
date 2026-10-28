import { shortBranchName } from '../git/git'
import { git, type GitContext } from './repositories'

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

/** A repository of a worktree, whose branch a deletion session deletes with the worktree. */
export interface DeletionRepository {
  /** Its working directory in the project folder. */
  path: string
  /** The branch the worktree has checked out in it; `null` when that HEAD is on no branch. */
  branch: string | null
}

/** What a deletion session is asked to delete. */
export interface DeletionPlan {
  /** The name the worktree's row shows. */
  worktreeName: string
  /** The worktree's root. */
  worktreePath: string
  /** The project repository first, then the inner repositories the worktree has members of. */
  repositories: DeletionRepository[]
}

/** The branch to delete in a repository, saying so where there is none. */
function repositoryBranch(repository: DeletionRepository): string {
  const branch = repository.branch === null ? 'no branch' : `\`${repository.branch}\``
  return `${branch} in ${repository.path}`
}

/**
 * The first message of a deletion session, which its agent is sent when it
 * first starts: one sentence that says what to delete, the worktree and the
 * branch it has checked out in each of its repositories, with their paths in
 * the project folder. How to delete them, and what to do about anything in
 * the way, is the agent's to judge: Hoot neither says nor checks.
 */
export function deletionInstruction(plan: DeletionPlan): string {
  const worktree = `Delete the worktree ${plan.worktreeName}, at ${plan.worktreePath}`
  const [only, ...others] = plan.repositories
  if (only !== undefined && others.length === 0) {
    return only.branch === null
      ? `${worktree}.`
      : `${worktree}, and its branch ${repositoryBranch(only)}.`
  }
  const branches = new Intl.ListFormat('en', { type: 'conjunction' }).format(
    plan.repositories.map(repositoryBranch),
  )
  return `${worktree}, and its branches: ${branches}.`
}

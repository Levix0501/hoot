import { compareWorktrees, type WorktreeInfo } from './worktrees'

/**
 * The longest name, in code points, that an issue's branch gets from the
 * issue; a suffix that tells it from a branch that already exists comes on
 * top of it.
 */
export const ISSUE_BRANCH_MAX_LENGTH = 60

/** What every branch of an issue starts with: `iss-` and the issue's number, as in `iss-12`. */
function issueBranchPrefix(issueId: number): string {
  return `iss-${issueId}`
}

/** Letters and digits of any script, which an issue's branch keeps from its title. */
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u

/**
 * The name of the branch Hoot creates for an issue: `iss-`, its number and
 * its title, with the title's letters and digits in lower case and each run
 * of anything else a single `-`, at most 60 code points long, and without a
 * `-` at the end; such as `iss-12-fix-the-login-bug-on-safari`, or `iss-12`
 * for a title without letters and digits.
 */
export function issueBranchName(issueId: number, title: string): string {
  let name = `${issueBranchPrefix(issueId)}-`
  for (const character of title) {
    name += LETTER_OR_DIGIT.test(character) ? character.toLowerCase() : '-'
  }
  const kept = Array.from(name.replace(/-+/g, '-')).slice(0, ISSUE_BRANCH_MAX_LENGTH).join('')
  return kept.endsWith('-') ? kept.slice(0, -1) : kept
}

/**
 * The name tried for an issue's branch at an attempt, counted from 1: the
 * name itself first, then the name with `-2`, `-3` and on, while a branch of
 * the name tried before exists.
 */
export function issueBranchAttempt(name: string, attempt: number): string {
  return attempt === 1 ? name : `${name}-${attempt}`
}

/** Whether a branch is one of an issue's: `iss-12`, or a name that starts with `iss-12-`. */
export function isIssueBranch(branch: string, issueId: number): boolean {
  const prefix = issueBranchPrefix(issueId)
  return branch === prefix || branch.startsWith(`${prefix}-`)
}

/**
 * The worktree work on an issue goes on in, among the worktrees of the
 * project the issue belongs to: one whose folder exists, on one of the
 * issue's branches; the first in the sidebar's order when there are several.
 * `null` when there is none.
 */
export function issueWorktree(
  worktrees: readonly WorktreeInfo[],
  issueId: number,
): WorktreeInfo | null {
  const candidates = worktrees.filter(
    (worktree) =>
      !worktree.missing && worktree.branch !== null && isIssueBranch(worktree.branch, issueId),
  )
  return candidates.toSorted(compareWorktrees)[0] ?? null
}

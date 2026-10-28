import type { WorktreeBranch, WorktreeInspection } from './worktrees'

/** A part of a sentence: the dialog's own text, or text from the user's repositories. */
export interface NotePart {
  text: string
  /** A branch's name or a repository's path, rather than the dialog's own text. */
  user: boolean
}

function text(value: string): NotePart {
  return { text: value, user: false }
}

function user(value: string): NotePart {
  return { text: value, user: true }
}

/** Names joined as a list in English, such as "a, b and c", each marked as the user's. */
function list(names: readonly string[]): NotePart[] {
  return new Intl.ListFormat('en', { type: 'conjunction' })
    .formatToParts(names)
    .map((part) => (part.type === 'element' ? user(part.value) : text(part.value)))
}

/**
 * The branches of a worktree that deleting it can delete too: those merged
 * into the branch checked out in the project folder in their repository.
 */
export function mergedBranches(inspection: Pick<WorktreeInspection, 'branches'>): WorktreeBranch[] {
  return inspection.branches.filter((entry) => entry.branch !== null && entry.merged)
}

/**
 * The label of the checkbox that deletes the merged branches with the
 * worktree, which names them, such as "Also delete the branch feature-x";
 * `null` when no branch is merged, and the confirmation has no such checkbox.
 */
export function alsoDeleteLabel(
  inspection: Pick<WorktreeInspection, 'branches'>,
): NotePart[] | null {
  const names = [...new Set(mergedBranches(inspection).map((entry) => entry.branch!))]
  if (names.length === 0) return null
  return [
    text(names.length === 1 ? 'Also delete the branch ' : 'Also delete the branches '),
    ...list(names),
  ]
}

/**
 * What the confirmation says of the worktree's branches, sentence by
 * sentence. While the merged branches are not to be deleted, or none is
 * merged, that the branch is kept, as it always was. While they are to be
 * deleted, each branch and the repositories where it is deleted and those
 * where it is kept, not being merged there.
 */
export function branchesNote(
  inspection: Pick<WorktreeInspection, 'branch' | 'branches' | 'innerMembers'>,
  deleteMerged: boolean,
): NotePart[][] {
  const merged = mergedBranches(inspection)
  if (!deleteMerged || merged.length === 0) {
    if (inspection.branch === null) return [[text('No branch will be deleted.')]]
    return [
      [
        text('The branch '),
        user(inspection.branch),
        text(
          inspection.innerMembers.length > 0
            ? ' will be kept in every repository.'
            : ' will be kept.',
        ),
      ],
    ]
  }
  // A worktree without inner members has a single branch.
  if (inspection.branches.length === 1) {
    return [[text('The branch '), user(merged[0]!.branch!), text(' will be deleted.')]]
  }
  const named = inspection.branches.filter((entry) => entry.branch !== null)
  const names = [...new Set(named.map((entry) => entry.branch!))]
  return names.map((name) => {
    const repositories = (deleted: boolean) =>
      named
        .filter((entry) => entry.branch === name && entry.merged === deleted)
        .map((entry) => entry.repository)
    const deleted = repositories(true)
    const kept = repositories(false)
    const parts = [text('The branch '), user(name), text(' will be ')]
    if (deleted.length > 0) {
      parts.push(text('deleted in '), ...list(deleted))
      if (kept.length > 0) parts.push(text(' and kept in '), ...list(kept))
    } else {
      parts.push(text('kept in '), ...list(kept))
    }
    parts.push(text('.'))
    return parts
  })
}

/** A note as plain text, its sentences separated by spaces. */
export function noteText(sentences: readonly NotePart[][]): string {
  return sentences.map((parts) => parts.map((part) => part.text).join('')).join(' ')
}

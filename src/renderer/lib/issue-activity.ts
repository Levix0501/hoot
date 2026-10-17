import type { Issue, IssueStatus } from '../../shared/issues'
import type { LabelEvent } from '../../shared/labels'

/** Something that happened to an issue, as its activity lists it. */
export type ActivityEntry =
  | { kind: 'created'; at: number }
  /** It became done or canceled. */
  | { kind: 'completed'; at: number; status: IssueStatus }
  /** It was given a label, or had one taken off. */
  | { kind: 'label'; at: number; event: LabelEvent }

/**
 * What an issue's activity lists, in the order it happened: when it was
 * created; each label it was given or had taken off, as the label was
 * written then; and when it was done or canceled, if it is.
 */
export function activityEntries(
  issue: Pick<Issue, 'createdAt' | 'completedAt' | 'status'>,
  events: readonly LabelEvent[],
): ActivityEntry[] {
  const entries: ActivityEntry[] = [
    { kind: 'created', at: issue.createdAt },
    ...events
      .toSorted((a, b) => a.id - b.id)
      .map((event) => ({
        kind: 'label' as const,
        at: event.at,
        event,
      })),
  ]
  if (issue.completedAt !== null) {
    entries.push({ kind: 'completed', at: issue.completedAt, status: issue.status })
  }
  // Stable: what happened at the same time stays in the order it was recorded.
  return entries.toSorted((a, b) => a.at - b.at)
}

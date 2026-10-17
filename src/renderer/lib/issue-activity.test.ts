import { describe, expect, it } from 'vitest'
import type { LabelEvent } from '../../shared/labels'
import { activityEntries } from './issue-activity'

/** A label given to issue 1, or taken off it. */
const event = (id: number, kind: LabelEvent['kind'], label: string, at: number): LabelEvent => ({
  id,
  issueId: 1,
  kind,
  label,
  color: '4ea7fc',
  actor: 'user',
  at,
})

describe('activityEntries', () => {
  it('lists the creation, each label given or taken off, and the completion, in order', () => {
    const added = event(1, 'added', 'Spec-driven › Design', 200)
    const removed = event(2, 'removed', 'Spec-driven › Design', 300)
    const replaced = event(3, 'added', 'Spec-driven › Implement', 300)
    expect(
      activityEntries({ createdAt: 100, completedAt: 400, status: 'done' }, [
        replaced,
        added,
        removed,
      ]),
    ).toEqual([
      { kind: 'created', at: 100 },
      { kind: 'label', at: 200, event: added },
      { kind: 'label', at: 300, event: removed },
      { kind: 'label', at: 300, event: replaced },
      { kind: 'completed', at: 400, status: 'done' },
    ])
  })

  it('lists only the creation of an issue nothing happened to', () => {
    expect(activityEntries({ createdAt: 100, completedAt: null, status: 'todo' }, [])).toEqual([
      { kind: 'created', at: 100 },
    ])
  })
})

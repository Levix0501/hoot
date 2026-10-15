import { describe, expect, it } from 'vitest'
import { BUILT_IN_WORKFLOW } from '../../shared/built-in-workflow'
import type { WorkflowRecord } from '../../shared/workflows'
import { activityEntries, progressLabel } from './issue-workflow'

describe('progressLabel', () => {
  it('says Not started, the name of the step the issue is at, or Finished', () => {
    expect(progressLabel({ kind: 'not-started' }, BUILT_IN_WORKFLOW)).toBe('Not started')
    expect(
      progressLabel({ kind: 'at-step', step: 'design', run: 3, startedAt: 0 }, BUILT_IN_WORKFLOW),
    ).toBe('Design')
    expect(progressLabel({ kind: 'finished' }, BUILT_IN_WORKFLOW)).toBe('Finished')
  })
})

describe('activityEntries', () => {
  const issue = { createdAt: 100, completedAt: null, status: 'in_progress' } as const
  const records: WorkflowRecord[] = [
    { kind: 'step-started', id: 1, step: 'scope', at: 200 },
    {
      kind: 'step-reported',
      id: 2,
      step: 'scope',
      outcome: 'no-split',
      summary: '# Why',
      reporter: 'agent',
      at: 300,
    },
    { kind: 'step-started', id: 3, step: 'design', at: 300 },
  ]

  it('lists the creation, each outcome with its summary, and the step in progress since it started', () => {
    expect(activityEntries(issue, records, BUILT_IN_WORKFLOW)).toEqual([
      { kind: 'created', at: 100 },
      {
        kind: 'reported',
        id: 2,
        at: 300,
        step: 'Scope',
        outcome: 'No split',
        reporter: 'agent',
        summary: '# Why',
      },
      { kind: 'in-progress', id: 3, at: 300, step: 'Design' },
    ])
  })

  it('lists starting over, and nothing in progress once the issue is not started or finished', () => {
    const startedOver: WorkflowRecord[] = [...records, { kind: 'started-over', id: 4, at: 400 }]
    expect(
      activityEntries(issue, startedOver, BUILT_IN_WORKFLOW).map((entry) => entry.kind),
    ).toEqual(['created', 'reported', 'started-over'])
    const finished: WorkflowRecord[] = [
      ...records,
      {
        kind: 'step-reported',
        id: 4,
        step: 'design',
        outcome: 'implement',
        summary: null,
        reporter: 'user',
        at: 400,
      },
      { kind: 'step-started', id: 5, step: 'implement', at: 400 },
      {
        kind: 'step-reported',
        id: 6,
        step: 'implement',
        outcome: 'done',
        summary: null,
        reporter: 'user',
        at: 500,
      },
    ]
    expect(
      activityEntries(issue, finished, BUILT_IN_WORKFLOW).map((entry) =>
        entry.kind === 'reported'
          ? `${entry.step} · ${entry.outcome} · ${entry.reporter}`
          : entry.kind,
      ),
    ).toEqual([
      'created',
      'Scope · No split · agent',
      'Design · Implement directly · user',
      'Implement · Implemented · user',
    ])
  })

  it('puts the completion of the issue where it happened among the steps', () => {
    const done = { createdAt: 100, completedAt: 250, status: 'done' } as const
    expect(activityEntries(done, records, BUILT_IN_WORKFLOW).map((entry) => entry.kind)).toEqual([
      'created',
      'completed',
      'reported',
      'in-progress',
    ])
  })
})

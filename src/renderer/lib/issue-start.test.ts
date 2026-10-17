import { describe, expect, it } from 'vitest'
import { BUILT_IN_WORKFLOW } from '../../shared/built-in-workflow'
import type { StartBlocker } from '../../shared/start-blockers'
import type { WorkflowDefinition, WorkflowProgress } from '../../shared/workflows'
import { startHint, startState } from './issue-start'

const notStarted: WorkflowProgress = { kind: 'not-started' }
const atTriage: WorkflowProgress = { kind: 'at-step', step: BUILT_IN_WORKFLOW.steps[0]! }
const finished: WorkflowProgress = { kind: 'finished', label: BUILT_IN_WORKFLOW.endLabels[0]! }

describe('startState', () => {
  const worktreePath = '/home/.hoot/worktrees/gamma/iss-1-fix'
  const blockers: StartBlocker[] = [{ kind: 'waiting', issueIds: [2] }, { kind: 'no-project' }]

  it('shows the session opened last from the issue, whatever else holds', () => {
    for (const reasons of [[], blockers]) {
      expect(startState({ sessionId: 's1', blockers: reasons, worktreePath: null })).toEqual({
        kind: 'show',
        sessionId: 's1',
      })
    }
  })

  it('cannot start for any reason, also when the issue has a worktree', () => {
    expect(startState({ sessionId: null, blockers, worktreePath })).toEqual({
      kind: 'blocked',
      blockers,
    })
  })

  it("starts in the issue's worktree when it has one, and in a new one otherwise", () => {
    expect(startState({ sessionId: null, blockers: [], worktreePath })).toEqual({
      kind: 'worktree',
      worktreePath,
    })
    expect(startState({ sessionId: null, blockers: [], worktreePath: null })).toEqual({
      kind: 'new-worktree',
    })
  })
})

describe('startHint', () => {
  const worktree = { kind: 'worktree', worktreePath: '/w' } as const
  const newWorktree = { kind: 'new-worktree' } as const

  it('says that it shows the session opened last from the issue', () => {
    for (const progress of [notStarted, atTriage, finished]) {
      expect(startHint({ kind: 'show', sessionId: 's1' }, progress, BUILT_IN_WORKFLOW)).toBe(
        'Show the Claude Code session opened last from this issue',
      )
    }
  })

  it("starts the workflow's first step, in the issue's worktree or a new one", () => {
    expect(startHint(worktree, notStarted, BUILT_IN_WORKFLOW)).toBe(
      "Start Triage with Claude Code in this issue's worktree",
    )
    expect(startHint(newWorktree, notStarted, BUILT_IN_WORKFLOW)).toBe(
      'Start Triage with Claude Code in a new worktree',
    )
  })

  it('continues the step the issue is at, by its name in the workflow', () => {
    expect(startHint(worktree, atTriage, BUILT_IN_WORKFLOW)).toBe(
      "Continue Triage with Claude Code in this issue's worktree",
    )
    const renamed: WorkflowDefinition = {
      ...BUILT_IN_WORKFLOW,
      steps: [{ ...BUILT_IN_WORKFLOW.steps[0]!, name: 'Look' }],
    }
    expect(startHint(worktree, notStarted, renamed)).toBe(
      "Start Look with Claude Code in this issue's worktree",
    )
  })
})

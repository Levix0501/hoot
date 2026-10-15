import { describe, expect, it } from 'vitest'
import { BUILT_IN_WORKFLOW, ISSUE_WORKFLOW } from './built-in-workflow'
import { checkedWorkflow, checkWorkflow } from './workflow-check'
import {
  firstStep,
  outcomeLabel,
  reportsThisRound,
  stepName,
  workflowProgress,
  type WorkflowDefinition,
  type WorkflowRecord,
} from './workflows'

/** A small workflow of two steps, written as JSON would have it. */
function sample(): WorkflowDefinition {
  return {
    name: 'Sample',
    steps: [
      {
        id: 'look',
        name: 'Look',
        prompt: 'Look: read the issue.',
        outcomes: [
          { name: 'go', label: 'Go', instruction: 'go on.', next: 'make' },
          { name: 'stop', label: 'Stop', instruction: 'stop here.', next: null },
        ],
      },
      {
        id: 'make',
        name: 'Make',
        prompt: 'Make: build it.',
        outcomes: [{ name: 'done', label: 'Made', instruction: 'it is made.', next: null }],
      },
    ],
  }
}

describe('the built-in workflow', () => {
  it('passes the same check as any other workflow definition', () => {
    expect(checkWorkflow(BUILT_IN_WORKFLOW)).toEqual({ ok: true, workflow: BUILT_IN_WORKFLOW })
    expect(checkedWorkflow(BUILT_IN_WORKFLOW)).toEqual(BUILT_IN_WORKFLOW)
  })

  it('is plain data: written as JSON and read back, it is the same definition', () => {
    const read: unknown = JSON.parse(JSON.stringify(BUILT_IN_WORKFLOW))
    expect(read).toStrictEqual(BUILT_IN_WORKFLOW)
    expect(checkWorkflow(read)).toEqual({ ok: true, workflow: BUILT_IN_WORKFLOW })
  })

  it('goes Scope, Design, Implement, with the outcomes in their order and where each leads', () => {
    expect(
      BUILT_IN_WORKFLOW.steps.map((step) => ({
        step: step.name,
        outcomes: step.outcomes.map(({ name, label, next }) => [name, label, next]),
      })),
    ).toEqual([
      {
        step: 'Scope',
        outcomes: [
          ['no-split', 'No split', 'design'],
          ['split', 'Split', null],
        ],
      },
      { step: 'Design', outcomes: [['implement', 'Implement directly', 'implement']] },
      { step: 'Implement', outcomes: [['done', 'Implemented', null]] },
    ])
    expect(firstStep(BUILT_IN_WORKFLOW).name).toBe('Scope')
  })

  it('is the workflow every issue follows', () => {
    expect(ISSUE_WORKFLOW).toBe(BUILT_IN_WORKFLOW)
  })
})

describe('checkWorkflow', () => {
  it('takes a definition of any steps and outcomes, as it was given', () => {
    expect(checkWorkflow(sample())).toEqual({ ok: true, workflow: sample() })
  })

  it('refuses what is not a definition, or has more than one', () => {
    for (const value of [null, 'Sample', [], { name: 'Sample' }, { ...sample(), extra: 1 }]) {
      expect(checkWorkflow(value).ok).toBe(false)
    }
  })

  it('refuses a workflow without steps, and a step without outcomes', () => {
    expect(checkWorkflow({ ...sample(), steps: [] })).toEqual({
      ok: false,
      problems: ['steps: The workflow has no step.'],
    })
    const workflow = sample()
    workflow.steps[1]!.outcomes = []
    expect(checkWorkflow(workflow)).toEqual({
      ok: false,
      problems: ['steps.1.outcomes: A step has no outcome.'],
    })
  })

  it('refuses an outcome that leads to a step the workflow does not have', () => {
    const workflow = sample()
    workflow.steps[0]!.outcomes[0]!.next = 'build'
    expect(checkWorkflow(workflow)).toEqual({
      ok: false,
      problems: ['steps.0.outcomes.0.next: The outcome "go" leads to no step: "build".'],
    })
  })

  it('refuses two steps with an id or a name, and two outcomes of a step with a name', () => {
    const ids = sample()
    ids.steps[1]!.id = 'look'
    const names = sample()
    names.steps[1]!.name = 'Look'
    const outcomes = sample()
    outcomes.steps[0]!.outcomes[1]!.name = 'go'
    expect(checkWorkflow(ids).ok).toBe(false)
    expect(checkWorkflow(names)).toEqual({
      ok: false,
      problems: ['steps.1.name: Two steps have the name "Look".'],
    })
    expect(checkWorkflow(outcomes)).toEqual({
      ok: false,
      problems: ['steps.0.outcomes.1.name: Look has two outcomes named "go".'],
    })
    // The same outcome name in two steps is fine.
    const shared = sample()
    shared.steps[1]!.outcomes[0]!.name = 'go'
    expect(checkWorkflow(shared).ok).toBe(true)
  })

  it('refuses ids and outcome names that are not lower-case words joined by dashes', () => {
    for (const name of ['', 'No-split', 'no split', '-no', 'no--split', 'no_split']) {
      const workflow = sample()
      workflow.steps[0]!.outcomes[0]!.name = name
      expect(checkWorkflow(workflow).ok).toBe(false)
      const step = sample()
      step.steps[0]!.id = name
      expect(checkWorkflow(step).ok).toBe(false)
    }
  })

  it('refuses empty text, text with whitespace around it, and names and outcomes on more than one line', () => {
    const cases: Array<(workflow: WorkflowDefinition) => void> = [
      (workflow) => (workflow.name = ''),
      (workflow) => (workflow.steps[0]!.name = ' Look'),
      (workflow) => (workflow.steps[0]!.name = 'Lo\nok'),
      (workflow) => (workflow.steps[0]!.prompt = ''),
      (workflow) => (workflow.steps[0]!.prompt = 'Look.\n'),
      (workflow) => (workflow.steps[0]!.prompt = 'Look.\r\nNow.'),
      (workflow) => (workflow.steps[0]!.prompt = 'Look\0.'),
      (workflow) => (workflow.steps[0]!.outcomes[0]!.label = ''),
      (workflow) => (workflow.steps[0]!.outcomes[0]!.instruction = 'go\non.'),
    ]
    for (const change of cases) {
      const workflow = sample()
      change(workflow)
      expect(checkWorkflow(workflow).ok).toBe(false)
      expect(() => checkedWorkflow(workflow)).toThrow(/^Invalid workflow: /)
    }
    // A prompt has lines of its own.
    const lines = sample()
    lines.steps[0]!.prompt = 'Look:\n\n1. Read it.'
    expect(checkWorkflow(lines).ok).toBe(true)
  })
})

/** The record of a run of a step that started. */
const started = (id: number, step: string, at = id): WorkflowRecord => ({
  kind: 'step-started',
  id,
  step,
  at,
})

/** The record of an outcome the agent reported. */
const reported = (id: number, step: string, outcome: string): WorkflowRecord => ({
  kind: 'step-reported',
  id,
  step,
  outcome,
  summary: 'S',
  reporter: 'agent',
  at: id,
})

describe('workflowProgress', () => {
  it('is not started without records, and after the workflow started over', () => {
    expect(workflowProgress([])).toEqual({ kind: 'not-started' })
    expect(workflowProgress([started(1, 'look'), { kind: 'started-over', id: 2, at: 2 }])).toEqual({
      kind: 'not-started',
    })
  })

  it('is at the step whose run started last', () => {
    expect(workflowProgress([started(1, 'look', 10)])).toEqual({
      kind: 'at-step',
      step: 'look',
      run: 1,
      startedAt: 10,
    })
    expect(
      workflowProgress([started(1, 'look'), reported(2, 'look', 'go'), started(3, 'make', 2)]),
    ).toEqual({ kind: 'at-step', step: 'make', run: 3, startedAt: 2 })
  })

  it('is finished once an outcome was reported that no run followed', () => {
    expect(workflowProgress([started(1, 'look'), reported(2, 'look', 'stop')])).toEqual({
      kind: 'finished',
    })
  })

  it('lists the outcomes reported since the workflow last started over', () => {
    const records = [
      started(1, 'look'),
      reported(2, 'look', 'stop'),
      { kind: 'started-over', id: 3, at: 3 } as const,
      started(4, 'look'),
      reported(5, 'look', 'go'),
      started(6, 'make'),
    ]
    expect(reportsThisRound(records).map((record) => record.id)).toEqual([5])
    expect(reportsThisRound(records.slice(0, 2)).map((record) => record.id)).toEqual([2])
    expect(reportsThisRound([])).toEqual([])
  })

  it('names steps and outcomes as the workflow does, or by their ids when it no longer has them', () => {
    expect(stepName(sample(), 'make')).toBe('Make')
    expect(stepName(sample(), 'gone')).toBe('gone')
    expect(outcomeLabel(sample(), 'make', 'done')).toBe('Made')
    expect(outcomeLabel(sample(), 'make', 'gone')).toBe('gone')
    expect(outcomeLabel(sample(), 'gone', 'done')).toBe('done')
  })
})

import { describe, expect, it } from 'vitest'
import { BUILT_IN_WORKFLOW, ISSUE_WORKFLOW } from './built-in-workflow'
import { checkedWorkflow, checkWorkflow } from './workflow-check'
import {
  endLabelNamed,
  firstStep,
  stepOfLabel,
  workflowLabels,
  workflowProgress,
  type WorkflowDefinition,
} from './workflows'

/** A small workflow of two steps and two end labels, written as JSON would have it. */
function sample(): WorkflowDefinition {
  return {
    name: 'Sample',
    group: 'Sample',
    steps: [
      {
        name: 'Look',
        label: { name: 'Looking', color: '4ea7fc', description: 'Reading it' },
        prompt: 'Look: read the issue.',
        outcomes: [
          { label: 'Making', instruction: 'Go on.', goOn: true },
          { label: 'Dropped', instruction: 'Stop here.', goOn: false },
        ],
      },
      {
        name: 'Make',
        label: { name: 'Making', color: 'bb87fc', description: '' },
        prompt: 'Make: build it.',
        outcomes: [{ label: 'Made', instruction: 'It is made.', goOn: false }],
      },
    ],
    endLabels: [
      { name: 'Made', color: '4cb782', description: '', completeWithSubIssues: false },
      { name: 'Dropped', color: '95a2b3', description: '', completeWithSubIssues: true },
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

  it('is Spec-driven, with the group Spec-driven, and has one step for now: Triage', () => {
    expect(BUILT_IN_WORKFLOW.name).toBe('Spec-driven')
    expect(BUILT_IN_WORKFLOW.group).toBe('Spec-driven')
    expect(BUILT_IN_WORKFLOW.steps.map((step) => [step.name, step.label.name])).toEqual([
      ['Triage', 'triaging'],
    ])
    expect(workflowLabels(BUILT_IN_WORKFLOW).map((label) => label.name)).toEqual([
      'triaging',
      'ready to design',
      'split',
    ])
    expect(firstStep(BUILT_IN_WORKFLOW).name).toBe('Triage')
  })

  it('ends Triage at ready to design or split, stopping either way', () => {
    expect(
      BUILT_IN_WORKFLOW.steps.map((step) => ({
        step: step.name,
        outcomes: step.outcomes.map(({ label, goOn }) => [label, goOn]),
      })),
    ).toEqual([
      {
        step: 'Triage',
        outcomes: [
          ['ready to design', false],
          ['split', false],
        ],
      },
    ])
  })

  it('completes an issue split once its sub-issues are, and not one ready to design', () => {
    expect(
      BUILT_IN_WORKFLOW.endLabels.map(({ name, completeWithSubIssues }) => [
        name,
        completeWithSubIssues,
      ]),
    ).toEqual([
      ['ready to design', false],
      ['split', true],
    ])
  })

  it('tells the agent what each outcome means, and how to write a split back', () => {
    const [one, split] = BUILT_IN_WORKFLOW.steps[0]!.outcomes
    expect(one!.instruction).toBe('The issue is one piece of work.')
    const { instruction } = split!
    expect(instruction).toMatch(/^I confirmed the split\.\n/)
    expect(instruction).toContain('to a JSON file next to the issue file')
    expect(instruction).toContain('"labels": ["ready to design"]')
    expect(instruction).toContain('"status": "todo"')
    expect(instruction).toContain('"blocking": ["{issue}"]')
    expect(instruction).toContain('In `"blockedBy"`, list the issues it waits on')
    expect(instruction).toMatch(/\nRun `hoot issue create-batch \{issue\} --file <file>`\.$/)
  })

  it('is the workflow every issue follows', () => {
    expect(ISSUE_WORKFLOW).toBe(BUILT_IN_WORKFLOW)
  })
})

describe('checkWorkflow', () => {
  it('takes a definition of any steps, outcomes and end labels, as it was given', () => {
    expect(checkWorkflow(sample())).toEqual({ ok: true, workflow: sample() })
    expect(checkWorkflow({ ...sample(), endLabels: [] }).ok).toBe(false)
    const none = sample()
    none.endLabels = []
    none.steps = [
      { ...none.steps[1]!, outcomes: [{ label: 'Making', instruction: 'Again.', goOn: true }] },
    ]
    expect(checkWorkflow(none).ok).toBe(true)
  })

  it('refuses what is not a definition, or has more than one', () => {
    for (const value of [null, 'Sample', [], { name: 'Sample' }, { ...sample(), extra: 1 }]) {
      expect(checkWorkflow(value).ok).toBe(false)
    }
  })

  it('refuses a workflow without steps, and a step without outcomes', () => {
    expect(checkWorkflow({ ...sample(), steps: [] }).ok).toBe(false)
    const workflow = sample()
    workflow.steps[1]!.outcomes = []
    expect(checkWorkflow(workflow)).toEqual({
      ok: false,
      problems: ['steps.1.outcomes: A step has no outcome.'],
    })
  })

  it('refuses an outcome that changes to a label the workflow does not have', () => {
    const workflow = sample()
    workflow.steps[0]!.outcomes[0]!.label = 'Building'
    expect(checkWorkflow(workflow)).toEqual({
      ok: false,
      problems: [
        'steps.0.outcomes.0.label: The outcome changes to "Building", which is no label of the workflow.',
      ],
    })
  })

  it('refuses an outcome that goes on after an end label', () => {
    const workflow = sample()
    workflow.steps[1]!.outcomes[0]!.goOn = true
    expect(checkWorkflow(workflow).ok).toBe(false)
  })

  it('refuses two steps with a name, and two labels with a name, whatever its case', () => {
    const steps = sample()
    steps.steps[1]!.name = 'look'
    const labels = sample()
    labels.endLabels[1]!.name = 'making'
    expect(checkWorkflow(steps)).toEqual({
      ok: false,
      problems: ['steps.1.name: Two steps have the name "look".'],
    })
    expect(checkWorkflow(labels).ok).toBe(false)
  })

  it('refuses a color that is not six lower-case hexadecimal digits, and a name with a comma', () => {
    for (const color of ['red', '#4ea7fc', '4EA7FC', '4ea7f']) {
      const workflow = sample()
      workflow.steps[0]!.label.color = color
      expect(checkWorkflow(workflow).ok).toBe(false)
    }
    const comma = sample()
    comma.endLabels[0]!.name = 'Made,well'
    expect(checkWorkflow(comma).ok).toBe(false)
  })

  it('refuses empty text, text with whitespace around it, and names on more than one line', () => {
    const cases: Array<(workflow: WorkflowDefinition) => void> = [
      (workflow) => (workflow.name = ''),
      (workflow) => (workflow.group = ''),
      (workflow) => (workflow.steps[0]!.name = ' Look'),
      (workflow) => (workflow.steps[0]!.name = 'Lo\nok'),
      (workflow) => (workflow.steps[0]!.label.name = 'Lo\nok'),
      (workflow) => (workflow.steps[0]!.prompt = ''),
      (workflow) => (workflow.steps[0]!.prompt = 'Look.\n'),
      (workflow) => (workflow.steps[0]!.prompt = 'Look.\r\nNow.'),
      (workflow) => (workflow.steps[0]!.prompt = 'Look\0.'),
      (workflow) => (workflow.steps[0]!.outcomes[0]!.instruction = ''),
      (workflow) => (workflow.endLabels[0]!.description = 'Made\nwell'),
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

describe('workflowProgress', () => {
  it('is not started without a label of the workflow', () => {
    expect(workflowProgress(sample(), [])).toEqual({ kind: 'not-started' })
    expect(workflowProgress(sample(), ['bug'])).toEqual({ kind: 'not-started' })
  })

  it("is at the step of a step's label, whatever its case", () => {
    expect(workflowProgress(sample(), ['making'])).toEqual({
      kind: 'at-step',
      step: sample().steps[1],
    })
  })

  it('is finished with an end label', () => {
    expect(workflowProgress(sample(), ['bug', 'Dropped'])).toEqual({
      kind: 'finished',
      label: sample().endLabels[1],
    })
  })

  it("finds steps and end labels by their labels' names", () => {
    expect(stepOfLabel(sample(), 'LOOKING')?.name).toBe('Look')
    expect(stepOfLabel(sample(), 'Made')).toBeUndefined()
    expect(endLabelNamed(sample(), 'made')?.name).toBe('Made')
    expect(endLabelNamed(sample(), 'Looking')).toBeUndefined()
  })
})

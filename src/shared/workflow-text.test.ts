import { describe, expect, it } from 'vitest'
import { BUILT_IN_WORKFLOW } from './built-in-workflow'
import {
  filledIn,
  firstMessage,
  goesOn,
  labelCommand,
  outcomeInstructions,
  workflowFileText,
} from './workflow-text'
import type { WorkflowDefinition, WorkflowStep } from './workflows'

const [triage] = BUILT_IN_WORKFLOW.steps as [WorkflowStep]

/** The prompt of the built-in Triage, word for word. */
const TRIAGE_PROMPT = [
  'Judge the issue against this project.',
  '',
  '1. Is the issue one piece of work, or several? Several means it asks for results that could each be delivered and accepted on its own, such as two features, or a feature and an unrelated fix. Answer one or several, and say why.',
  '2. If one, that is the end of this step: do not ask me to confirm it.',
  '3. If several, split it into one issue per result. For each:',
  '   - Title',
  '   - Description: what it delivers, and how to accept it',
  '   - Waits on: the issues it cannot be delivered and accepted without, or none',
  '4. End the split with the order, one chain per line, such as `1 → 2 → 4` and `1 → 3`.',
  '5. Ask me to confirm the split. If I object or ask for changes, revise it and ask me again, until I confirm.',
  '',
  "Write titles and descriptions in the issue's language. Where the issue leaves open something that changes your answer, say what you assumed.",
].join('\n')

/** A workflow of two steps: Look, which goes on to Make or stops, and Make. */
const SAMPLE: WorkflowDefinition = {
  name: 'Sample',
  group: 'Sample',
  steps: [
    {
      name: 'Look',
      label: { name: 'Looking', color: '4ea7fc', description: '' },
      prompt: 'Look: read {issue}.',
      outcomes: [
        { label: 'Making', instruction: 'It is worth making.', goOn: true },
        { label: 'Dropped', instruction: 'Drop {issue}.', goOn: false },
      ],
    },
    {
      name: 'Make',
      label: { name: 'Making', color: 'bb87fc', description: '' },
      prompt: 'Make: build it.',
      outcomes: [{ label: 'made well', instruction: 'It is made.', goOn: false }],
    },
  ],
  endLabels: [
    { name: 'made well', color: '4cb782', description: '', completeWithSubIssues: false },
    { name: 'Dropped', color: '95a2b3', description: '', completeWithSubIssues: true },
  ],
}

const [look, make] = SAMPLE.steps as [WorkflowStep, WorkflowStep]

describe('the built-in prompt', () => {
  it('is word for word as settled', () => {
    expect(triage.prompt).toBe(TRIAGE_PROMPT)
  })
})

describe('filledIn', () => {
  it("puts the issue's identifier in place of {issue}", () => {
    expect(filledIn('hoot issue create-batch {issue} --file x, blocking {issue}', 'ISS-12')).toBe(
      'hoot issue create-batch ISS-12 --file x, blocking ISS-12',
    )
    expect(filledIn('{"title": "A"}', 'ISS-12')).toBe('{"title": "A"}')
  })
})

describe('labelCommand', () => {
  it("quotes a label's name that a shell would take for more than one word", () => {
    expect(labelCommand('ISS-7', 'split')).toBe('hoot issue edit ISS-7 --add-label split')
    expect(labelCommand('ISS-7', 'ready to design')).toBe(
      "hoot issue edit ISS-7 --add-label 'ready to design'",
    )
    expect(labelCommand('ISS-7', "won't do")).toBe(`hoot issue edit ISS-7 --add-label "won't do"`)
  })
})

describe('goesOn', () => {
  it('is whether any outcome of the step goes on', () => {
    expect(goesOn(look)).toBe(true)
    expect(goesOn(make)).toBe(false)
    expect(goesOn(triage)).toBe(false)
  })
})

describe('outcomeInstructions', () => {
  it('lists each outcome: its instruction, the command that changes the label, and whether to go on', () => {
    expect(outcomeInstructions(SAMPLE, look, 'ISS-7')).toBe(
      [
        'When this step is done, end it with the one of these outcomes that applies:',
        '',
        '- It is worth making.',
        '  Run `hoot issue edit ISS-7 --add-label Making`, then go on with the step Make in workflow.md.',
        '- Drop ISS-7.',
        '  Run `hoot issue edit ISS-7 --add-label Dropped`, then stop.',
      ].join('\n'),
    )
  })

  it('keeps an instruction of several lines in its item', () => {
    const step = {
      outcomes: [{ label: 'Dropped', instruction: 'Check it.\n\nTidy up.', goOn: false }],
    }
    expect(outcomeInstructions(SAMPLE, step, 'ISS-7').split('\n').slice(2)).toEqual([
      '- Check it.',
      '',
      '  Tidy up.',
      '  Run `hoot issue edit ISS-7 --add-label Dropped`, then stop.',
    ])
  })

  it('ends Triage at ready to design or split, stopping either way', () => {
    const text = outcomeInstructions(BUILT_IN_WORKFLOW, triage, 'ISS-7')
    expect(text).toBe(
      [
        'When this step is done, end it with the one of these outcomes that applies:',
        '',
        '- The issue is one piece of work.',
        "  Run `hoot issue edit ISS-7 --add-label 'ready to design'`, then stop.",
        '- I confirmed the split.',
        '  Write the issues of the split, in order, to a JSON file next to the issue file:',
        '  `[{"title": "…", "description": "…", "labels": ["ready to design"], "status": "todo", "blocking": ["ISS-7"], "blockedBy": […]}, …]`',
        '  In `"blockedBy"`, list the issues it waits on: those of the split by their place in the array, from 1, others by their identifiers.',
        '  Run `hoot issue create-batch ISS-7 --file <file>`.',
        '  Run `hoot issue edit ISS-7 --add-label split`, then stop.',
      ].join('\n'),
    )
    expect(text).not.toContain('{issue}')
  })
})

describe('firstMessage', () => {
  const message = firstMessage({
    workflow: BUILT_IN_WORKFLOW,
    identifier: 'ISS-7',
    issueFile: '/work/a/.hoot/tmp/issue-x/issue.md',
    workflowFile: '/work/a/.hoot/tmp/issue-x/workflow.md',
    branch: 'iss-7-fix-it',
    step: triage,
  })

  it('says where the issue file is and names the branch, then gives the prompt and the outcomes', () => {
    expect(message).toBe(
      [
        'The issue is in `/work/a/.hoot/tmp/issue-x/issue.md`.',
        'This is a Git worktree of the project, on the branch `iss-7-fix-it`, made for this issue.',
        TRIAGE_PROMPT,
        outcomeInstructions(BUILT_IN_WORKFLOW, triage, 'ISS-7'),
      ].join('\n\n'),
    )
  })

  it('ends without a line break', () => {
    expect(message.endsWith('\n')).toBe(false)
  })

  it('says where the file of the workflow is too when the step may go on to another', () => {
    const at = firstMessage({
      workflow: SAMPLE,
      identifier: 'ISS-7',
      issueFile: '/i.md',
      workflowFile: '/w.md',
      branch: 'b',
      step: look,
    })
    expect(at.split('\n\n')[0]).toBe(
      'The issue is in `/i.md`, and the workflow it goes through in `/w.md`.',
    )
  })

  it('gives the prompt and the outcomes of the step it is given', () => {
    const at = firstMessage({
      workflow: SAMPLE,
      identifier: 'ISS-7',
      issueFile: '/i.md',
      workflowFile: '/w.md',
      branch: 'b',
      step: make,
    })
    expect(at).toContain('Make: build it.')
    expect(at).toContain("`hoot issue edit ISS-7 --add-label 'made well'`")
    expect(at).not.toContain('/w.md')
  })
})

describe('workflowFileText', () => {
  it('gives the name, each step in order with its label, prompt and outcomes, and the end labels', () => {
    expect(workflowFileText(SAMPLE, 'ISS-7')).toBe(
      [
        '# Sample',
        '',
        'The workflow ISS-7 goes through. How far the issue has come is the label of the group Sample it carries: none before it starts, the label of the step it is at, or an end label once it is finished. An issue carries one label of the group at most: adding one with `hoot issue edit ISS-7 --add-label <label>` takes the other off.',
        '',
        '## 1. Look',
        '',
        'Label: `Looking`',
        '',
        'Look: read ISS-7.',
        '',
        'Outcomes:',
        '',
        '- It is worth making.',
        '  Run `hoot issue edit ISS-7 --add-label Making`, then go on with the step Make.',
        '- Drop ISS-7.',
        '  Run `hoot issue edit ISS-7 --add-label Dropped`, then stop.',
        '',
        '## 2. Make',
        '',
        'Label: `Making`',
        '',
        'Make: build it.',
        '',
        'Outcomes:',
        '',
        '- It is made.',
        "  Run `hoot issue edit ISS-7 --add-label 'made well'`, then stop.",
        '',
        '## End labels',
        '',
        '- `made well`',
        '- `Dropped`: once the issue has at least one sub-issue that Hoot shows, and each of them is done or canceled, Hoot completes the issue: Done when at least one of them is done, Canceled otherwise.',
        '',
      ].join('\n'),
    )
  })
})

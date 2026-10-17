import { describe, expect, it } from 'vitest'
import { BUILT_IN_WORKFLOW } from './built-in-workflow'
import {
  filledIn,
  firstMessage,
  labelCommand,
  outcomeInstructions,
  workflowFileText,
} from './workflow-text'
import type { WorkflowStep } from './workflows'

const [scope, design, implement] = BUILT_IN_WORKFLOW.steps as [
  WorkflowStep,
  WorkflowStep,
  WorkflowStep,
]

/** The prompts of the built-in steps word for word as they were before labels marked the steps. */
const SCOPE_PROMPT = [
  "Scope: judge the issue against this project's code. Read whatever you need, but change nothing: no edits, no commits, no commands that change files.",
  '',
  '1. Is the issue one piece of work, or several? Several means it asks for results that could each be delivered and accepted on its own, such as two features, or a feature and an unrelated fix. How much work it is does not count here: that is judged once its design is settled. Answer one or several, and say why.',
  '2. If one, say so.',
  '3. If several, split it into one issue per result. For each:',
  '   - Title',
  '   - Description: what it delivers, and how to accept it',
  '   - Waits on: the issues it cannot be delivered and accepted without, or none',
  '4. End the split with the order, one chain per line, such as `1 → 2 → 4` and `1 → 3`.',
  '5. Ask me to confirm your answer, with the split if there is one. If I object or ask for changes, revise it and ask me again, until I confirm.',
  '',
  "Write titles and descriptions in the issue's language. Where the issue leaves open something that changes your answer, say what you assumed.",
].join('\n')

const DESIGN_PROMPT = [
  'Design: settle with me how the issue is to be built, before anything changes. Read whatever you need, but change nothing yet.',
  '',
  'Interview me until every decision about the issue is settled. A decision is a choice that whoever implements the issue may not make on their own. A decision the issue already states, or an earlier step settled, is settled: do not ask it again. Ask me only for decisions, and for facts only I can provide. Find out every other fact yourself, from the code and the environment, even one I stated; when what you find contradicts me, put it to me as a decision.',
  '',
  'Ask in rounds. Each round asks every open decision whose prerequisites are settled, those that unblock the most first. Put the option you recommend first, with its main reason and its cost. Use your tool for asking structured questions if you have one; otherwise ask in your reply, with numbered options. Wait for my answers before the next round.',
  '',
  'When nothing is left open, summarize:',
  '- what the issue delivers, and what it leaves out',
  '- each decision, as I settled it',
  '- the facts you relied on, each with how you established it, and the risks I accepted',
  '',
  'Then judge the workload of the issue as settled: can one fresh agent session implement the whole issue, and another fresh session then verify it in full? Answer yes or no, and say why: the parts of the code it touches, and what is still unknown. Do not estimate time. If no, split it into issues that one session can each implement and another verify. Each delivers a narrow but complete result through every layer it touches, never one layer of the whole. For each:',
  '- Title',
  '- Description: what it delivers, how to accept it, and the decisions and facts above that it relies on',
  '- Waits on: the issues it cannot be delivered and accepted without, or none',
  '',
  "End the split with the order, one chain per line, such as `1 → 2 → 4` and `1 → 3`. Write titles and descriptions in the issue's language.",
  '',
  'Ask me to confirm the summary, with the split if there is one. If I object or ask for changes, revise it and ask me again, until I confirm.',
].join('\n')

const IMPLEMENT_PROMPT = 'Implement: implement the issue here, as the earlier steps settled it.'

describe('the built-in prompts', () => {
  it('are word for word what they were', () => {
    expect(scope.prompt).toBe(SCOPE_PROMPT)
    expect(design.prompt).toBe(DESIGN_PROMPT)
    expect(implement.prompt).toBe(IMPLEMENT_PROMPT)
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

describe('outcomeInstructions', () => {
  it('lists each outcome: its instruction, the command that changes the label, and whether to go on', () => {
    const text = outcomeInstructions(BUILT_IN_WORKFLOW, scope, 'ISS-7')
    expect(text).toBe(
      [
        "When this step is done, end it with the one of these outcomes that applies, by changing the issue's label of the group Spec-driven with Hoot's `hoot` command:",
        '',
        '- I confirmed that the issue is one piece of work.',
        '  Then change the label to Design with `hoot issue edit ISS-7 --add-label Design`, and go on with the step of that label, Design, as workflow.md gives it.',
        `- ${filledIn(scope.outcomes[1]!.instruction, 'ISS-7')}`,
        '  Then change the label to Split with `hoot issue edit ISS-7 --add-label Split`, and stop.',
      ].join('\n'),
    )
    expect(text).toContain('`hoot issue create-batch ISS-7 --file <file>`')
    expect(text).toContain('`"blocking": ["ISS-7"]`')
    expect(text).not.toContain('{issue}')
  })

  it('stops after the end label of Implement', () => {
    expect(outcomeInstructions(BUILT_IN_WORKFLOW, implement, 'ISS-7')).toContain(
      '- The issue is implemented.\n  Then change the label to Implemented with `hoot issue edit ISS-7 --add-label Implemented`, and stop.',
    )
  })
})

describe('firstMessage', () => {
  const message = firstMessage({
    workflow: BUILT_IN_WORKFLOW,
    identifier: 'ISS-7',
    issueFile: '/work/a/.hoot/tmp/issue-x/issue.md',
    workflowFile: '/work/a/.hoot/tmp/issue-x/workflow.md',
    branch: 'iss-7-fix-it',
    step: scope,
  })

  it('points to the files, names the branch and the step, then gives the prompt and the outcomes', () => {
    expect(message).toBe(
      [
        'The issue to work on is ISS-7, in `/work/a/.hoot/tmp/issue-x/issue.md`. Read it first: its title is the heading; the rest, if any, is its description. Then read `/work/a/.hoot/tmp/issue-x/workflow.md`: the workflow Spec-driven, which work on the issue goes through, step by step.',
        "This is a Git worktree of the project, on the branch `iss-7-fix-it`, made for this issue. This session starts at the step Scope, which the issue's label Scope marks.",
        SCOPE_PROMPT,
        outcomeInstructions(BUILT_IN_WORKFLOW, scope, 'ISS-7'),
      ].join('\n\n'),
    )
  })

  it('ends without a line break', () => {
    expect(message.endsWith('\n')).toBe(false)
  })

  it('starts at the step it is given', () => {
    const at = firstMessage({
      workflow: BUILT_IN_WORKFLOW,
      identifier: 'ISS-7',
      issueFile: '/i.md',
      workflowFile: '/w.md',
      branch: 'b',
      step: design,
    })
    expect(at).toContain('This session starts at the step Design')
    expect(at).toContain(DESIGN_PROMPT)
    expect(at).toContain('`hoot issue edit ISS-7 --add-label Implement`')
  })
})

describe('workflowFileText', () => {
  const text = workflowFileText(BUILT_IN_WORKFLOW, 'ISS-7')

  it('gives the name, each step in order with its label, prompt and outcomes, and the end labels', () => {
    expect(text.startsWith('# Spec-driven\n\n')).toBe(true)
    expect(text.endsWith('\n')).toBe(true)
    const scopeAt = text.indexOf('## 1. Scope\n\nLabel: Scope\n\n' + SCOPE_PROMPT)
    const designAt = text.indexOf('## 2. Design\n\nLabel: Design\n\n' + DESIGN_PROMPT)
    const implementAt = text.indexOf('## 3. Implement\n\nLabel: Implement\n\n' + IMPLEMENT_PROMPT)
    const endsAt = text.indexOf('## End labels')
    expect(scopeAt).toBeGreaterThan(0)
    expect(designAt).toBeGreaterThan(scopeAt)
    expect(implementAt).toBeGreaterThan(designAt)
    expect(endsAt).toBeGreaterThan(implementAt)
  })

  it('gives each outcome the label it changes to, its instruction, and whether it goes on', () => {
    expect(text).toContain(
      [
        '- I confirmed that the issue is one piece of work.',
        `  - Changes the label to: Design (\`${labelCommand('ISS-7', 'Design')}\`)`,
        '  - Go on: on; once the label is changed, go on with the step of that label, Design.',
      ].join('\n'),
    )
    expect(text).toContain(
      [
        '- I confirmed the summary, and the issue fits one session.',
        '  - Changes the label to: Implement (`hoot issue edit ISS-7 --add-label Implement`)',
        '  - Go on: on; once the label is changed, go on with the step of that label, Implement.',
      ].join('\n'),
    )
    expect(text).toContain(
      [
        '- The issue is implemented.',
        '  - Changes the label to: Implemented (`hoot issue edit ISS-7 --add-label Implemented`)',
        '  - Go on: off; once the label is changed, stop.',
      ].join('\n'),
    )
    for (const instruction of [scope.outcomes[1]!.instruction, design.outcomes[1]!.instruction]) {
      expect(text).toContain(
        [
          `- ${filledIn(instruction, 'ISS-7')}`,
          '  - Changes the label to: Split (`hoot issue edit ISS-7 --add-label Split`)',
          '  - Go on: off; once the label is changed, stop.',
        ].join('\n'),
      )
    }
    expect(text).toContain('`hoot issue create-batch ISS-7 --file <file>`')
    expect(text).toContain('`"labels": ["Design"]`')
    expect(text).toContain('`"labels": ["Implement"]`')
  })

  it('says that Split completes the issue once its sub-issues are, and Implemented nothing', () => {
    expect(text).toContain(
      '- Split: once the issue has at least one sub-issue that Hoot shows, and each of them is done or canceled, Hoot completes the issue: Done when at least one of them is done, Canceled otherwise.',
    )
    expect(text).toMatch(/\n- Implemented\n$/)
  })
})

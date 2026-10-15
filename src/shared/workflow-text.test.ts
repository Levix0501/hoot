import { describe, expect, it } from 'vitest'
import { BUILT_IN_WORKFLOW } from './built-in-workflow'
import {
  firstMessage,
  PICKED_IN_HOOT,
  reportInstructions,
  stepReportText,
  stepsFileText,
  WORKFLOW_FINISHED,
} from './workflow-text'
import type { WorkflowStep } from './workflows'

const [scope, design, implement] = BUILT_IN_WORKFLOW.steps as [
  WorkflowStep,
  WorkflowStep,
  WorkflowStep,
]

const SCOPE_PROMPT = [
  "Scope: judge the issue against this project's code. Read whatever you need, but change nothing: no edits, no commits, no commands that change files.",
  '',
  '1. Is the issue one piece of work, or several? Several means it asks for results that could each be delivered and accepted on its own, such as two features, or a feature and an unrelated fix. How much work it is does not count here: that is judged once its design is settled. Answer one or several, and say why.',
  '2. If one, say so, and wait for me to confirm.',
  '3. If several, split it into one issue per result. For each:',
  '   - Title',
  '   - Description: what it delivers, and how to accept it',
  '   - Waits on: the issues it cannot be delivered and accepted without, or none',
  '4. End the split with the order, one chain per line, such as `1 → 2 → 4` and `1 → 3`.',
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
  'Ask me to confirm the summary, with the split if there is one.',
].join('\n')

const IMPLEMENT_PROMPT = 'Implement: implement the issue here, as the earlier steps settled it.'

/** How every step asks to be reported, around the list of its outcomes. */
function reporting(outcomes: string[]): string {
  return [
    "When this step is done, report it with Hoot's `hoot` command:",
    '',
    '  hoot step report <outcome> --summary-file <file>',
    '',
    '<outcome> is one of:',
    ...outcomes,
    '',
    "The summary is Markdown, for me and for the steps after this one, which may start in a new session that has only the issue and the summaries. Write the file next to the issue's file, in a folder that Git ignores, or pass `-` to read standard input. hoot then says what to do next.",
  ].join('\n')
}

const SCOPE_REPORTING = reporting([
  '- no-split: I confirmed that the issue is one piece of work. The summary says why.',
  '- split: the issue is several pieces of work. The summary is the split.',
])
const DESIGN_REPORTING = reporting([
  '- implement: I confirmed the summary, and the issue fits one session. The summary is the confirmed summary.',
  '- split: I confirmed the summary and the split. The summary is the confirmed summary, with the split after it.',
])
const IMPLEMENT_REPORTING = reporting([
  '- done: the issue is implemented. The summary says what changed, how you verified it, and what is left undone.',
])

describe('the built-in steps', () => {
  it('have their prompts word for word', () => {
    expect([scope.prompt, design.prompt, implement.prompt]).toEqual([
      SCOPE_PROMPT,
      DESIGN_PROMPT,
      IMPLEMENT_PROMPT,
    ])
  })

  it('ask to be reported with their outcomes, in order, each with what it means', () => {
    expect(reportInstructions(scope)).toBe(SCOPE_REPORTING)
    expect(reportInstructions(design)).toBe(DESIGN_REPORTING)
    expect(reportInstructions(implement)).toBe(IMPLEMENT_REPORTING)
  })
})

describe('firstMessage', () => {
  it('opens with the issue, the branch and the step, then gives the step and how to report it', () => {
    const message = firstMessage({
      issueFile:
        '/home/me/.hoot/worktrees/app/iss-1-fix-the-login-bug-on-safari/.hoot/tmp/issue-1/issue.md',
      stepsFile: null,
      branch: 'iss-1-fix-the-login-bug-on-safari',
      step: scope,
    })
    expect(message).toBe(
      [
        'The issue to work on is in `/home/me/.hoot/worktrees/app/iss-1-fix-the-login-bug-on-safari/.hoot/tmp/issue-1/issue.md`. Read it first: its title is the heading; the rest, if any, is its description.',
        '',
        'This is a Git worktree of the project, on the branch `iss-1-fix-the-login-bug-on-safari`, made for this issue. Work on the issue goes in steps; this session starts at the step Scope.',
        '',
        SCOPE_PROMPT,
        '',
        SCOPE_REPORTING,
      ].join('\n'),
    )
    // Lines end with LF alone, and nothing follows the last one.
    expect(message).not.toMatch(/\r|\s$/)
  })

  it('points to what earlier steps found when there is a file of it', () => {
    const message = firstMessage({
      issueFile: '/home/me/.hoot/worktrees/app/iss-13/.hoot/tmp/issue-AbC/issue.md',
      stepsFile: '/home/me/.hoot/worktrees/app/iss-13/.hoot/tmp/issue-AbC/steps.md',
      branch: 'iss-13-修复登录页的问题',
      step: design,
    })
    expect(message).toBe(
      [
        'The issue to work on is in `/home/me/.hoot/worktrees/app/iss-13/.hoot/tmp/issue-AbC/issue.md`. Read it first: its title is the heading; the rest, if any, is its description. What earlier steps found is in `/home/me/.hoot/worktrees/app/iss-13/.hoot/tmp/issue-AbC/steps.md`; read it too.',
        '',
        'This is a Git worktree of the project, on the branch `iss-13-修复登录页的问题`, made for this issue. Work on the issue goes in steps; this session starts at the step Design.',
        '',
        DESIGN_PROMPT,
        '',
        DESIGN_REPORTING,
      ].join('\n'),
    )
  })

  it('names no agent', () => {
    for (const step of BUILT_IN_WORKFLOW.steps) {
      const message = firstMessage({ issueFile: '/i.md', stepsFile: '/s.md', branch: 'b', step })
      expect(message).not.toMatch(/Claude|Codex|OpenCode/)
    }
  })
})

describe('stepReportText', () => {
  it("says what was reported, then gives the next step's prompt and how to report it", () => {
    expect(
      stepReportText({ issue: 'ISS-1', step: 'Scope', outcome: 'No split', next: design }),
    ).toBe(
      `ISS-1: Scope → No split. Next step: Design.\n\n${DESIGN_PROMPT}\n\n${DESIGN_REPORTING}\n`,
    )
    expect(
      stepReportText({
        issue: 'ISS-1',
        step: 'Design',
        outcome: 'Implement directly',
        next: implement,
      }),
    ).toBe(
      `ISS-1: Design → Implement directly. Next step: Implement.\n\n${IMPLEMENT_PROMPT}\n\n${IMPLEMENT_REPORTING}\n`,
    )
  })

  it('says that the workflow is finished when nothing comes next', () => {
    expect(
      stepReportText({ issue: 'ISS-1', step: 'Implement', outcome: 'Implemented', next: null }),
    ).toBe('ISS-1: Implement → Implemented. The workflow for this issue is finished.\n')
    expect(WORKFLOW_FINISHED).toBe('The workflow for this issue is finished.')
  })
})

describe('stepsFileText', () => {
  it('gives each outcome a heading and its summary, without the NUL characters and the line breaks it ends with', () => {
    expect(
      stepsFileText([
        { step: 'Scope', outcome: 'No split', summary: 'Scope found A.\0B.\n' },
        { step: 'Design', outcome: 'Implement directly', summary: '# Plan\r\n\r\n- one\n\n\n' },
      ]),
    ).toBe(
      '## Scope · No split\n\nScope found A.B.\n\n## Design · Implement directly\n\n# Plan\r\n\r\n- one\n',
    )
  })

  it('says of an outcome the user picked in Hoot that it has no summary', () => {
    const text = stepsFileText([
      { step: 'Scope', outcome: 'No split', summary: 'Fits.' },
      { step: 'Design', outcome: 'Implement directly', summary: null },
    ])
    expect(text).toBe(
      `## Scope · No split\n\nFits.\n\n## Design · Implement directly\n\n${PICKED_IN_HOOT}\n`,
    )
    expect(PICKED_IN_HOOT).toMatch(/picked .* in Hoot/)
    expect(PICKED_IN_HOOT).toMatch(/no summary/)
  })
})

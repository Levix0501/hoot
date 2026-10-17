import { checkedWorkflow } from './workflow-check'
import type { WorkflowDefinition } from './workflows'

/**
 * How the agent writes a split back once the user has confirmed it: the
 * issues of the split, created at once as sub-issues of the issue, each
 * starting at the step `start` and blocking the issue, then the issue's
 * label changed to Split.
 */
function splitInstruction(confirmed: string, start: string): string {
  return [
    `${confirmed} Create every issue of the split at once, as sub-issues of this issue, with one \`hoot issue create-batch {issue} --file <file>\`.`,
    `In its JSON array, give each issue \`"labels": ["${start}"]\`, \`"status": "todo"\` and \`"blocking": ["{issue}"]\`, and in \`"blockedBy"\`, as I confirmed the order, the issues it waits on: issues of the split by their place in the array, from 1, and issues there are already by their identifiers, such as \`"ISS-12"\`.`,
    "Write the file next to the issue's file, in a folder that Git ignores, or pass `-` to read standard input.",
    'Do not start sessions for the sub-issues.',
  ].join(' ')
}

/**
 * The workflow Hoot comes with, as data in the format of any other: Scope,
 * which judges whether the issue is one piece of work or several; Design,
 * which settles with the user how it is to be built, then whether one
 * session can implement it; and Implement. Each step and its outcomes are
 * marked by the labels of the group Spec-driven: an issue split by Scope or
 * Design ends at Split, which it is completed with once its sub-issues are,
 * and one implemented at Implemented. It passes the same check as any other
 * definition.
 */
const SPEC_DRIVEN: WorkflowDefinition = {
  name: 'Spec-driven',
  group: 'Spec-driven',
  steps: [
    {
      name: 'Scope',
      label: {
        name: 'Scope',
        color: '4ea7fc',
        description: 'Judging whether the issue is one piece of work or several',
      },
      prompt: [
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
      ].join('\n'),
      outcomes: [
        {
          label: 'Design',
          instruction: 'I confirmed that the issue is one piece of work.',
          goOn: true,
        },
        {
          label: 'Split',
          instruction: splitInstruction('I confirmed the split.', 'Design'),
          goOn: false,
        },
      ],
    },
    {
      name: 'Design',
      label: {
        name: 'Design',
        color: 'bb87fc',
        description: 'Settling how the issue is to be built, and whether one session can',
      },
      prompt: [
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
      ].join('\n'),
      outcomes: [
        {
          label: 'Implement',
          instruction: 'I confirmed the summary, and the issue fits one session.',
          goOn: true,
        },
        {
          label: 'Split',
          instruction: splitInstruction('I confirmed the summary and the split.', 'Implement'),
          goOn: false,
        },
      ],
    },
    {
      name: 'Implement',
      label: {
        name: 'Implement',
        color: 'f2c94c',
        description: 'Implementing the issue as Scope and Design settled it',
      },
      prompt: 'Implement: implement the issue here, as the earlier steps settled it.',
      outcomes: [{ label: 'Implemented', instruction: 'The issue is implemented.', goOn: false }],
    },
  ],
  endLabels: [
    {
      name: 'Split',
      color: '95a2b3',
      description: 'Split into sub-issues; done once they are',
      completeWithSubIssues: true,
    },
    {
      name: 'Implemented',
      color: '4cb782',
      description: 'Implemented in its worktree',
      completeWithSubIssues: false,
    },
  ],
}

/** The built-in workflow, once it has passed the check of workflow definitions. */
export const BUILT_IN_WORKFLOW: WorkflowDefinition = checkedWorkflow(SPEC_DRIVEN)

/** The workflow every issue follows: the built-in one. */
export const ISSUE_WORKFLOW: WorkflowDefinition = BUILT_IN_WORKFLOW

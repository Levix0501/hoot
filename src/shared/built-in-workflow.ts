import { checkedWorkflow } from './workflow-check'
import type { WorkflowDefinition } from './workflows'

/**
 * The workflow Hoot comes with, as data in the format of any other: Scope,
 * which judges whether the issue needs a split; Design, which settles with
 * the user how it is to be built; and Implement. It passes the same check as
 * any other definition. The ids of its steps and the names of its outcomes
 * are in the records of issues' progress, and stay as they are once released.
 */
const SPEC_DRIVEN: WorkflowDefinition = {
  name: 'Spec-driven',
  steps: [
    {
      id: 'scope',
      name: 'Scope',
      prompt: [
        "Scope: judge the issue against this project's code. Read whatever you need, but change nothing: no edits, no commits, no commands that change files.",
        '',
        '1. Workload: can one fresh agent session implement the whole issue, and another fresh session then verify it in full? Answer yes or no, and say why: the parts of the code it touches, and what is still unknown. Do not estimate time.',
        '2. If yes, say that it needs no split, and wait for me to confirm.',
        '3. If no, split it into issues that one session can each implement and another verify. Each delivers a narrow but complete result through every layer it touches, never one layer of the whole. For each:',
        '   - Title',
        '   - Description: what it delivers, and how to accept it',
        '   - Waits on: the issues it cannot be delivered and accepted without, or none',
        '4. End the split with the order, one chain per line, such as `1 → 2 → 4` and `1 → 3`.',
        '',
        "Write titles and descriptions in the issue's language. Where the issue leaves open something that changes your answer, say what you assumed.",
      ].join('\n'),
      outcomes: [
        {
          name: 'no-split',
          label: 'No split',
          instruction:
            'I confirmed that the issue needs no split. The summary says why it fits one session.',
          next: 'design',
        },
        {
          name: 'split',
          label: 'Split',
          instruction: 'the issue needs a split. The summary is the split.',
          next: null,
        },
      ],
    },
    {
      id: 'design',
      name: 'Design',
      prompt: [
        'Design: settle with me how the issue is to be built, before anything changes. Read whatever you need, but change nothing yet.',
        '',
        'Interview me until every decision about the issue is settled. A decision is a choice that whoever implements the issue may not make on their own. Ask me only for decisions, and for facts only I can provide. Find out every other fact yourself, from the code and the environment, even one I stated; when what you find contradicts me, put it to me as a decision.',
        '',
        'Ask in rounds. Each round asks every open decision whose prerequisites are settled, those that unblock the most first. Put the option you recommend first, with its main reason and its cost. Use your tool for asking structured questions if you have one; otherwise ask in your reply, with numbered options. Wait for my answers before the next round.',
        '',
        'When nothing is left open, summarize:',
        '- what the issue delivers, and what it leaves out',
        '- each decision, as I settled it',
        '- the facts you relied on, each with how you established it, and the risks I accepted',
        '',
        'Ask me to confirm the summary.',
      ].join('\n'),
      outcomes: [
        {
          name: 'implement',
          label: 'Implement directly',
          instruction: 'I confirmed the summary. The summary is the confirmed summary.',
          next: 'implement',
        },
      ],
    },
    {
      id: 'implement',
      name: 'Implement',
      prompt: 'Implement: implement the issue here, as the earlier steps settled it.',
      outcomes: [
        {
          name: 'done',
          label: 'Implemented',
          instruction:
            'the issue is implemented. The summary says what changed, how you verified it, and what is left undone.',
          next: null,
        },
      ],
    },
  ],
}

/** The built-in workflow, once it has passed the check of workflow definitions. */
export const BUILT_IN_WORKFLOW: WorkflowDefinition = checkedWorkflow(SPEC_DRIVEN)

/** The workflow every issue follows: the built-in one. */
export const ISSUE_WORKFLOW: WorkflowDefinition = BUILT_IN_WORKFLOW

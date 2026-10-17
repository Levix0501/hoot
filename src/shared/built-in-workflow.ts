import { checkedWorkflow } from './workflow-check'
import type { WorkflowDefinition } from './workflows'

/**
 * How the agent writes a split back once the user has confirmed it: the
 * issues of the split, created at once as sub-issues of the issue, each with
 * the label `label` and blocking the issue, then the issue's label changed to
 * split.
 */
function splitInstruction(confirmed: string, label: string): string {
  return [
    `${confirmed} Create every issue of the split at once, as sub-issues of this issue, with one \`hoot issue create-batch {issue} --file <file>\`.`,
    `In its JSON array, give each issue \`"labels": ["${label}"]\`, \`"status": "todo"\` and \`"blocking": ["{issue}"]\`, and in \`"blockedBy"\`, as I confirmed the order, the issues it waits on: issues of the split by their place in the array, from 1, and issues there are already by their identifiers, such as \`"ISS-12"\`.`,
    "Write the file next to the issue's file, in a folder that Git ignores, or pass `-` to read standard input.",
    'Do not start sessions for the sub-issues.',
  ].join(' ')
}

/**
 * The workflow Hoot comes with, as data in the format of any other. It has
 * one step for now, Triage, which judges whether the issue is one piece of
 * work or several, and stops either way: an issue of one piece ends at
 * ready to design; one of several is split into sub-issues, each at ready to
 * design, and ends at split, which it is completed with once its sub-issues
 * are. The labels of the group Spec-driven mark them. It passes the same
 * check as any other definition.
 */
const SPEC_DRIVEN: WorkflowDefinition = {
  name: 'Spec-driven',
  group: 'Spec-driven',
  steps: [
    {
      name: 'Triage',
      label: {
        name: 'triaging',
        color: '4ea7fc',
        description: 'Judging whether the issue is one piece of work or several',
      },
      prompt: [
        'Judge the issue against this project.',
        '',
        '1. Is the issue one piece of work, or several? Several means it asks for results that could each be delivered and accepted on its own, such as two features, or a feature and an unrelated fix. How much work it is does not count here: that is judged once its design is settled. Answer one or several, and say why.',
        '2. If one, that is the end of this step: do not ask me to confirm it.',
        '3. If several, split it into one issue per result. For each:',
        '   - Title',
        '   - Description: what it delivers, and how to accept it',
        '   - Waits on: the issues it cannot be delivered and accepted without, or none',
        '4. End the split with the order, one chain per line, such as `1 → 2 → 4` and `1 → 3`.',
        '5. Ask me to confirm the split. If I object or ask for changes, revise it and ask me again, until I confirm.',
        '',
        "Write titles and descriptions in the issue's language. Where the issue leaves open something that changes your answer, say what you assumed.",
      ].join('\n'),
      outcomes: [
        {
          label: 'ready to design',
          instruction: 'The issue is one piece of work.',
          goOn: false,
        },
        {
          label: 'split',
          instruction: splitInstruction('I confirmed the split.', 'ready to design'),
          goOn: false,
        },
      ],
    },
  ],
  endLabels: [
    {
      name: 'ready to design',
      color: 'bb87fc',
      description: 'One piece of work, ready for its design',
      completeWithSubIssues: false,
    },
    {
      name: 'split',
      color: '95a2b3',
      description: 'Split into sub-issues; done once they are',
      completeWithSubIssues: true,
    },
  ],
}

/** The built-in workflow, once it has passed the check of workflow definitions. */
export const BUILT_IN_WORKFLOW: WorkflowDefinition = checkedWorkflow(SPEC_DRIVEN)

/** The workflow every issue follows: the built-in one. */
export const ISSUE_WORKFLOW: WorkflowDefinition = BUILT_IN_WORKFLOW

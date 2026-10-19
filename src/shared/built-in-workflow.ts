import { checkedWorkflow } from './workflow-check'
import type { WorkflowDefinition } from './workflows'

/**
 * How the agent writes a split back once the user has confirmed it: the
 * issues of the split, created at once as sub-issues of the issue, each with
 * the label `label` and blocking the issue; the outcome then changes the
 * issue's label to waiting on sub-issues.
 */
function splitInstruction(confirmed: string, label: string): string {
  return [
    confirmed,
    'Write the issues of the split, in order, to a JSON file next to the issue file:',
    `\`[{"title": "…", "description": "…", "labels": ["${label}"], "status": "todo", "blocking": ["{issue}"], "blockedBy": […]}, …]\``,
    'In `"blockedBy"`, list the issues it waits on: those of the split by their place in the array, from 1, others by their identifiers.',
    'Run `hoot issue create-batch {issue} --file <file>`.',
  ].join('\n')
}

/**
 * The workflow Hoot comes with, as data in the format of any other. It has
 * two steps for now. Triage judges whether the issue is one piece of work or
 * several, and stops either way: an issue of one piece is then ready to
 * design; one of several is split into sub-issues, each ready to design, and
 * ends at waiting on sub-issues, which it is completed with once its
 * sub-issues are. Design, started from ready to design, interviews the user
 * until every decision about the issue is settled, sums up what was settled
 * and stops, leaving the issue at designing. The labels of the group
 * Spec-driven mark them. It passes the same check as any other definition.
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
      ].join('\n'),
      outcomes: [
        {
          label: 'ready to design',
          instruction: 'The issue is one piece of work.',
          goOn: false,
        },
        {
          label: 'waiting on sub-issues',
          instruction: splitInstruction('I confirmed the split.', 'ready to design'),
          goOn: false,
        },
      ],
    },
    {
      name: 'Design',
      readyLabel: {
        name: 'ready to design',
        color: 'bb87fc',
        description: 'One piece of work, ready for its design',
      },
      label: {
        name: 'designing',
        color: '5e6ad2',
        description: 'Settling every decision about the issue',
      },
      prompt: [
        '## Interview',
        '',
        "Interview the user until every decision is settled. Model the work as a design tree: a decision's prerequisites are the upstream decisions and environment facts its options depend on, and its answer opens the decisions below it.",
        '',
        'The frontier is every unsettled decision whose prerequisites are all settled. Two frontier decisions never depend on each other, so a dependency chain settles one link per round.',
        '',
        'Ask the user only for decisions and for facts only they can provide. A choice the implementer may not replace is a decision, whoever proposed it. Every other fact is a prerequisite you settle yourself from the environment, even one the user stated: what they say about the environment may never have been measured, and a false premise found now costs a question, found in implementation costs the build. A check that contradicts the user is a decision to put to them. While a lookup is running, its dependents stay out of the frontier.',
        '',
        "Each round is one call of the harness's structured question tool, covering as much of the frontier as its per-call limit allows, starting with the questions that unblock the most. Without such a tool, ask in the reply with numbered options. In each question, put the recommended option first with its main reason and cost. Wait for the answers, update the tree, recompute the frontier, and ask the next round.",
        '',
        'The interview ends when the frontier is empty: every decision is settled and nothing is left silently assumed. Do not act on the result until the user confirms the summary.',
        '',
        '## Summary',
        '',
        'When the frontier is empty, present a concise summary of what was settled:',
        '',
        '- the outcome and its boundaries',
        '- the requirements and decisions the work must honor, each as the user settled it',
        '- the facts relied on, each with how it was established, and the risks accepted',
      ].join('\n'),
      outcomes: [],
    },
  ],
  endLabels: [
    {
      name: 'waiting on sub-issues',
      color: '95a2b3',
      description: 'Waiting on its sub-issues; done once they are',
      completeWithSubIssues: true,
    },
  ],
}

/** The built-in workflow, once it has passed the check of workflow definitions. */
export const BUILT_IN_WORKFLOW: WorkflowDefinition = checkedWorkflow(SPEC_DRIVEN)

/** The workflow every issue follows: the built-in one. */
export const ISSUE_WORKFLOW: WorkflowDefinition = BUILT_IN_WORKFLOW

/**
 * What Hoot tells the agent working on an issue's workflow, the same for
 * every workflow: the file of the whole workflow, `workflow.md`, and the
 * first message of a session started from an issue. Only the names,
 * labels, prompts and outcomes come from the workflow.
 */
import type {
  WorkflowDefinition,
  WorkflowEndLabel,
  WorkflowOutcome,
  WorkflowStep,
} from './workflows'
import { stepOfLabel } from './workflows'

/** What stands for the issue's identifier in a workflow's prompts and instructions. */
export const ISSUE_PLACEHOLDER = '{issue}'

/** Text of a workflow with the issue's identifier in place of `{issue}`. */
export function filledIn(text: string, identifier: string): string {
  return text.replaceAll(ISSUE_PLACEHOLDER, identifier)
}

/** The command that changes an issue's label of the workflow's group to another. */
export function labelCommand(identifier: string, label: string): string {
  return `hoot issue edit ${identifier} --add-label ${label}`
}

/** What the agent does once it has changed the label: goes on with the step of that label, or stops. */
function afterwards(
  workflow: WorkflowDefinition,
  outcome: WorkflowOutcome,
  where: 'workflow.md' | 'here',
): string {
  const next = stepOfLabel(workflow, outcome.label)
  if (!outcome.goOn || next === undefined) return 'stop.'
  const given = where === 'workflow.md' ? ', as workflow.md gives it' : ''
  return `go on with the step of that label, ${next.name}${given}.`
}

/**
 * How a step asks to be ended: with one of its outcomes, each its
 * instruction, then the command that changes the issue's label, and whether
 * the agent goes on or stops afterwards.
 */
export function outcomeInstructions(
  workflow: WorkflowDefinition,
  step: Pick<WorkflowStep, 'outcomes'>,
  identifier: string,
): string {
  return [
    `When this step is done, end it with the one of these outcomes that applies, by changing the issue's label of the group ${workflow.group} with Hoot's \`hoot\` command:`,
    '',
    ...step.outcomes.map(
      (outcome) =>
        `- ${filledIn(outcome.instruction, identifier)}\n` +
        `  Then change the label to ${outcome.label} with \`${labelCommand(identifier, outcome.label)}\`, and ${afterwards(workflow, outcome, 'workflow.md')}`,
    ),
  ].join('\n')
}

export interface FirstMessage {
  workflow: WorkflowDefinition
  /** The issue's identifier, such as `ISS-12`. */
  identifier: string
  /** The absolute path of the session's issue file. */
  issueFile: string
  /** The absolute path of the session's file of the workflow. */
  workflowFile: string
  /** The branch of the worktree the session runs in. */
  branch: string
  /** The step the session starts at. */
  step: WorkflowStep
}

/**
 * The first message of a session started from an issue: an opening that
 * points to the issue's file and the file of its workflow, names the
 * worktree's branch and the step the session starts at; then the step's
 * prompt and how to end it. Its parts are a blank line apart, its lines end
 * with LF, and nothing follows the last one. The issue itself stays out of
 * it, where an agent could take some of its text for a command or a mention.
 */
export function firstMessage({
  workflow,
  identifier,
  issueFile,
  workflowFile,
  branch,
  step,
}: FirstMessage): string {
  return [
    `The issue to work on is ${identifier}, in \`${issueFile}\`. Read it first: its title is the heading; ` +
      `the rest, if any, is its description. Then read \`${workflowFile}\`: the workflow ${workflow.name}, ` +
      'which work on the issue goes through, step by step.',
    `This is a Git worktree of the project, on the branch \`${branch}\`, made for this issue. ` +
      `This session starts at the step ${step.name}, which the issue's label ${step.label.name} marks.`,
    filledIn(step.prompt, identifier),
    outcomeInstructions(workflow, step, identifier),
  ].join('\n\n')
}

/** What an end label of a workflow does, as `workflow.md` says it. */
function endLabelText(end: WorkflowEndLabel): string {
  if (!end.completeWithSubIssues) return `- ${end.name}`
  return (
    `- ${end.name}: once the issue has at least one sub-issue that Hoot shows, and each of ` +
    'them is done or canceled, Hoot completes the issue: Done when at least one of them is done, ' +
    'Canceled otherwise.'
  )
}

/**
 * The file of an issue's workflow, `workflow.md`: the workflow's name, how
 * the labels of its group mark the issue's progress, each step in order,
 * with its label, its prompt and its outcomes (the label each changes to,
 * its instruction, and whether the agent goes on or stops), and the end
 * labels, with what they do. It ends with a line break.
 */
export function workflowFileText(workflow: WorkflowDefinition, identifier: string): string {
  const steps = workflow.steps.map((step, index) =>
    [
      `## ${index + 1}. ${step.name}`,
      `Label: ${step.label.name}`,
      filledIn(step.prompt, identifier),
      [
        'Outcomes:',
        '',
        ...step.outcomes.map((outcome) =>
          [
            `- ${filledIn(outcome.instruction, identifier)}`,
            `  - Changes the label to: ${outcome.label} (\`${labelCommand(identifier, outcome.label)}\`)`,
            `  - Go on: ${outcome.goOn ? 'on' : 'off'}; once the label is changed, ${afterwards(workflow, outcome, 'here')}`,
          ].join('\n'),
        ),
      ].join('\n'),
    ].join('\n\n'),
  )
  const ends =
    workflow.endLabels.length === 0
      ? 'The workflow has no end labels.'
      : workflow.endLabels.map(endLabelText).join('\n')
  return `${[
    `# ${workflow.name}`,
    `The workflow ${identifier} goes through. How far the issue has come is the label of the group ` +
      `${workflow.group} it carries: none before it starts, the label of the step it is at, or an ` +
      'end label once it is finished. An issue carries one label of the group at most: adding one ' +
      `with \`${labelCommand(identifier, '<label>')}\` takes the other off.`,
    ...steps,
    '## End labels',
    ends,
  ].join('\n\n')}\n`
}

/**
 * What Hoot tells the agent working on an issue's workflow, the same for
 * every workflow: the file of the whole workflow, `workflow.md`, and the
 * first message of a session started from an issue. Only the names,
 * labels, prompts and outcomes come from the workflow.
 */
import { quote } from 'shell-quote'
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
  return `hoot issue edit ${identifier} --add-label ${quote([label])}`
}

/** A label's name in the text, set apart from the words around it, as `ready to design`. */
function labelName(name: string): string {
  return `\`${name}\``
}

/**
 * Whether work on an issue may go on from a step to another in the same
 * session: whether any of its outcomes goes on. A session that starts at a
 * step that does not needs neither another step nor the file of the
 * workflow.
 */
export function goesOn(step: Pick<WorkflowStep, 'outcomes'>): boolean {
  return step.outcomes.some((outcome) => outcome.goOn)
}

/** What the agent does once it has changed the label: goes on with the step of that label, or stops. */
function afterwards(
  workflow: WorkflowDefinition,
  outcome: WorkflowOutcome,
  where: 'workflow.md' | 'here',
): string {
  const next = stepOfLabel(workflow, outcome.label)
  if (!outcome.goOn || next === undefined) return 'stop'
  const given = where === 'workflow.md' ? ' in workflow.md' : ''
  return `go on with the step ${next.name}${given}`
}

/**
 * An outcome as the agent is told it, as an item of a list: its instruction,
 * the lines after the first indented to stay in the item, then the command
 * that changes the issue's label, and whether to go on or stop afterwards.
 */
function outcomeText(
  workflow: WorkflowDefinition,
  outcome: WorkflowOutcome,
  identifier: string,
  where: 'workflow.md' | 'here',
): string {
  const instruction = filledIn(outcome.instruction, identifier)
    .split('\n')
    .map((line, index) => (index === 0 || line === '' ? line : `  ${line}`))
    .join('\n')
  return (
    `- ${instruction}\n` +
    `  Run \`${labelCommand(identifier, outcome.label)}\`, then ${afterwards(workflow, outcome, where)}.`
  )
}

/** How a step without outcomes ends, leaving the issue's label as it is. */
const STOP = 'When this step is done, stop.'

/**
 * How a step asks to be ended: with one of its outcomes, each its
 * instruction, then the command that changes the issue's label, and whether
 * the agent goes on or stops afterwards; by stopping, for a step without
 * outcomes.
 */
export function outcomeInstructions(
  workflow: WorkflowDefinition,
  step: Pick<WorkflowStep, 'outcomes'>,
  identifier: string,
): string {
  if (step.outcomes.length === 0) return STOP
  return [
    'When this step is done, end it with the one of these outcomes that applies:',
    '',
    ...step.outcomes.map((outcome) => outcomeText(workflow, outcome, identifier, 'workflow.md')),
  ].join('\n')
}

export interface FirstMessage {
  workflow: WorkflowDefinition
  /** The issue's identifier, such as `ISS-12`. */
  identifier: string
  /** The absolute path of the session's issue file. */
  issueFile: string
  /** The absolute path of the session's file of the workflow, which it has when its step `goesOn`. */
  workflowFile: string
  /** The branch of the worktree the session runs in. */
  branch: string
  /** The step the session starts at. */
  step: WorkflowStep
}

/**
 * The first message of a session started from an issue: where the issue's
 * file is, and the file of its workflow when the session may go on from its
 * step to another; the branch of the worktree; then the step's prompt and how
 * to end it. Its parts are a blank line apart, its lines end with LF, and
 * nothing follows the last one. The issue itself stays out of it, where an
 * agent could take some of its text for a command or a mention.
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
    goesOn(step)
      ? `The issue is in \`${issueFile}\`, and the workflow it goes through in \`${workflowFile}\`.`
      : `The issue is in \`${issueFile}\`.`,
    `This is a Git worktree of the project, on the branch \`${branch}\`, made for this issue.`,
    filledIn(step.prompt, identifier),
    outcomeInstructions(workflow, step, identifier),
  ].join('\n\n')
}

/** What an end label of a workflow does, as `workflow.md` says it. */
function endLabelText(end: WorkflowEndLabel): string {
  if (!end.completeWithSubIssues) return `- ${labelName(end.name)}`
  return (
    `- ${labelName(end.name)}: once the issue has at least one sub-issue that Hoot shows, and each of ` +
    'them is done or canceled, Hoot completes the issue: Done when at least one of them is done, ' +
    'Canceled otherwise.'
  )
}

/** A step's labels, as `workflow.md` says them: its label, and its ready label if it has one. */
function stepLabelsText(step: WorkflowStep): string {
  const label = `Label: ${labelName(step.label.name)}`
  if (step.readyLabel === undefined) return label
  return `${label}, or ${labelName(step.readyLabel.name)} while the issue waits for a session of it`
}

/**
 * The file of an issue's workflow, `workflow.md`: the workflow's name, how
 * the labels of its group mark the issue's progress, each step in order,
 * with its labels, its prompt and its outcomes (the label each changes to,
 * its instruction, and whether the agent goes on or stops), or that it
 * stops, and the end labels, with what they do. It ends with a line break.
 */
export function workflowFileText(workflow: WorkflowDefinition, identifier: string): string {
  const steps = workflow.steps.map((step, index) =>
    [
      `## ${index + 1}. ${step.name}`,
      stepLabelsText(step),
      filledIn(step.prompt, identifier),
      step.outcomes.length === 0
        ? STOP
        : [
            'Outcomes:',
            '',
            ...step.outcomes.map((outcome) => outcomeText(workflow, outcome, identifier, 'here')),
          ].join('\n'),
    ].join('\n\n'),
  )
  const ends =
    workflow.endLabels.length === 0
      ? 'The workflow has no end labels.'
      : workflow.endLabels.map(endLabelText).join('\n')
  const ready = workflow.steps.some((step) => step.readyLabel !== undefined)
    ? "a step's ready label while it waits for a session of that step, "
    : ''
  return `${[
    `# ${workflow.name}`,
    `The workflow ${identifier} goes through. How far the issue has come is the label of the group ` +
      `${workflow.group} it carries: none before it starts, ${ready}the label of the step it is at, ` +
      'or an end label once it is finished. An issue carries one label of the group at most: adding ' +
      `one with \`hoot issue edit ${identifier} --add-label <label>\` takes the other off.`,
    ...steps,
    '## End labels',
    ends,
  ].join('\n\n')}\n`
}

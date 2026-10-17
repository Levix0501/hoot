/**
 * Workflows: the steps work on an issue goes through. A workflow is a
 * definition, plain data that could be written as JSON and read back, which
 * Hoot runs whatever it says: the built-in one and any other alike, once it
 * has passed the check in `workflow-check`. A workflow has a group of labels:
 * one for each step, and end labels. An issue's progress through the
 * workflow is the label of that group it carries, and nothing else: none
 * before it starts, a step's label while it is at that step, or an end label
 * once it is finished. Changing the label moves the issue on.
 */

/** A label of a workflow's group, as the workflow gives it. */
export interface WorkflowLabel {
  /** No other label of the workflow, nor any other label at all, has the same name. */
  name: string
  /** Six hexadecimal digits in lower case, without `#`. */
  color: string
  /** May be empty. */
  description: string
}

/**
 * One of the results a step can end with: the label of the workflow's group
 * the agent changes the issue's to, what it means and what to do before, and
 * whether the agent then goes on with the step of that label in the same
 * session or stops. `{issue}` in the instruction stands for the issue's
 * identifier, such as `ISS-12`.
 */
export interface WorkflowOutcome {
  /** The name of a step's label or of an end label of the workflow. */
  label: string
  instruction: string
  /** On: goes on with the step of the label, in the same session; off: stops once it is changed. */
  goOn: boolean
}

/** A step of a workflow, which an agent session works on with the step's prompt. */
export interface WorkflowStep {
  /** How the agent and the user call it, such as "Review". */
  name: string
  /** The label that an issue at this step carries. */
  label: WorkflowLabel
  /** What the agent is asked to do in the step; `{issue}` stands for the issue's identifier. */
  prompt: string
  /** The results the step can end with, in the order they are offered. */
  outcomes: WorkflowOutcome[]
}

/** A label of a workflow's group that is no step's: an issue carrying one is finished. */
export interface WorkflowEndLabel extends WorkflowLabel {
  /**
   * That an issue carrying it is completed once its sub-issues are: when
   * every sub-issue Hoot shows is done or canceled, and it has at least one.
   */
  completeWithSubIssues: boolean
}

export interface WorkflowDefinition {
  name: string
  /** The name of the workflow's group of labels. */
  group: string
  /** In order: work on an issue starts at the first. */
  steps: WorkflowStep[]
  endLabels: WorkflowEndLabel[]
}

/** The step work on an issue starts at. */
export function firstStep(workflow: WorkflowDefinition): WorkflowStep {
  return workflow.steps[0]!
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** The step whose label has this name, if any. */
export function stepOfLabel(workflow: WorkflowDefinition, label: string): WorkflowStep | undefined {
  return workflow.steps.find((step) => sameName(step.label.name, label))
}

/** The end label with this name, if any. */
export function endLabelNamed(
  workflow: WorkflowDefinition,
  label: string,
): WorkflowEndLabel | undefined {
  return workflow.endLabels.find((end) => sameName(end.name, label))
}

/** Every label of the workflow's group: the steps', in order, then the end labels. */
export function workflowLabels(workflow: WorkflowDefinition): WorkflowLabel[] {
  return [...workflow.steps.map((step) => step.label), ...workflow.endLabels]
}

/** Where an issue is in its workflow. */
export type WorkflowProgress =
  | { kind: 'not-started' }
  | { kind: 'at-step'; step: WorkflowStep }
  | { kind: 'finished'; label: WorkflowEndLabel }

/**
 * Where an issue is in its workflow, from the names of the labels of the
 * workflow's group it carries, of which it carries at most one: not started
 * without any, at the step of a step's label, or finished with an end label.
 */
export function workflowProgress(
  workflow: WorkflowDefinition,
  carried: readonly string[],
): WorkflowProgress {
  for (const name of carried) {
    const step = stepOfLabel(workflow, name)
    if (step) return { kind: 'at-step', step }
    const end = endLabelNamed(workflow, name)
    if (end) return { kind: 'finished', label: end }
  }
  return { kind: 'not-started' }
}

/**
 * Workflows: the steps work on an issue goes through. A workflow is a
 * definition, plain data that could be written as JSON and read back, which
 * Hoot runs whatever it says: the built-in one and any other alike, once it
 * has passed the check in `workflow-check`. An issue's progress through its
 * workflow is a list of records, read in the order they were made.
 */
/** One of the results a step can end with, and where it leads. */
export interface WorkflowOutcome {
  /** How the agent names it when it reports it, such as `no-split`. */
  name: string
  /** How the interface writes it, such as "No split". */
  label: string
  /** What it means, told the agent in the list of the step's outcomes. */
  instruction: string
  /** The id of the step it leads to, or `null` when it finishes the workflow. */
  next: string | null
}

/** A step of a workflow, which an agent session works on with the step's prompt. */
export interface WorkflowStep {
  /** What Hoot records an issue's progress by, such as `scope`; kept once released. */
  id: string
  /** How the interface and the agent call it, such as "Scope". */
  name: string
  /** What the agent is asked to do in the step. */
  prompt: string
  /** The results the step can end with, in the order they are offered. */
  outcomes: WorkflowOutcome[]
}

export interface WorkflowDefinition {
  name: string
  /** In order: work on an issue starts at the first. */
  steps: WorkflowStep[]
}

/** How long a summary reported with an outcome may be, in UTF-16 code units. */
export const STEP_SUMMARY_MAX_LENGTH = 1_000_000

/** The step with this id, if the workflow has it. */
export function workflowStep(workflow: WorkflowDefinition, id: string): WorkflowStep | undefined {
  return workflow.steps.find((step) => step.id === id)
}

/** The step work on an issue starts at. */
export function firstStep(workflow: WorkflowDefinition): WorkflowStep {
  return workflow.steps[0]!
}

/** The outcome of a step with this name, if it has one. */
export function stepOutcome(step: WorkflowStep, name: string): WorkflowOutcome | undefined {
  return step.outcomes.find((outcome) => outcome.name === name)
}

/** Who reported a step's outcome: the agent, with `hoot step report`, or the user, in Hoot. */
export type StepReporter = 'agent' | 'user'

/** A step started, once more: a run of the step, until it is reported. */
export interface StepStartedRecord {
  kind: 'step-started'
  /** Also the run's id. */
  id: number
  /** The step's id. */
  step: string
  /** In milliseconds since the Unix epoch. */
  at: number
}

/** The outcome a run of a step ended with. */
export interface StepReportedRecord {
  kind: 'step-reported'
  id: number
  step: string
  /** The outcome's name. */
  outcome: string
  /** The agent's summary, in Markdown; `null` for an outcome the user reported. */
  summary: string | null
  reporter: StepReporter
  at: number
}

/** The user started the workflow over: the issue is not started again. */
export interface StartedOverRecord {
  kind: 'started-over'
  id: number
  at: number
}

/** What happened to an issue in its workflow; an issue's records are in the order they were made. */
export type WorkflowRecord = StepStartedRecord | StepReportedRecord | StartedOverRecord

/** Where an issue is in its workflow. */
export type WorkflowProgress =
  | { kind: 'not-started' }
  /** At a step, whose current run started with the record `run`, at `startedAt`. */
  | { kind: 'at-step'; step: string; run: number; startedAt: number }
  | { kind: 'finished' }

/**
 * Where an issue is, from its records: not started without any, or after it
 * started over; at the step of the run that started last; and finished once
 * an outcome was reported with no step after it. An outcome that leads to a
 * step is recorded together with the run of that step that it starts.
 */
export function workflowProgress(records: readonly WorkflowRecord[]): WorkflowProgress {
  const last = records.at(-1)
  switch (last?.kind) {
    case undefined:
    case 'started-over':
      return { kind: 'not-started' }
    case 'step-started':
      return { kind: 'at-step', step: last.step, run: last.id, startedAt: last.at }
    case 'step-reported':
      return { kind: 'finished' }
  }
}

/** The outcomes reported since the issue last started over, or ever when it never did, in order. */
export function reportsThisRound(records: readonly WorkflowRecord[]): StepReportedRecord[] {
  const startedOver = records.findLastIndex((record) => record.kind === 'started-over')
  return records
    .slice(startedOver + 1)
    .filter((record): record is StepReportedRecord => record.kind === 'step-reported')
}

/** A step's name, or its id when the workflow no longer has it. */
export function stepName(workflow: WorkflowDefinition, id: string): string {
  return workflowStep(workflow, id)?.name ?? id
}

/** An outcome's label, or its name when the step, or the workflow, no longer has it. */
export function outcomeLabel(workflow: WorkflowDefinition, stepId: string, name: string): string {
  const step = workflowStep(workflow, stepId)
  return (step && stepOutcome(step, name)?.label) ?? name
}

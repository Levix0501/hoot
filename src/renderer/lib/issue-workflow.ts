import type { Issue, IssueStatus } from '../../shared/issues'
import {
  outcomeLabel,
  stepName,
  workflowProgress,
  type StepReporter,
  type WorkflowDefinition,
  type WorkflowProgress,
  type WorkflowRecord,
} from '../../shared/workflows'

/**
 * Where an issue is in its workflow, as the interface writes it: Not
 * started, the name of the step it is at, or Finished.
 */
export function progressLabel(progress: WorkflowProgress, workflow: WorkflowDefinition): string {
  switch (progress.kind) {
    case 'not-started':
      return 'Not started'
    case 'at-step':
      return stepName(workflow, progress.step)
    case 'finished':
      return 'Finished'
  }
}

/** Something that happened to an issue, as its activity lists it. */
export type ActivityEntry =
  | { kind: 'created'; at: number }
  /** It became done or canceled. */
  | { kind: 'completed'; at: number; status: IssueStatus }
  /** An outcome of a step was reported, with the agent's summary, or by the user without one. */
  | {
      kind: 'reported'
      id: number
      at: number
      step: string
      outcome: string
      reporter: StepReporter
      summary: string | null
    }
  | { kind: 'started-over'; id: number; at: number }
  /** The current run of the step the issue is at, since it started. */
  | { kind: 'in-progress'; id: number; at: number; step: string }

/**
 * What an issue's activity lists, in the order it happened: when it was
 * created; each outcome reported and each start over; the run of the step it
 * is at, since it started; and when it was done or canceled, if it is. The
 * steps and outcomes go by their names and labels in the workflow.
 */
export function activityEntries(
  issue: Pick<Issue, 'createdAt' | 'completedAt' | 'status'>,
  records: readonly WorkflowRecord[],
  workflow: WorkflowDefinition,
): ActivityEntry[] {
  const progress = workflowProgress(records)
  const entries: ActivityEntry[] = [{ kind: 'created', at: issue.createdAt }]
  for (const record of records) {
    switch (record.kind) {
      case 'step-reported':
        entries.push({
          kind: 'reported',
          id: record.id,
          at: record.at,
          step: stepName(workflow, record.step),
          outcome: outcomeLabel(workflow, record.step, record.outcome),
          reporter: record.reporter,
          summary: record.summary,
        })
        break
      case 'started-over':
        entries.push({ kind: 'started-over', id: record.id, at: record.at })
        break
      case 'step-started':
        if (progress.kind === 'at-step' && progress.run === record.id) {
          entries.push({
            kind: 'in-progress',
            id: record.id,
            at: record.at,
            step: stepName(workflow, record.step),
          })
        }
        break
    }
  }
  if (issue.completedAt !== null) {
    entries.push({ kind: 'completed', at: issue.completedAt, status: issue.status })
  }
  // Stable: what happened at the same time stays in the order it was recorded.
  return entries.toSorted((a, b) => a.at - b.at)
}

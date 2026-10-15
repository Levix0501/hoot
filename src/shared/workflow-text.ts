/**
 * What Hoot tells the agent working on an issue's workflow, the same for
 * every workflow: the opening of a session's first message, how to report a
 * step, what `hoot step report` prints, and the file of what earlier steps
 * found. Only the steps' names, prompts and outcomes come from the workflow.
 */
import type { StepReport } from './hoot-cli'
import type { WorkflowStep } from './workflows'

/** Says that an issue's workflow has no step left. */
export const WORKFLOW_FINISHED = 'The workflow for this issue is finished.'

/**
 * How a step asks to be reported when it is done: with `hoot step report`,
 * one of the step's outcomes, each with what it means, and a summary.
 */
export function reportInstructions(step: Pick<WorkflowStep, 'outcomes'>): string {
  return [
    "When this step is done, report it with Hoot's `hoot` command:",
    '',
    '  hoot step report <outcome> --summary-file <file>',
    '',
    '<outcome> is one of:',
    ...step.outcomes.map((outcome) => `- ${outcome.name}: ${outcome.instruction}`),
    '',
    "The summary is Markdown, for me and for the steps after this one, which may start in a new session that has only the issue and the summaries. Write the file next to the issue's file, in a folder that Git ignores, or pass `-` to read standard input. hoot then says what to do next.",
  ].join('\n')
}

/** A step as the agent gets it: its prompt, and how to report it, after a blank line. */
export function stepInstructions(step: Pick<WorkflowStep, 'prompt' | 'outcomes'>): string {
  return `${step.prompt}\n\n${reportInstructions(step)}`
}

export interface FirstMessage {
  /** The absolute path of the session's issue file. */
  issueFile: string
  /** The absolute path of the file of what earlier steps found, or `null` when there is none. */
  stepsFile: string | null
  /** The branch of the worktree the session runs in. */
  branch: string
  /** The step the session starts at. */
  step: WorkflowStep
}

/**
 * The first message of a session started from an issue's start button: an
 * opening that points to the issue's file, and to the file of what earlier
 * steps found when there is one, names the worktree's branch and the step
 * the session starts at; then the step's prompt and how to report it. Its
 * parts are a blank line apart, its lines end with LF, and nothing follows
 * the last one. The issue itself stays out of it, where an agent could take
 * some of its text for a command or a mention.
 */
export function firstMessage({ issueFile, stepsFile, branch, step }: FirstMessage): string {
  const issue =
    `The issue to work on is in \`${issueFile}\`. Read it first: its title is the heading; ` +
    'the rest, if any, is its description.'
  const steps =
    stepsFile === null ? '' : ` What earlier steps found is in \`${stepsFile}\`; read it too.`
  return [
    `${issue}${steps}`,
    `This is a Git worktree of the project, on the branch \`${branch}\`, made for this issue. ` +
      `Work on the issue goes in steps; this session starts at the step ${step.name}.`,
    stepInstructions(step),
  ].join('\n\n')
}

/**
 * What `hoot step report` prints once Hoot has recorded the outcome: the
 * issue, the step and the outcome, then either the next step's name, prompt
 * and how to report it, or that the workflow is finished.
 */
export function stepReportText(report: StepReport): string {
  const reported = `${report.issue}: ${report.step} → ${report.outcome}.`
  if (report.next === null) return `${reported} ${WORKFLOW_FINISHED}\n`
  return `${reported} Next step: ${report.next.name}.\n\n${stepInstructions(report.next)}\n`
}

/** An outcome reported, as the file of what earlier steps found lists it. */
export interface StepsFileEntry {
  /** The step's name. */
  step: string
  /** The outcome's label. */
  outcome: string
  /** The agent's summary; `null` for an outcome the user picked in Hoot. */
  summary: string | null
}

/** What the file of what earlier steps found says of an outcome the user picked in Hoot. */
export const PICKED_IN_HOOT = 'I picked this outcome in Hoot; there is no summary.'

/**
 * The file of what earlier steps found, `steps.md`: for each outcome
 * reported, in order, a heading with the step and the outcome, such as
 * `## Scope · No split`, and the summary below it, without its NUL
 * characters and the line breaks it ends with; or, for an outcome the user
 * picked in Hoot, a sentence that says so. The parts are a blank line apart,
 * and the file ends with a line break.
 */
export function stepsFileText(entries: readonly StepsFileEntry[]): string {
  const sections = entries.map(({ step, outcome, summary }) => {
    const body =
      summary === null ? PICKED_IN_HOOT : summary.replaceAll('\0', '').replace(/[\r\n]+$/, '')
    return `## ${step} · ${outcome}\n\n${body}`
  })
  return `${sections.join('\n\n')}\n`
}

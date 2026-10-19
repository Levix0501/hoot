/**
 * The check of workflow definitions, which every definition Hoot runs passes
 * first, the built-in one included.
 */
import { z } from 'zod'
import { LABEL_DESCRIPTION_MAX_LENGTH, LABEL_NAME_MAX_LENGTH } from './labels'
import type { WorkflowDefinition } from './workflows'

/** Text that goes between others in messages: not empty, without whitespace around it, CR or NUL. */
function text(where: string) {
  return z
    .string()
    .min(1, `${where} is empty.`)
    .refine((value) => value === value.trim(), `${where} has whitespace around it.`)
    .refine((value) => !/[\r\0]/.test(value), `${where} has a carriage return or a NUL character.`)
}

/** Text that is written on one line, such as a name in a heading or an item of a list. */
function line(where: string) {
  return text(where).refine((value) => !value.includes('\n'), `${where} is not on one line.`)
}

/** A label's name: on one line, as long as Hoot saves, and without a comma, which separates names. */
function labelName(where: string) {
  return line(where)
    .max(LABEL_NAME_MAX_LENGTH, `${where} is longer than ${LABEL_NAME_MAX_LENGTH} characters.`)
    .refine((value) => !value.includes(','), `${where} has a comma, which separates names.`)
}

const labelFields = {
  name: labelName('A label name'),
  color: z
    .string()
    .regex(/^[0-9a-f]{6}$/, 'A label color is not six hexadecimal digits in lower case.'),
  description: z
    .string()
    .max(LABEL_DESCRIPTION_MAX_LENGTH)
    .refine((value) => value === value.trim(), 'A label description has whitespace around it.')
    .refine((value) => !/[\r\n\0]/.test(value), 'A label description is not on one line.'),
}

/** The key two names compare by: without regard to case. */
const key = (name: string) => name.toLowerCase()

const outcomeSchema = z.strictObject({
  label: z.string(),
  instruction: text("An outcome's instruction"),
  goOn: z.boolean(),
})

const stepSchema = z.strictObject({
  name: line('A step name'),
  label: z.strictObject(labelFields),
  readyLabel: z.strictObject(labelFields).optional(),
  prompt: text("A step's prompt"),
  outcomes: z.array(outcomeSchema),
})

const endLabelSchema = z.strictObject({ ...labelFields, completeWithSubIssues: z.boolean() })

const workflowSchema = z
  .strictObject({
    name: line("The workflow's name"),
    group: labelName("The name of the workflow's group"),
    steps: z.array(stepSchema).min(1, 'The workflow has no step.'),
    endLabels: z.array(endLabelSchema),
  })
  .superRefine((workflow, context) => {
    const problem = (message: string, path: Array<string | number>) =>
      context.addIssue({ code: 'custom', message, path })
    const steps = new Set<string>()
    workflow.steps.forEach((step, index) => {
      if (steps.has(key(step.name))) {
        problem(`Two steps have the name "${step.name}".`, ['steps', index, 'name'])
      }
      steps.add(key(step.name))
    })
    const labels = new Set<string>()
    const label = (name: string, path: Array<string | number>) => {
      if (labels.has(key(name))) problem(`Two labels have the name "${name}".`, path)
      labels.add(key(name))
    }
    workflow.steps.forEach((step, index) => {
      if (step.readyLabel) label(step.readyLabel.name, ['steps', index, 'readyLabel'])
      label(step.label.name, ['steps', index, 'label'])
    })
    workflow.endLabels.forEach((end, index) => label(end.name, ['endLabels', index, 'name']))
    const ends = new Set(workflow.endLabels.map((end) => key(end.name)))
    const ready = new Set(workflow.steps.flatMap((step) => step.readyLabel?.name ?? []).map(key))
    workflow.steps.forEach((step, index) => {
      step.outcomes.forEach((outcome, position) => {
        const path = ['steps', index, 'outcomes', position]
        if (!labels.has(key(outcome.label))) {
          problem(`The outcome changes to "${outcome.label}", which is no label of the workflow.`, [
            ...path,
            'label',
          ])
        } else if (ends.has(key(outcome.label)) && outcome.goOn) {
          problem(
            `The outcome changes to the end label "${outcome.label}", after which there is no step to go on with.`,
            [...path, 'goOn'],
          )
        } else if (ready.has(key(outcome.label)) && outcome.goOn) {
          problem(
            `The outcome changes to the ready label "${outcome.label}", which waits for a session of its step: it cannot go on.`,
            [...path, 'goOn'],
          )
        }
      })
    })
  })

export type WorkflowCheck =
  | { ok: true; workflow: WorkflowDefinition }
  | { ok: false; problems: string[] }

/**
 * Checks that something is a workflow definition Hoot can run: a name, the
 * name of its group of labels, at least one step and any end labels. Each
 * step has a name, a label, maybe a ready label, a prompt and any outcomes;
 * each outcome the label it changes the issue's to, one of the workflow's,
 * an instruction, and whether the agent goes on afterwards, which it can
 * only after a step's label. Labels have a name, a color and a description.
 * Step names and label names are each different, without regard to case,
 * and nothing else is in it.
 */
export function checkWorkflow(value: unknown): WorkflowCheck {
  const parsed = workflowSchema.safeParse(value)
  if (parsed.success) return { ok: true, workflow: parsed.data }
  return {
    ok: false,
    problems: parsed.error.issues.map((issue) =>
      issue.path.length === 0 ? issue.message : `${issue.path.join('.')}: ${issue.message}`,
    ),
  }
}

/** A workflow definition once it has passed the check; throws with the problems otherwise. */
export function checkedWorkflow(value: unknown): WorkflowDefinition {
  const checked = checkWorkflow(value)
  if (!checked.ok) throw new Error(`Invalid workflow: ${checked.problems.join(' ')}`)
  return checked.workflow
}

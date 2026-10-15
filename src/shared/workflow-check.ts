/**
 * The check of workflow definitions, which every definition Hoot runs passes
 * first, the built-in one included.
 */
import { z } from 'zod'
import type { WorkflowDefinition } from './workflows'

/** The ids of steps and the names of outcomes: lower-case letters and digits, in words joined by `-`. */
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

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

const outcomeSchema = z.strictObject({
  name: z.string().regex(NAME, 'An outcome name is not lower-case words joined by "-".'),
  label: line('An outcome label'),
  instruction: line("An outcome's instruction"),
  next: z.string().nullable(),
})

const stepSchema = z.strictObject({
  id: z.string().regex(NAME, 'A step id is not lower-case words joined by "-".'),
  name: line('A step name'),
  prompt: text("A step's prompt"),
  outcomes: z.array(outcomeSchema).min(1, 'A step has no outcome.'),
})

const workflowSchema = z
  .strictObject({
    name: line("The workflow's name"),
    steps: z.array(stepSchema).min(1, 'The workflow has no step.'),
  })
  .superRefine((workflow, context) => {
    const problem = (message: string, path: Array<string | number>) =>
      context.addIssue({ code: 'custom', message, path })
    const ids = new Set<string>()
    const names = new Set<string>()
    workflow.steps.forEach((step, index) => {
      if (ids.has(step.id)) problem(`Two steps have the id "${step.id}".`, ['steps', index, 'id'])
      if (names.has(step.name)) {
        problem(`Two steps have the name "${step.name}".`, ['steps', index, 'name'])
      }
      ids.add(step.id)
      names.add(step.name)
    })
    workflow.steps.forEach((step, index) => {
      const outcomes = new Set<string>()
      step.outcomes.forEach((outcome, position) => {
        const path = ['steps', index, 'outcomes', position]
        if (outcomes.has(outcome.name)) {
          problem(`${step.name} has two outcomes named "${outcome.name}".`, [...path, 'name'])
        }
        outcomes.add(outcome.name)
        if (outcome.next !== null && !ids.has(outcome.next)) {
          problem(`The outcome "${outcome.name}" leads to no step: "${outcome.next}".`, [
            ...path,
            'next',
          ])
        }
      })
    })
  })

export type WorkflowCheck =
  | { ok: true; workflow: WorkflowDefinition }
  | { ok: false; problems: string[] }

/**
 * Checks that something is a workflow definition Hoot can run: every step
 * with an id, a name, a prompt and at least one outcome; each outcome with a
 * name, a label, an instruction, and a step it leads to that the workflow
 * has, or none for the end. Ids, step names and the outcome names of a step
 * are each different, and nothing else is in it.
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

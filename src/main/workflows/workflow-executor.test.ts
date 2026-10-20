import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BUILT_IN_WORKFLOW } from '../../shared/built-in-workflow'
import type { Issue, IssueStatus } from '../../shared/issues'
import type { WorkflowDefinition, WorkflowStep } from '../../shared/workflows'
import { databaseFile } from '../database/database'
import { openTestDatabase } from '../database/test-support'
import { IssueStore } from '../issues/issue-store'
import { LabelStore } from '../labels/label-store'
import { ProjectStore } from '../projects/project-store'
import { WorkflowExecutor } from './workflow-executor'

let directory: string
let clock: number
const databases: DatabaseSync[] = []

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-workflows-'))
  clock = 1_000
})

afterEach(() => {
  for (const db of databases.splice(0)) db.close()
  fs.rmSync(directory, { recursive: true, force: true })
})

/** A workflow of two steps: Look, which goes on to Make, and Make. */
const TWO_STEPS: WorkflowDefinition = {
  name: 'Sample',
  group: 'Sample',
  steps: [
    {
      name: 'Look',
      label: { name: 'Looking', color: '4ea7fc', description: '' },
      prompt: 'Look at it.',
      outcomes: [{ label: 'Making', instruction: 'It is worth making.', goOn: true }],
    },
    {
      name: 'Make',
      label: { name: 'Making', color: 'bb87fc', description: '' },
      prompt: 'Make it.',
      outcomes: [{ label: 'Made', instruction: 'It is made.', goOn: false }],
    },
  ],
  endLabels: [{ name: 'Made', color: '4cb782', description: '', completeWithSubIssues: false }],
}

/**
 * Opens the database the way Hoot does when it starts, with a clock the test
 * sets, the projects gamma and hotel, the labels, and the executor of a
 * workflow, the built-in one unless another is given, which records the
 * issues it completes.
 */
function start(workflow: WorkflowDefinition = BUILT_IN_WORKFLOW) {
  const db = openTestDatabase(databaseFile(directory))
  databases.push(db)
  const projects = new ProjectStore(db)
  const issues = new IssueStore(db, () => clock)
  const labels = new LabelStore(db, () => clock)
  const executor = new WorkflowExecutor(db, workflow, labels, () => clock)
  const gamma = projects.find('/work/gamma') ?? projects.add('/work/gamma').project
  const hotel = projects.find('/work/hotel') ?? projects.add('/work/hotel').project
  const completed: Issue[][] = []
  executor.on('issues-completed', (done) => completed.push(done))
  /** Creates an issue in gamma, or in another project, with a parent when one is given. */
  const add = (
    title: string,
    status: IssueStatus = 'todo',
    parent: Issue | null = null,
    projectId: number = gamma.id,
  ) =>
    issues.create({ projectId, title, description: '', status, priority: 0 }, parent?.id ?? null)!
  const label = (name: string) => labels.findByName(name)!.id
  /** Gives an issue labels, by name, as the user does. */
  const give = (issue: Issue, ...names: string[]) =>
    labels.changeIssueLabels(issue.id, { add: names.map(label) }, 'user')
  const status = (issue: Issue) => issues.get(issue.id)?.status
  return { db, projects, issues, labels, executor, gamma, hotel, completed, add, give, status }
}

describe('the workflow group', () => {
  it("puts the workflow's group and labels in place when it starts, and keeps them once there", () => {
    const { labels, db } = start()
    expect(labels.list().map((label) => [label.group, label.name, label.color])).toEqual([
      ['Spec-driven', 'triaging', '4ea7fc'],
      ['Spec-driven', 'ready to design', 'bb87fc'],
      ['Spec-driven', 'designing', '5e6ad2'],
      ['Spec-driven', 'waiting on sub-issues', '95a2b3'],
    ])
    expect(labels.snapshot().groups).toEqual([
      { id: 1, name: 'Spec-driven', workflow: 'Spec-driven' },
    ])
    db.close()
    databases.pop()
    const again = start()
    expect(again.labels.list()).toHaveLength(4)
    expect(again.labels.snapshot().groups).toHaveLength(1)
  })

  it('gives the labels the colors and descriptions of the workflow as it is now', () => {
    start().db.close()
    databases.pop()
    const changed: WorkflowDefinition = {
      ...BUILT_IN_WORKFLOW,
      endLabels: BUILT_IN_WORKFLOW.endLabels.map((end) =>
        end.name === 'waiting on sub-issues'
          ? { ...end, color: '000000', description: 'Now' }
          : end,
      ),
    }
    const { labels } = start(changed)
    expect(labels.findByName('waiting on sub-issues')).toMatchObject({
      color: '000000',
      description: 'Now',
    })
    expect(labels.list()).toHaveLength(4)
  })

  it('keeps a label that stays in the workflow as another kind, such as an end label that becomes a ready label', () => {
    const [triage, design] = BUILT_IN_WORKFLOW.steps as [WorkflowStep, WorkflowStep]
    const triageAlone: WorkflowDefinition = {
      ...BUILT_IN_WORKFLOW,
      steps: [triage],
      endLabels: [
        { ...design.readyLabel!, completeWithSubIssues: false },
        ...BUILT_IN_WORKFLOW.endLabels,
      ],
    }
    const old = start(triageAlone)
    const issue = old.add('A')
    old.give(issue, 'ready to design')
    const { id } = old.labels.findByName('ready to design')!
    old.db.close()
    databases.pop()
    const { labels, executor } = start()
    expect(labels.findByName('ready to design')).toMatchObject({ id, group: 'Spec-driven' })
    expect(labels.labelsOf(issue.id).map((label) => label.name)).toEqual(['ready to design'])
    expect(executor.progress(issue.id)).toMatchObject({ kind: 'ready', step: { name: 'Design' } })
  })

  it('lets go of a label the workflow no longer has, which stays on its issues without a group', () => {
    const before: WorkflowDefinition = {
      ...BUILT_IN_WORKFLOW,
      endLabels: [
        ...BUILT_IN_WORKFLOW.endLabels,
        { name: 'Implemented', color: '4cb782', description: '', completeWithSubIssues: false },
      ],
    }
    const old = start(before)
    const issue = old.add('A')
    old.give(issue, 'Implemented')
    old.db.close()
    databases.pop()
    const { labels, executor } = start()
    const implemented = labels.findByName('Implemented')!
    expect(implemented.group).toBeNull()
    expect(labels.list().filter((label) => label.group === 'Spec-driven')).toHaveLength(4)
    expect(labels.labelsOf(issue.id).map((label) => label.name)).toEqual(['Implemented'])
    expect(executor.progress(issue.id)).toEqual({ kind: 'not-started' })
    // Like any label without a group, it can be changed and deleted now.
    expect(labels.editLabel(implemented.id, { name: 'Shipped' }).name).toBe('Shipped')
    labels.deleteLabel(implemented.id)
    expect(labels.labelsOf(issue.id)).toEqual([])
  })
})

describe('progress', () => {
  it("is the label of the workflow's group an issue carries, and nothing else", () => {
    const { executor, add, give } = start()
    const issue = add('A')
    expect(executor.progress(issue.id)).toEqual({ kind: 'not-started' })
    give(issue, 'triaging')
    expect(executor.progress(issue.id)).toMatchObject({
      kind: 'at-step',
      step: { name: 'Triage' },
    })
    give(issue, 'ready to design')
    expect(executor.progress(issue.id)).toMatchObject({
      kind: 'ready',
      step: { name: 'Design' },
    })
    give(issue, 'designing')
    expect(executor.progress(issue.id)).toMatchObject({
      kind: 'at-step',
      step: { name: 'Design' },
    })
    give(issue, 'waiting on sub-issues')
    expect(executor.progress(issue.id)).toMatchObject({
      kind: 'finished',
      label: { name: 'waiting on sub-issues' },
    })
  })
})

describe('sessionStart', () => {
  const files = {
    issueFile: '/w/.hoot/tmp/issue-1/issue.md',
    workflowFile: '/w/.hoot/tmp/issue-1/workflow.md',
    branch: 'iss-1-a',
  }

  it('starts at the first step for an issue not started, and at the step of its label otherwise', () => {
    const { executor, add, give } = start(TWO_STEPS)
    const issue = add('A')
    const first = executor.sessionStart(issue.id, 'ISS-1')
    expect(first.ok && first.step.name).toBe('Look')
    give(issue, 'Making')
    const make = executor.sessionStart(issue.id, 'ISS-1')
    expect(make.ok && make.step.name).toBe('Make')
    if (!make.ok) return
    const message = make.firstMessage(files)
    expect(message).toContain('`/w/.hoot/tmp/issue-1/issue.md`')
    expect(message).toContain('the branch `iss-1-a`')
    expect(message).toContain('Make it.')
    expect(message).toContain('`hoot issue edit ISS-1 --add-label Made`')
  })

  it('has the file of the workflow, and points to it, only for a step that may go on to another', () => {
    const { executor, add, give } = start(TWO_STEPS)
    const issue = add('A')
    const look = executor.sessionStart(issue.id, 'ISS-1')
    expect(look.ok).toBe(true)
    if (!look.ok) return
    expect(look.workflowFile?.startsWith('# Sample\n')).toBe(true)
    expect(look.firstMessage(files)).toContain(
      'the workflow it goes through in `/w/.hoot/tmp/issue-1/workflow.md`',
    )
    give(issue, 'Making')
    const make = executor.sessionStart(issue.id, 'ISS-1')
    expect(make.ok).toBe(true)
    if (!make.ok) return
    expect(make.workflowFile).toBeNull()
    expect(make.firstMessage(files)).not.toContain('workflow.md')
  })

  it('starts the built-in workflow at Triage, which stops either way and has no file of the workflow', () => {
    const { executor, add } = start()
    const issue = add('A')
    const triage = executor.sessionStart(issue.id, 'ISS-1')
    expect(triage.ok && triage.step.name).toBe('Triage')
    if (!triage.ok) return
    expect(triage.workflowFile).toBeNull()
    const message = triage.firstMessage(files)
    expect(message).toContain('`/w/.hoot/tmp/issue-1/issue.md`')
    expect(message).not.toContain('workflow.md')
    expect(message).toContain('Judge the issue against this project.')
    expect(message).toContain(
      "Run `hoot issue edit ISS-1 --add-label 'ready to design'`, then stop.",
    )
    expect(message).toContain(
      "Run `hoot issue edit ISS-1 --add-label 'waiting on sub-issues'`, then stop.",
    )
  })

  it('starts Design for an issue ready for it or at it, saying to stop once it is done, with no file of the workflow', () => {
    const { executor, add, give } = start()
    for (const label of ['ready to design', 'designing']) {
      const issue = add(label)
      give(issue, label)
      const design = executor.sessionStart(issue.id, 'ISS-1')
      expect(design.ok && design.step.name).toBe('Design')
      if (!design.ok) return
      expect(design.workflowFile).toBeNull()
      const message = design.firstMessage(files)
      expect(message).toContain('`/w/.hoot/tmp/issue-1/issue.md`')
      expect(message).toContain(
        '## Interview\n\nInterview the user until every decision is settled.',
      )
      expect(message).toContain(
        '## Summary\n\nWhen the frontier is empty, present a concise summary',
      )
      expect(message.endsWith('\n\nWhen this step is done, stop.')).toBe(true)
      expect(message).not.toContain('hoot issue edit')
      expect(message).not.toContain('workflow.md')
    }
  })

  it('refuses an issue whose workflow is finished', () => {
    const { executor, add, give } = start()
    const issue = add('A')
    give(issue, 'waiting on sub-issues')
    expect(executor.sessionStart(issue.id, 'ISS-1')).toEqual({
      ok: false,
      message: 'The workflow of ISS-1 is finished: it has the label "waiting on sub-issues".',
    })
  })
})

/** The names of labels, in their order. */
function labelNames(labels: Array<{ name: string }>): string[] {
  return labels.map((label) => label.name)
}

describe('sessionStarted', () => {
  const [triage, design] = BUILT_IN_WORKFLOW.steps as [WorkflowStep, WorkflowStep]

  it('gives an issue still waiting for the step the label of the step, by whoever opened the session', () => {
    const { executor, labels, add, give, status } = start()
    const user = add('A', 'backlog')
    const agent = add('B')
    const ready = add('C')
    give(ready, 'ready to design')
    clock = 2_000
    executor.sessionStarted(user.id, triage, 'user')
    executor.sessionStarted(agent.id, triage, 'agent')
    executor.sessionStarted(agent.id, triage, 'agent')
    executor.sessionStarted(ready.id, design, 'agent')
    expect(labelNames(labels.labelsOf(user.id))).toEqual(['triaging'])
    expect(labelNames(labels.labelsOf(agent.id))).toEqual(['triaging'])
    expect(labelNames(labels.labelsOf(ready.id))).toEqual(['designing'])
    expect(
      labels.eventsOfShown().map((event) => [event.issueId, event.kind, event.label, event.actor]),
    ).toEqual([
      [ready.id, 'added', 'Spec-driven › ready to design', 'user'],
      [user.id, 'added', 'Spec-driven › triaging', 'user'],
      [agent.id, 'added', 'Spec-driven › triaging', 'agent'],
      [ready.id, 'removed', 'Spec-driven › ready to design', 'agent'],
      [ready.id, 'added', 'Spec-driven › designing', 'agent'],
    ])
    // Its status is the window's to change.
    expect(status(user)).toBe('backlog')
    // An issue deleted meanwhile is given nothing.
    expect(() => executor.sessionStarted(999, triage, 'user')).not.toThrow()
  })

  it('gives nothing to an issue at the step already, finished, or whose label changed meanwhile', () => {
    const { executor, labels, add, give } = start()
    const at = add('A')
    give(at, 'designing')
    const finished = add('B')
    give(finished, 'waiting on sub-issues')
    const moved = add('C')
    give(moved, 'ready to design')
    const cleared = add('D')
    const before = labels.eventsOfShown().length
    executor.sessionStarted(at.id, design, 'user')
    executor.sessionStarted(finished.id, triage, 'user')
    // Their sessions were asked for at Triage and at Design.
    executor.sessionStarted(moved.id, triage, 'user')
    executor.sessionStarted(cleared.id, design, 'user')
    expect(labelNames(labels.labelsOf(at.id))).toEqual(['designing'])
    expect(labelNames(labels.labelsOf(finished.id))).toEqual(['waiting on sub-issues'])
    expect(labelNames(labels.labelsOf(moved.id))).toEqual(['ready to design'])
    expect(labels.labelsOf(cleared.id)).toEqual([])
    expect(labels.eventsOfShown()).toHaveLength(before)
  })
})

describe('completing an issue split once its sub-issues are', () => {
  it('changes nothing of the issue when it is given waiting on sub-issues, or of others when labels change', () => {
    const { add, give, status, issues, completed } = start()
    const p = add('P', 'in_progress')
    const s1 = add('S1', 'todo', p)
    add('S2', 'todo', p)
    give(p, 'waiting on sub-issues')
    expect(status(p)).toBe('in_progress')
    give(s1, 'ready to design')
    expect(status(s1)).toBe('todo')
    expect(issues.list().map((issue) => issue.status)).toEqual(['in_progress', 'todo', 'todo'])
    expect(completed).toEqual([])
  })

  it('makes it Done once all are completed and one is done, and Canceled once all are canceled', () => {
    const { add, give, status, issues, completed } = start()
    const p = add('P', 'in_progress')
    const s1 = add('S1', 'todo', p)
    const s2 = add('S2', 'todo', p)
    give(p, 'waiting on sub-issues')
    issues.update(s1.id, { status: 'done' })
    expect(status(p)).toBe('in_progress')
    clock = 5_000
    issues.update(s2.id, { status: 'canceled' })
    expect(issues.get(p.id)).toMatchObject({ status: 'done', completedAt: 5_000 })
    expect(completed).toEqual([[issues.get(p.id)]])
    const q = add('Q', 'todo')
    const t1 = add('T1', 'todo', q)
    const t2 = add('T2', 'todo', q)
    give(q, 'waiting on sub-issues')
    issues.update(t1.id, { status: 'canceled' })
    issues.update(t2.id, { status: 'canceled' })
    expect(status(q)).toBe('canceled')
  })

  it('completes it only when the condition comes to hold, not again when it holds still', () => {
    const { add, give, status, issues } = start()
    const p = add('P', 'in_progress')
    const s1 = add('S1', 'todo', p)
    const s2 = add('S2', 'todo', p)
    give(p, 'waiting on sub-issues')
    issues.update(s1.id, { status: 'done' })
    issues.update(s2.id, { status: 'canceled' })
    expect(status(p)).toBe('done')
    issues.update(s1.id, { status: 'todo' })
    expect(status(p)).toBe('done')
    issues.update(p.id, { status: 'in_progress' })
    expect(status(p)).toBe('in_progress')
    issues.update(s1.id, { status: 'done' })
    expect(status(p)).toBe('done')
    // Back to in progress by the user, with all its sub-issues completed: it stays so.
    issues.update(p.id, { status: 'in_progress' })
    add('S3', 'done', p)
    expect(status(p)).toBe('in_progress')
  })

  it('counts only the sub-issues Hoot shows, and completes it when a project leaves the list', () => {
    const { add, give, status, projects, hotel } = start()
    const r = add('R', 'todo')
    add('U1', 'done', r)
    add('U2', 'todo', r, hotel.id)
    give(r, 'waiting on sub-issues')
    expect(status(r)).toBe('todo')
    projects.remove(hotel.root)
    expect(status(r)).toBe('done')
  })

  it('needs a label that says so, and at least one sub-issue', () => {
    const { add, give, status, issues } = start()
    const w = add('W', 'todo')
    const v1 = add('V1', 'todo', w)
    issues.update(v1.id, { status: 'done' })
    expect(status(w)).toBe('todo')
    const x = add('X', 'todo')
    give(x, 'ready to design')
    const y1 = add('Y1', 'todo', x)
    issues.update(y1.id, { status: 'done' })
    expect(status(x)).toBe('todo')
    const lone = add('Lone', 'todo')
    give(lone, 'waiting on sub-issues')
    expect(status(lone)).toBe('todo')
  })

  it('completes it when a sub-issue is deleted or leaves it, and when it is given waiting on sub-issues', () => {
    const { add, give, status, issues } = start()
    const z = add('Z', 'todo')
    const z1 = add('Z1', 'todo', z)
    add('Z2', 'done', z)
    give(z, 'waiting on sub-issues')
    issues.delete(z1.id)
    expect(status(z)).toBe('done')
    const m = add('M', 'todo')
    const m1 = add('M1', 'todo', m)
    add('M2', 'done', m)
    give(m, 'waiting on sub-issues')
    issues.setParents([{ issueId: m1.id, parentId: null }])
    expect(status(m)).toBe('done')
    const n = add('N', 'todo')
    add('N1', 'done', n)
    give(n, 'waiting on sub-issues')
    expect(status(n)).toBe('done')
  })

  it('completes the parents of an issue completed so, in turn', () => {
    const { add, give, status, issues } = start()
    const top = add('Top', 'todo')
    const middle = add('Middle', 'todo', top)
    const leaf = add('Leaf', 'todo', middle)
    give(top, 'waiting on sub-issues')
    give(middle, 'waiting on sub-issues')
    issues.update(leaf.id, { status: 'done' })
    expect(status(middle)).toBe('done')
    expect(status(top)).toBe('done')
  })

  it('completes nothing in a change that is rolled back', () => {
    const { add, give, status, issues, completed } = start()
    const p = add('P', 'todo')
    const s1 = add('S1', 'todo', p)
    add('S2', 'done', p)
    give(p, 'waiting on sub-issues')
    expect(() =>
      issues.changeRelations({
        parents: [{ issueId: s1.id, parentId: null }],
        addDependencies: [{ issueId: p.id, blockedById: p.id }],
      }),
    ).toThrow('cannot be blocked by itself')
    expect(status(p)).toBe('todo')
    expect(completed).toEqual([])
  })

  it('follows the declaration of the definition it runs, whatever the label is named', () => {
    const workflow: WorkflowDefinition = {
      name: 'Other',
      group: 'Other',
      steps: [
        {
          name: 'Do',
          label: { name: 'Doing', color: '4ea7fc', description: '' },
          prompt: 'Do it.',
          outcomes: [{ label: 'Parted', instruction: 'Parted.', goOn: false }],
        },
      ],
      endLabels: [
        { name: 'Parted', color: '95a2b3', description: '', completeWithSubIssues: true },
      ],
    }
    const { add, give, status, issues } = start(workflow)
    const p = add('P', 'todo')
    const s = add('S', 'todo', p)
    give(p, 'Parted')
    issues.update(s.id, { status: 'done' })
    expect(status(p)).toBe('done')
  })
})

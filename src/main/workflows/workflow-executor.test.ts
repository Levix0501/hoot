import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BUILT_IN_WORKFLOW } from '../../shared/built-in-workflow'
import type { Issue, IssueStatus } from '../../shared/issues'
import type { WorkflowDefinition } from '../../shared/workflows'
import { databaseFile, openDatabase } from '../database/database'
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
  const db = openDatabase(databaseFile(directory))
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
      ['Spec-driven', 'split', '95a2b3'],
    ])
    expect(labels.snapshot().groups).toEqual([
      { id: 1, name: 'Spec-driven', workflow: 'Spec-driven' },
    ])
    db.close()
    databases.pop()
    const again = start()
    expect(again.labels.list()).toHaveLength(3)
    expect(again.labels.snapshot().groups).toHaveLength(1)
  })

  it('gives the labels the colors and descriptions of the workflow as it is now', () => {
    start().db.close()
    databases.pop()
    const changed: WorkflowDefinition = {
      ...BUILT_IN_WORKFLOW,
      endLabels: BUILT_IN_WORKFLOW.endLabels.map((end) =>
        end.name === 'split' ? { ...end, color: '000000', description: 'Now' } : end,
      ),
    }
    const { labels } = start(changed)
    expect(labels.findByName('split')).toMatchObject({ color: '000000', description: 'Now' })
    expect(labels.list()).toHaveLength(3)
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
    expect(labels.list().filter((label) => label.group === 'Spec-driven')).toHaveLength(3)
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
      kind: 'finished',
      label: { name: 'ready to design' },
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
    expect(message).toContain("`hoot issue edit ISS-1 --add-label 'ready to design'`, and stop.")
    expect(message).toContain('`hoot issue edit ISS-1 --add-label split`, and stop.')
  })

  it('refuses an issue whose workflow is finished', () => {
    const { executor, add, give } = start()
    const issue = add('A')
    give(issue, 'split')
    expect(executor.sessionStart(issue.id, 'ISS-1')).toEqual({
      ok: false,
      message: 'The workflow of ISS-1 is finished: it has the label "split".',
    })
  })
})

describe('sessionStarted', () => {
  it('gives an issue not started the first step’s label, by whoever opened the session, and nothing else', () => {
    const { executor, labels, add, give, status } = start()
    const user = add('A', 'backlog')
    const agent = add('B')
    clock = 2_000
    executor.sessionStarted(user.id, 'user')
    executor.sessionStarted(agent.id, 'agent')
    executor.sessionStarted(agent.id, 'agent')
    const at = add('C')
    give(at, 'ready to design')
    executor.sessionStarted(at.id, 'user')
    expect(labels.labelsOf(user.id).map((label) => label.name)).toEqual(['triaging'])
    expect(labels.labelsOf(at.id).map((label) => label.name)).toEqual(['ready to design'])
    expect(
      labels.eventsOfShown().map((event) => [event.issueId, event.kind, event.label, event.actor]),
    ).toEqual([
      [user.id, 'added', 'Spec-driven › triaging', 'user'],
      [agent.id, 'added', 'Spec-driven › triaging', 'agent'],
      [at.id, 'added', 'Spec-driven › ready to design', 'user'],
    ])
    // Its status is the window's to change.
    expect(status(user)).toBe('backlog')
    // An issue deleted meanwhile is given nothing.
    expect(() => executor.sessionStarted(999, 'user')).not.toThrow()
  })
})

describe('completing an issue split once its sub-issues are', () => {
  it('changes nothing of the issue when it is given split, or of others when labels change', () => {
    const { add, give, status, issues, completed } = start()
    const p = add('P', 'in_progress')
    const s1 = add('S1', 'todo', p)
    add('S2', 'todo', p)
    give(p, 'split')
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
    give(p, 'split')
    issues.update(s1.id, { status: 'done' })
    expect(status(p)).toBe('in_progress')
    clock = 5_000
    issues.update(s2.id, { status: 'canceled' })
    expect(issues.get(p.id)).toMatchObject({ status: 'done', completedAt: 5_000 })
    expect(completed).toEqual([[issues.get(p.id)]])
    const q = add('Q', 'todo')
    const t1 = add('T1', 'todo', q)
    const t2 = add('T2', 'todo', q)
    give(q, 'split')
    issues.update(t1.id, { status: 'canceled' })
    issues.update(t2.id, { status: 'canceled' })
    expect(status(q)).toBe('canceled')
  })

  it('completes it only when the condition comes to hold, not again when it holds still', () => {
    const { add, give, status, issues } = start()
    const p = add('P', 'in_progress')
    const s1 = add('S1', 'todo', p)
    const s2 = add('S2', 'todo', p)
    give(p, 'split')
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
    give(r, 'split')
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
    give(lone, 'split')
    expect(status(lone)).toBe('todo')
  })

  it('completes it when a sub-issue is deleted or leaves it, and when it is given split', () => {
    const { add, give, status, issues } = start()
    const z = add('Z', 'todo')
    const z1 = add('Z1', 'todo', z)
    add('Z2', 'done', z)
    give(z, 'split')
    issues.delete(z1.id)
    expect(status(z)).toBe('done')
    const m = add('M', 'todo')
    const m1 = add('M1', 'todo', m)
    add('M2', 'done', m)
    give(m, 'split')
    issues.setParents([{ issueId: m1.id, parentId: null }])
    expect(status(m)).toBe('done')
    const n = add('N', 'todo')
    add('N1', 'done', n)
    give(n, 'split')
    expect(status(n)).toBe('done')
  })

  it('completes the parents of an issue completed so, in turn', () => {
    const { add, give, status, issues } = start()
    const top = add('Top', 'todo')
    const middle = add('Middle', 'todo', top)
    const leaf = add('Leaf', 'todo', middle)
    give(top, 'split')
    give(middle, 'split')
    issues.update(leaf.id, { status: 'done' })
    expect(status(middle)).toBe('done')
    expect(status(top)).toBe('done')
  })

  it('completes nothing in a change that is rolled back', () => {
    const { add, give, status, issues, completed } = start()
    const p = add('P', 'todo')
    const s1 = add('S1', 'todo', p)
    add('S2', 'done', p)
    give(p, 'split')
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

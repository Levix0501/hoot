import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BUILT_IN_WORKFLOW } from '../../shared/built-in-workflow'
import { PICKED_IN_HOOT } from '../../shared/workflow-text'
import {
  workflowProgress,
  type WorkflowDefinition,
  type WorkflowRecord,
} from '../../shared/workflows'
import { databaseFile, openDatabase } from '../database/database'
import { IssueStore } from '../issues/issue-store'
import { ProjectStore } from '../projects/project-store'
import { NOT_FROM_AN_ISSUE, WorkflowExecutor } from './workflow-executor'

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

/**
 * Opens the database the way Hoot does when it starts, with a clock the test
 * sets, the project gamma and an issue in it, and the executor of a workflow,
 * the built-in one unless another is given, which records each change.
 */
function start(workflow: WorkflowDefinition = BUILT_IN_WORKFLOW) {
  const db = openDatabase(databaseFile(directory))
  databases.push(db)
  const projects = new ProjectStore(db)
  const issues = new IssueStore(db, () => clock)
  const executor = new WorkflowExecutor(db, workflow, () => clock)
  const gamma = projects.list()[0] ?? projects.add('/work/gamma').project
  const issue =
    issues.list()[0] ??
    issues.create({
      projectId: gamma.id,
      title: 'Fix the login bug',
      description: '',
      status: 'todo',
      priority: 0,
    })!
  const changes: Array<[number, WorkflowRecord[]]> = []
  executor.on('changed', (issueId, records) => changes.push([issueId, records]))
  return { db, projects, issues, executor, gamma, issue, changes }
}

/** The steps an issue's records say it went through, and its progress, in short. */
function story(executor: WorkflowExecutor, issueId: number): string[] {
  return executor.records(issueId).map((record) => {
    switch (record.kind) {
      case 'step-started':
        return `start ${record.step} @${record.at}`
      case 'step-reported':
        return `${record.step} → ${record.outcome} by ${record.reporter} @${record.at}`
      case 'started-over':
        return `start over @${record.at}`
    }
  })
}

describe('a session started from an issue', () => {
  it('starts the first step of an issue not started, at the time it started', () => {
    const { executor, issue, changes } = start()
    clock = 2_000
    executor.sessionStarted('s1', issue.id)
    expect(story(executor, issue.id)).toEqual(['start scope @2000'])
    expect(changes).toEqual([[issue.id, executor.records(issue.id)]])
    expect(workflowProgress(executor.records(issue.id))).toMatchObject({
      kind: 'at-step',
      step: 'scope',
      startedAt: 2_000,
    })
  })

  it('starts nothing new for an issue at a step, or finished', () => {
    const { executor, issue, changes } = start()
    executor.sessionStarted('s1', issue.id)
    executor.forgetSession('s1')
    executor.sessionStarted('s2', issue.id)
    expect(story(executor, issue.id)).toEqual(['start scope @1000'])
    expect(changes).toHaveLength(1)
    expect(executor.reportFromSession('s2', issue.id, 'split', 'Two parts.').ok).toBe(true)
    executor.sessionStarted('s3', issue.id)
    expect(story(executor, issue.id)).toEqual(['start scope @1000', 'scope → split by agent @1000'])
  })

  it('starts at the first step, or the step the issue is at, and refuses a finished workflow', () => {
    const { executor, issue } = start()
    expect(executor.sessionStart(issue.id)).toEqual({
      ok: true,
      step: BUILT_IN_WORKFLOW.steps[0],
      stepsFile: null,
    })
    executor.sessionStarted('s1', issue.id)
    executor.reportFromSession('s1', issue.id, 'no-split', 'Fits.\n')
    expect(executor.sessionStart(issue.id)).toEqual({
      ok: true,
      step: BUILT_IN_WORKFLOW.steps[1],
      stepsFile: '## Scope · No split\n\nFits.\n',
    })
    executor.reportFromSession('s1', issue.id, 'implement', 'Decided.')
    executor.reportFromSession('s1', issue.id, 'done', 'Changed it.')
    expect(executor.sessionStart(issue.id)).toEqual({
      ok: false,
      message: 'The workflow for this issue is finished.',
    })
  })

  it("writes what this round's outcomes found, those the user picked too, once one has a summary", () => {
    const { executor, issue } = start()
    executor.sessionStarted('s1', issue.id)
    const scope = workflowProgress(executor.records(issue.id))
    if (scope.kind !== 'at-step') throw new Error('Not at a step.')
    executor.reportByUser(issue.id, scope.run, 'no-split')
    // Only an outcome the user picked: nothing to write.
    expect(executor.sessionStart(issue.id)).toMatchObject({ ok: true, stepsFile: null })
    executor.startOver(issue.id)
    executor.sessionStarted('s2', issue.id)
    executor.reportFromSession('s2', issue.id, 'no-split', 'Fits again.')
    const design = workflowProgress(executor.records(issue.id))
    if (design.kind !== 'at-step') throw new Error('Not at a step.')
    executor.reportByUser(issue.id, design.run, 'implement')
    // Since the workflow started over.
    expect(executor.sessionStart(issue.id)).toEqual({
      ok: true,
      step: BUILT_IN_WORKFLOW.steps[2],
      stepsFile: `## Scope · No split\n\nFits again.\n\n## Design · Implement directly\n\n${PICKED_IN_HOOT}\n`,
    })
  })
})

describe('reportFromSession', () => {
  it('records the outcome and its summary, and starts the step it leads to, at the time of the report', () => {
    const { executor, issue, changes } = start()
    executor.sessionStarted('s1', issue.id)
    clock = 5_000
    const result = executor.reportFromSession('s1', issue.id, 'no-split', '# Why\n\nFits.\n')
    expect(result).toEqual({
      ok: true,
      report: {
        issue: `ISS-${issue.id}`,
        step: 'Scope',
        outcome: 'No split',
        next: BUILT_IN_WORKFLOW.steps[1],
      },
    })
    expect(story(executor, issue.id)).toEqual([
      'start scope @1000',
      'scope → no-split by agent @5000',
      'start design @5000',
    ])
    expect(executor.records(issue.id)[1]).toMatchObject({ summary: '# Why\n\nFits.\n' })
    expect(changes.at(-1)).toEqual([issue.id, executor.records(issue.id)])
    // The session is in the new run, and goes on reporting.
    clock = 6_000
    expect(executor.reportFromSession('s1', issue.id, 'implement', 'Decided.')).toMatchObject({
      ok: true,
      report: { step: 'Design', outcome: 'Implement directly', next: { name: 'Implement' } },
    })
  })

  it('finishes the workflow with an outcome that leads to no step', () => {
    const { executor, issue } = start()
    executor.sessionStarted('s1', issue.id)
    expect(executor.reportFromSession('s1', issue.id, 'split', '1. A\n2. B')).toEqual({
      ok: true,
      report: { issue: `ISS-${issue.id}`, step: 'Scope', outcome: 'Split', next: null },
    })
    expect(workflowProgress(executor.records(issue.id))).toEqual({ kind: 'finished' })
  })

  it('keeps the summary exactly as it is given', () => {
    const { executor, issue } = start()
    executor.sessionStarted('s1', issue.id)
    const summary = '﻿  Line\r\n\0end\n\n'
    executor.reportFromSession('s1', issue.id, 'no-split', summary)
    expect(executor.records(issue.id)[1]).toMatchObject({ summary })
  })

  it('refuses a session not started from an issue, and an issue that no longer exists', () => {
    const { executor, issues, issue, changes } = start()
    expect(executor.reportFromSession('shell', null, 'no-split', 'x')).toEqual({
      ok: false,
      message: NOT_FROM_AN_ISSUE,
    })
    expect(NOT_FROM_AN_ISSUE).toBe('this session was not started from an issue.')
    executor.sessionStarted('s1', issue.id)
    issues.delete(issue.id)
    expect(executor.reportFromSession('s1', issue.id, 'no-split', 'x')).toEqual({
      ok: false,
      message: `ISS-${issue.id} no longer exists in Hoot.`,
    })
    expect(changes).toHaveLength(1)
  })

  it('refuses a finished workflow', () => {
    const { executor, issue } = start()
    executor.sessionStarted('s1', issue.id)
    executor.reportFromSession('s1', issue.id, 'split', 'Split.')
    const before = executor.records(issue.id)
    expect(executor.reportFromSession('s1', issue.id, 'split', 'Again.')).toEqual({
      ok: false,
      message: `The workflow for ISS-${issue.id} is finished; there is no step left to report.`,
    })
    expect(executor.records(issue.id)).toEqual(before)
  })

  it("refuses an outcome the step does not have, and lists the step's outcomes", () => {
    const { executor, issue } = start()
    executor.sessionStarted('s1', issue.id)
    const before = executor.records(issue.id)
    expect(executor.reportFromSession('s1', issue.id, 'done', 'x')).toEqual({
      ok: false,
      message: 'done is not an outcome of Scope.\nOutcomes: no-split, split',
    })
    expect(executor.records(issue.id)).toEqual(before)
    executor.reportFromSession('s1', issue.id, 'no-split', 'x')
    expect(executor.reportFromSession('s1', issue.id, 'done', 'x')).toEqual({
      ok: false,
      message: 'done is not an outcome of Design.\nOutcomes: implement',
    })
  })

  it('refuses a session whose issue was moved on in Hoot, and says where it is now', () => {
    const { executor, issue } = start()
    executor.sessionStarted('s1', issue.id)
    executor.reportFromSession('s1', issue.id, 'no-split', 'Fits.')
    const design = workflowProgress(executor.records(issue.id))
    if (design.kind !== 'at-step') throw new Error('Not at a step.')
    expect(executor.reportByUser(issue.id, design.run, 'implement')).toEqual({ ok: true })
    const before = executor.records(issue.id)
    expect(executor.reportFromSession('s1', issue.id, 'implement', 'x')).toEqual({
      ok: false,
      message: `ISS-${issue.id} was moved on in Hoot; it is now at Implement. Close this session and start the issue again to continue.`,
    })
    // Also with an outcome of the step the issue is at now.
    expect(executor.reportFromSession('s1', issue.id, 'done', 'x').ok).toBe(false)
    expect(executor.records(issue.id)).toEqual(before)
    executor.startOver(issue.id)
    expect(executor.reportFromSession('s1', issue.id, 'no-split', 'x')).toEqual({
      ok: false,
      message: `ISS-${issue.id} was moved on in Hoot; it is now Not started. Close this session and start the issue again to continue.`,
    })
  })

  it('refuses a session of the issue that started before the current run', () => {
    const { executor, issue } = start()
    executor.sessionStarted('old', issue.id)
    executor.startOver(issue.id)
    executor.sessionStarted('new', issue.id)
    expect(executor.reportFromSession('old', issue.id, 'no-split', 'x').ok).toBe(false)
    expect(executor.reportFromSession('new', issue.id, 'no-split', 'x').ok).toBe(true)
    // A session Hoot was not told of is in no run.
    expect(executor.reportFromSession('unknown', issue.id, 'implement', 'x').ok).toBe(false)
  })

  it('reports whatever the status and project of the issue are now', () => {
    const { executor, issues, projects, issue } = start()
    const hotel = projects.add('/work/hotel').project
    executor.sessionStarted('s1', issue.id)
    issues.update(issue.id, { status: 'done', projectId: hotel.id })
    expect(executor.reportFromSession('s1', issue.id, 'no-split', 'x').ok).toBe(true)
    projects.remove(hotel.root)
    expect(executor.reportFromSession('s1', issue.id, 'implement', 'x').ok).toBe(true)
    expect(issues.update(issue.id, {})).toBeNull()
  })
})

describe('reportByUser', () => {
  it('records the outcome without a summary, as the user picked it, and starts the step it leads to', () => {
    const { executor, issue, changes } = start()
    executor.sessionStarted('s1', issue.id)
    const scope = workflowProgress(executor.records(issue.id))
    if (scope.kind !== 'at-step') throw new Error('Not at a step.')
    clock = 3_000
    expect(executor.reportByUser(issue.id, scope.run, 'no-split')).toEqual({ ok: true })
    expect(story(executor, issue.id)).toEqual([
      'start scope @1000',
      'scope → no-split by user @3000',
      'start design @3000',
    ])
    expect(executor.records(issue.id)[1]).toMatchObject({ summary: null })
    expect(changes.at(-1)).toEqual([issue.id, executor.records(issue.id)])
  })

  it('refuses a run that is no longer current, and an outcome the step does not have', () => {
    const { executor, issue } = start()
    executor.sessionStarted('s1', issue.id)
    const scope = workflowProgress(executor.records(issue.id))
    if (scope.kind !== 'at-step') throw new Error('Not at a step.')
    expect(executor.reportByUser(issue.id, scope.run, 'implement')).toEqual({
      ok: false,
      message: 'implement is not an outcome of Scope.\nOutcomes: no-split, split',
    })
    executor.reportFromSession('s1', issue.id, 'no-split', 'x')
    expect(executor.reportByUser(issue.id, scope.run, 'no-split')).toEqual({
      ok: false,
      message: `ISS-${issue.id} has moved on to another step meanwhile.`,
    })
    expect(executor.reportByUser(issue.id + 1, scope.run, 'no-split').ok).toBe(false)
  })
})

describe('startOver', () => {
  it('makes the issue not started again, keeping its records', () => {
    const { executor, issue, changes } = start()
    expect(executor.startOver(issue.id)).toEqual({
      ok: false,
      message: `ISS-${issue.id} has not started.`,
    })
    executor.sessionStarted('s1', issue.id)
    executor.reportFromSession('s1', issue.id, 'split', 'Split.')
    clock = 9_000
    expect(executor.startOver(issue.id)).toEqual({ ok: true })
    expect(story(executor, issue.id)).toEqual([
      'start scope @1000',
      'scope → split by agent @1000',
      'start over @9000',
    ])
    expect(workflowProgress(executor.records(issue.id))).toEqual({ kind: 'not-started' })
    expect(changes.at(-1)).toEqual([issue.id, executor.records(issue.id)])
    // Started again, it starts at the first step.
    executor.sessionStarted('s2', issue.id)
    expect(story(executor, issue.id).at(-1)).toBe('start scope @9000')
  })
})

describe('the records', () => {
  it('stay when Hoot starts again, and when the issue changes', () => {
    const { executor, issue, issues } = start()
    executor.sessionStarted('s1', issue.id)
    executor.reportFromSession('s1', issue.id, 'no-split', 'Fits.')
    const before = executor.records(issue.id)
    issues.update(issue.id, { status: 'done', title: 'Renamed', projectId: null })
    issues.update(issue.id, { status: 'in_progress' })
    const restarted = start()
    expect(restarted.issue.id).toBe(issue.id)
    expect(restarted.executor.records(issue.id)).toEqual(before)
  })

  it('go with their issue when it is deleted', () => {
    const { db, executor, issues, issue } = start()
    executor.sessionStarted('s1', issue.id)
    executor.reportFromSession('s1', issue.id, 'split', 'Split.')
    issues.delete(issue.id)
    expect(executor.records(issue.id)).toEqual([])
    expect(db.prepare('SELECT COUNT(*) AS count FROM workflow_records').get()).toEqual({
      count: 0,
    })
  })

  it('are listed for the issues Hoot shows, by issue', () => {
    const { executor, issues, projects, issue } = start()
    const hotel = projects.add('/work/hotel').project
    const other = issues.create({
      projectId: hotel.id,
      title: 'Other',
      description: '',
      status: 'todo',
      priority: 0,
    })!
    const loose = issues.create({
      projectId: null,
      title: 'Loose',
      description: '',
      status: 'todo',
      priority: 0,
    })!
    for (const id of [issue.id, other.id, loose.id]) executor.sessionStarted(`s${id}`, id)
    expect(Object.keys(executor.listShown()).map(Number)).toEqual([issue.id, other.id, loose.id])
    projects.remove(hotel.root)
    expect(executor.listShown()).toEqual({
      [issue.id]: executor.records(issue.id),
      [loose.id]: executor.records(loose.id),
    })
  })

  it('refuse what does not fit their kind', () => {
    const { db, issue } = start()
    const insert = (
      kind: string,
      step: string | null,
      outcome: string | null,
      reporter: string | null,
      summary: string | null,
    ) =>
      db
        .prepare(
          `INSERT INTO workflow_records (issue_id, kind, step, outcome, reporter, summary, at)
           VALUES (?, ?, ?, ?, ?, ?, 0)`,
        )
        .run(issue.id, kind, step, outcome, reporter, summary)
    expect(() => insert('step-started', null, null, null, null)).toThrow(/CHECK constraint/)
    expect(() => insert('step-reported', 'scope', 'split', 'agent', null)).toThrow(/CHECK/)
    expect(() => insert('step-reported', 'scope', 'split', 'user', 'S')).toThrow(/CHECK/)
    expect(() => insert('step-reported', 'scope', 'split', 'robot', null)).toThrow(/CHECK/)
    expect(() => insert('started-over', 'scope', null, null, null)).toThrow(/CHECK/)
    expect(() => insert('paused', 'scope', null, null, null)).toThrow(/CHECK/)
    expect(() =>
      db
        .prepare(
          `INSERT INTO workflow_records (issue_id, kind, at) VALUES (999, 'started-over', 0)`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY/)
  })
})

describe('any workflow', () => {
  it('runs as its definition says', () => {
    const workflow: WorkflowDefinition = {
      name: 'Loop',
      steps: [
        {
          id: 'try',
          name: 'Try',
          prompt: 'Try it.',
          outcomes: [
            { name: 'again', label: 'Again', instruction: 'try again.', next: 'try' },
            { name: 'check', label: 'Check', instruction: 'check it.', next: 'check' },
          ],
        },
        {
          id: 'check',
          name: 'Check',
          prompt: 'Check it.',
          outcomes: [{ name: 'ok', label: 'Fine', instruction: 'it is fine.', next: null }],
        },
      ],
    }
    const { executor, issue } = start(workflow)
    executor.sessionStarted('s1', issue.id)
    expect(executor.reportFromSession('s1', issue.id, 'again', 'Once.')).toMatchObject({
      ok: true,
      report: { step: 'Try', outcome: 'Again', next: { name: 'Try' } },
    })
    expect(executor.reportFromSession('s1', issue.id, 'check', 'Twice.')).toMatchObject({
      ok: true,
      report: { next: { name: 'Check' } },
    })
    expect(executor.reportFromSession('s1', issue.id, 'ok', 'Done.')).toMatchObject({
      ok: true,
      report: { step: 'Check', outcome: 'Fine', next: null },
    })
    expect(story(executor, issue.id)).toEqual([
      'start try @1000',
      'try → again by agent @1000',
      'start try @1000',
      'try → check by agent @1000',
      'start check @1000',
      'check → ok by agent @1000',
    ])
  })
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BUILT_IN_WORKFLOW } from '../../shared/built-in-workflow'
import type { Issue } from '../../shared/issues'
import { labelText, type LabelEvent, type Labels } from '../../shared/labels'
import { workflowLabels } from '../../shared/workflows'
import { databaseFile, openDatabase, transaction } from '../database/database'
import { IssueStore } from '../issues/issue-store'
import { ProjectStore } from '../projects/project-store'
import { LabelError, LabelStore } from './label-store'

let directory: string
let clock: number
const databases: DatabaseSync[] = []

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hoot-labels-'))
  clock = 1_000
})

afterEach(() => {
  for (const db of databases.splice(0)) db.close()
  fs.rmSync(directory, { recursive: true, force: true })
})

/**
 * Opens the database, with the projects gamma and hotel, the labels with the
 * built-in workflow's group in place, and what they say when they change.
 */
function start() {
  const db = openDatabase(databaseFile(directory))
  databases.push(db)
  const projects = new ProjectStore(db)
  const issues = new IssueStore(db, () => clock)
  const labels = new LabelStore(
    db,
    () => clock,
    () => 0,
  )
  labels.ensureWorkflowGroup(
    BUILT_IN_WORKFLOW.name,
    BUILT_IN_WORKFLOW.group,
    workflowLabels(BUILT_IN_WORKFLOW),
  )
  const gamma = projects.find('/work/gamma') ?? projects.add('/work/gamma').project
  const hotel = projects.find('/work/hotel') ?? projects.add('/work/hotel').project
  const changes: Labels[] = []
  const events: LabelEvent[][] = []
  labels.on('changed', (snapshot) => changes.push(snapshot))
  labels.on('events-added', (added) => events.push(added))
  const add = (title: string, projectId: number = gamma.id): Issue =>
    issues.create({ projectId, title, description: '', status: 'todo', priority: 0 })!
  const id = (name: string) => labels.findByName(name)!.id
  const give = (issue: Issue, ...names: string[]) =>
    labels.changeIssueLabels(issue.id, { add: names.map(id) }, 'user')
  const carried = (issue: Issue) =>
    labels.labelsOf(issue.id).map((label) => labelText(label.name, label.group))
  return { db, projects, issues, labels, gamma, hotel, changes, events, add, id, give, carried }
}

describe('LabelStore', () => {
  it('creates labels and groups, with names no other has whatever their case', () => {
    const { labels } = start()
    const kind = labels.createGroup('Kind')
    const feature = labels.createLabel({ name: ' Feature ', groupId: kind.id, color: 'FF8800' })
    expect(feature).toMatchObject({
      name: 'Feature',
      color: 'ff8800',
      group: 'Kind',
      description: '',
    })
    expect(labels.createLabel({ name: 'ui' }).color).toBe('95a2b3')
    expect(() => labels.createLabel({ name: 'feature' })).toThrow(
      new LabelError(
        'There is a label named "Kind › Feature" already: no two labels can have the same name.',
      ),
    )
    expect(() => labels.createLabel({ name: 'Triaging' })).toThrow(/Spec-driven › triaging/)
    expect(() => labels.createGroup('kind')).toThrow(/There is a group named "Kind" already/)
    expect(() => labels.createLabel({ name: '  ' })).toThrow('A label needs a name.')
    expect(() => labels.createLabel({ name: 'z', color: 'red' })).toThrow(/is not a color/)
    expect(() => labels.createLabel({ name: 'z', groupId: 1 })).toThrow(
      /belongs to the workflow Spec-driven/,
    )
  })

  it('gives an issue at most one label of a group, taking the other off, and records each change', () => {
    const { labels, add, give, carried, events } = start()
    const kind = labels.createGroup('Kind')
    labels.createLabel({ name: 'Feature', groupId: kind.id })
    labels.createLabel({ name: 'Chore', groupId: kind.id })
    labels.createLabel({ name: 'ui' })
    const a = add('A')
    give(a, 'Feature', 'ui')
    clock = 2_000
    give(a, 'Chore')
    expect(carried(a)).toEqual(['Kind › Chore', 'ui'])
    expect(events.flat().map((event) => [event.kind, event.label, event.at])).toEqual([
      ['added', 'Kind › Feature', 1_000],
      ['added', 'ui', 1_000],
      ['removed', 'Kind › Feature', 2_000],
      ['added', 'Kind › Chore', 2_000],
    ])
    // Given what it has, or taken off what it does not have, nothing changes.
    give(a, 'ui')
    labels.changeIssueLabels(a.id, { remove: [labels.findByName('Feature')!.id] }, 'agent')
    expect(events.flat()).toHaveLength(4)
    expect(() => labels.changeIssueLabels(a.id, { add: [999] }, 'user')).toThrow(
      'The label no longer exists.',
    )
    expect(() =>
      labels.changeIssueLabels(
        a.id,
        { add: [labels.findByName('ui')!.id], remove: [labels.findByName('ui')!.id] },
        'user',
      ),
    ).toThrow(/cannot both be given to ISS-1 and taken off it/)
  })

  it('moves a label into a group, another group or none, unless an issue would have two of a group', () => {
    const { labels, add, give, carried } = start()
    const kind = labels.createGroup('Kind')
    labels.createLabel({ name: 'Feature', groupId: kind.id })
    labels.createLabel({ name: 'Chore', groupId: kind.id })
    for (const name of ['ui', 'docs', 'misc']) labels.createLabel({ name })
    const a = add('A')
    const b = add('B')
    give(a, 'Chore', 'ui')
    give(b, 'docs', 'misc')
    const ui = labels.findByName('ui')!
    expect(() => labels.editLabel(ui.id, { groupId: kind.id })).toThrow(
      new LabelError(
        'ui cannot be moved into Kind: ISS-1 carries it and Kind › Chore, and an issue carries at most one label of a group.',
      ),
    )
    labels.editLabel(labels.findByName('misc')!.id, { groupId: kind.id })
    expect(carried(b)).toEqual(['docs', 'Kind › misc'])
    expect(() => labels.editLabel(labels.findByName('docs')!.id, { groupId: kind.id })).toThrow(
      /docs cannot be moved into Kind: ISS-2 carries it and Kind › misc/,
    )
    const area = labels.createGroup('Area')
    const feature = labels.findByName('Feature')!
    expect(labels.editLabel(feature.id, { groupId: area.id }).group).toBe('Area')
    expect(labels.editLabel(feature.id, { groupId: null }).group).toBeNull()
    expect(() => labels.editLabel(feature.id, { groupId: 1 })).toThrow(/belongs to the workflow/)
  })

  it('names an issue Hoot does not show without its identifier', () => {
    const { labels, projects, hotel, add, give } = start()
    const kind = labels.createGroup('Kind')
    labels.createLabel({ name: 'Chore', groupId: kind.id })
    labels.createLabel({ name: 'ui' })
    const hidden = add('H', hotel.id)
    give(hidden, 'Chore', 'ui')
    projects.remove(hotel.root)
    expect(() => labels.editLabel(labels.findByName('ui')!.id, { groupId: kind.id })).toThrow(
      /an issue Hoot does not show carries it/,
    )
  })

  it('changes the name, color and description of a label, and not those of the workflow', () => {
    const { labels } = start()
    const chore = labels.createLabel({ name: 'Chore' })
    expect(
      labels.editLabel(chore.id, { name: 'Task', color: '112233', description: ' Small ' }),
    ).toMatchObject({ name: 'Task', color: '112233', description: 'Small' })
    expect(labels.editLabel(chore.id, { name: 'task' }).name).toBe('task')
    expect(() => labels.editLabel(chore.id, { name: 'Triaging' })).toThrow(/There is a label named/)
    for (const change of [{ name: 'Begin' }, { color: '112233' }, { description: 'x' }]) {
      expect(() => labels.editLabel(labels.findByName('triaging')!.id, change)).toThrow(
        'Spec-driven › triaging belongs to the workflow Spec-driven: it can only be given to issues and taken off them.',
      )
    }
  })

  it('deletes a label from every issue, without recording it, and keeps what was recorded before', () => {
    const { labels, projects, hotel, add, give, carried, events } = start()
    labels.createLabel({ name: 'wip' })
    const a = add('A', hotel.id)
    const b = add('B')
    give(a, 'wip')
    give(b, 'wip')
    projects.remove(hotel.root)
    const recorded = labels.eventsOfShown()
    labels.deleteLabel(labels.findByName('wip')!.id)
    expect(carried(b)).toEqual([])
    expect(labels.eventsOfShown()).toEqual(recorded)
    expect(recorded.map((event) => event.label)).toEqual(['wip'])
    projects.add(hotel.root)
    expect(carried(a)).toEqual([])
    expect(events.flat()).toHaveLength(2)
    expect(() => labels.deleteLabel(labels.findByName('waiting on sub-issues')!.id)).toThrow(
      /belongs to the workflow/,
    )
  })

  it('deletes a group, leaving its labels without one, on the issues that have them', () => {
    const { labels, add, give, carried } = start()
    const kind = labels.createGroup('Kind')
    labels.createLabel({ name: 'Task', groupId: kind.id })
    labels.createLabel({ name: 'Feature', groupId: kind.id })
    const a = add('A')
    give(a, 'Task')
    labels.deleteGroup(kind.id)
    expect(carried(a)).toEqual(['Task'])
    give(a, 'Feature')
    expect(carried(a)).toEqual(['Feature', 'Task'])
    expect(() => labels.deleteGroup(1)).toThrow(/belongs to the workflow Spec-driven/)
  })

  it('says what changed once it is saved, and nothing for a change rolled back', () => {
    const { labels, db, add, give, changes, events } = start()
    const before = changes.length
    labels.createLabel({ name: 'x' })
    expect(changes).toHaveLength(before + 1)
    expect(changes.at(-1)!.labels.map((label) => label.name)).toContain('x')
    const a = add('A')
    expect(() =>
      transaction(db, () => {
        give(a, 'x')
        throw new Error('Rolled back.')
      }),
    ).toThrow('Rolled back.')
    expect(changes).toHaveLength(before + 1)
    expect(events).toEqual([])
    expect(labels.labelsOf(a.id)).toEqual([])
    // Created and given together, as the label picker does.
    const created = labels.createLabel({ name: 'bug' }, { issueId: a.id, actor: 'user' })
    expect(labels.labelsOf(a.id).map((label) => label.id)).toEqual([created.id])
    expect(changes.at(-1)!.version).toBeGreaterThan(changes.at(-2)!.version)
  })

  it('keeps the labels of an issue that changes project, or has none', () => {
    const { labels, issues, add, give, carried, hotel } = start()
    labels.createLabel({ name: 'x' })
    const a = add('A')
    give(a, 'x', 'ready to design')
    issues.update(a.id, { projectId: hotel.id })
    expect(carried(a)).toEqual(['Spec-driven › ready to design', 'x'])
    issues.update(a.id, { projectId: null })
    expect(carried(a)).toEqual(['Spec-driven › ready to design', 'x'])
  })
})

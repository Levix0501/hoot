import { EventEmitter } from 'node:events'
import type { DatabaseSync } from 'node:sqlite'
import { issueIdentifier } from '../../shared/issues'
import {
  isLabelColor,
  LABEL_DESCRIPTION_MAX_LENGTH,
  LABEL_NAME_MAX_LENGTH,
  labelName,
  labelOrder,
  labelText,
  nameKey,
  randomLabelColor,
  type Label,
  type LabelActor,
  type LabelEvent,
  type LabelGroup,
  type Labels,
  type NamedLabel,
} from '../../shared/labels'
import type { WorkflowLabel } from '../../shared/workflows'
import { observeTransactions, transaction } from '../database/database'

interface LabelRow {
  id: number
  name: string
  color: string
  description: string
  group_id: number | null
}

interface GroupRow {
  id: number
  name: string
  workflow: string | null
}

interface EventRow {
  id: number
  issue_id: number
  kind: LabelEvent['kind']
  label: string
  color: string
  actor: LabelActor
  at: number
}

function labelFromRow(row: LabelRow): Label {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    description: row.description,
    groupId: row.group_id,
  }
}

function eventFromRow(row: EventRow): LabelEvent {
  return {
    id: row.id,
    issueId: row.issue_id,
    kind: row.kind,
    label: row.label,
    color: row.color,
    actor: row.actor,
    at: row.at,
  }
}

/** The issues Hoot shows: those without a project, and those of the projects in the list. */
const SHOWN_ISSUES = `SELECT id FROM issues WHERE project_id IS NULL OR project_id IN
  (SELECT id FROM projects WHERE list_position IS NOT NULL)`

/** How an issue Hoot does not show, as one of a removed project, is named in a reason. */
const UNSHOWN_ISSUE = 'an issue Hoot does not show'

/** Why labels or groups cannot be created, changed or deleted, or given to an issue, as asked. */
export class LabelError extends Error {}

/** A label to create: its name as entered, its color, or one Hoot picks, its description and its group. */
export interface NewLabel {
  name: string
  color?: string
  description?: string
  groupId?: number | null
}

/** What changes about a label; what is left out stays as it is. `null` takes it out of its group. */
export interface LabelChanges {
  name?: string
  color?: string
  description?: string
  groupId?: number | null
}

/** Labels an issue is given, in this order, and labels taken off it. */
export interface IssueLabelChange {
  add?: readonly number[]
  remove?: readonly number[]
}

/** A name to save, or a `LabelError` saying what is wrong with it; `what` is "A label" or "A group". */
function savedName(entered: string, what: string): string {
  const name = labelName(entered)
  if (name === '') throw new LabelError(`${what} needs a name.`)
  if (name.length > LABEL_NAME_MAX_LENGTH) {
    throw new LabelError(
      `${what}'s name can be at most ${LABEL_NAME_MAX_LENGTH} characters long; this one has ${name.length}.`,
    )
  }
  return name
}

/** A color to save, in lower case, or a `LabelError` when it is not six hexadecimal digits. */
function savedColor(color: string): string {
  if (!isLabelColor(color)) {
    throw new LabelError(
      `"${color}" is not a color: give six hexadecimal digits, without #, such as ff8800.`,
    )
  }
  return color.toLowerCase()
}

/** A description to save, without the whitespace around it, or a `LabelError` when it is too long. */
function savedDescription(description: string): string {
  const saved = description.trim()
  if (saved.length > LABEL_DESCRIPTION_MAX_LENGTH) {
    throw new LabelError(
      `A label's description can be at most ${LABEL_DESCRIPTION_MAX_LENGTH} characters long; this one has ${saved.length}.`,
    )
  }
  return saved
}

/**
 * The labels and their groups, kept in the database, and the labels each
 * issue carries, with the activity of each issue's labels. Labels belong to
 * no project. No two labels have the same name, nor two groups, whatever the
 * case, and an issue carries at most one label of a group: given another, it
 * no longer carries the one it had. The group of a workflow and its labels
 * change only as the workflow says. It says when anything about the labels
 * changes, once the change is saved, and gives the issues' new activity.
 */
export class LabelStore extends EventEmitter<{
  changed: [labels: Labels]
  'events-added': [events: LabelEvent[]]
}> {
  private readonly statements
  /** Grows with every change. */
  private version = 0
  /** Whether the transaction under way changed anything, and the activity it added. */
  private changedNow = false
  private eventsNow: LabelEvent[] = []

  constructor(
    private readonly db: DatabaseSync,
    /** The time to record, in milliseconds since the Unix epoch. */
    private readonly now: () => number = Date.now,
    /** Picks the colors of labels created without one. */
    private readonly random: () => number = Math.random,
  ) {
    super()
    this.statements = {
      groups: db.prepare('SELECT id, name, workflow FROM label_groups ORDER BY id'),
      group: db.prepare('SELECT id, name, workflow FROM label_groups WHERE id = ?'),
      groupByKey: db.prepare('SELECT id, name, workflow FROM label_groups WHERE name_key = ?'),
      groupOfWorkflow: db.prepare('SELECT id, name, workflow FROM label_groups WHERE workflow = ?'),
      insertGroup: db.prepare(
        'INSERT INTO label_groups (name, name_key, workflow) VALUES (?, ?, ?)',
      ),
      updateGroup: db.prepare(
        'UPDATE label_groups SET name = ?, name_key = ?, workflow = ? WHERE id = ?',
      ),
      deleteGroup: db.prepare('DELETE FROM label_groups WHERE id = ?'),
      labels: db.prepare('SELECT id, name, color, description, group_id FROM labels ORDER BY id'),
      label: db.prepare('SELECT id, name, color, description, group_id FROM labels WHERE id = ?'),
      labelByKey: db.prepare(
        'SELECT id, name, color, description, group_id FROM labels WHERE name_key = ?',
      ),
      insertLabel: db.prepare(
        `INSERT INTO labels (name, name_key, color, description, group_id) VALUES (?, ?, ?, ?, ?)`,
      ),
      updateLabel: db.prepare(
        `UPDATE labels SET name = ?, name_key = ?, color = ?, description = ?, group_id = ?
         WHERE id = ?`,
      ),
      deleteLabel: db.prepare('DELETE FROM labels WHERE id = ?'),
      ungroupOthers: db.prepare(
        `UPDATE labels SET group_id = NULL
         WHERE group_id = ? AND id NOT IN (SELECT value FROM json_each(?))`,
      ),
      issueLabels: db.prepare(
        'SELECT issue_id, label_id FROM issue_labels ORDER BY issue_id, label_id',
      ),
      labelsOfIssue: db.prepare('SELECT label_id FROM issue_labels WHERE issue_id = ?'),
      carry: db.prepare('INSERT INTO issue_labels (issue_id, label_id) VALUES (?, ?)'),
      uncarry: db.prepare('DELETE FROM issue_labels WHERE issue_id = ? AND label_id = ?'),
      carriers: db.prepare(
        'SELECT issue_id FROM issue_labels WHERE label_id = ? ORDER BY issue_id',
      ),
      issue: db.prepare('SELECT id FROM issues WHERE id = ?'),
      shownIssue: db.prepare(`SELECT 1 FROM (${SHOWN_ISSUES}) WHERE id = ?`),
      insertEvent: db.prepare(
        `INSERT INTO label_events (issue_id, kind, label, color, actor, at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ),
      event: db.prepare(
        'SELECT id, issue_id, kind, label, color, actor, at FROM label_events WHERE id = ?',
      ),
      shownEvents: db.prepare(
        `SELECT id, issue_id, kind, label, color, actor, at FROM label_events
         WHERE issue_id IN (${SHOWN_ISSUES}) ORDER BY id`,
      ),
    }
    // Said once the change is saved, also when it is part of a larger one.
    observeTransactions(db, {
      begin: () => {
        this.changedNow = false
        this.eventsNow = []
      },
      beforeCommit: () => {},
      end: (committed) => {
        const changed = this.changedNow
        const events = this.eventsNow
        this.changedNow = false
        this.eventsNow = []
        if (!committed || !changed) return
        this.version++
        this.emit('changed', this.snapshot())
        if (events.length > 0) this.emit('events-added', events)
      },
    })
  }

  /** Every label and group, and the labels of every issue, those of removed projects included. */
  snapshot(): Labels {
    return {
      version: this.version,
      groups: this.groups(),
      labels: (this.statements.labels.all() as unknown as LabelRow[]).map(labelFromRow),
      issueLabels: (
        this.statements.issueLabels.all() as unknown as Array<{
          issue_id: number
          label_id: number
        }>
      ).map((row) => ({ issueId: row.issue_id, labelId: row.label_id })),
    }
  }

  /** Every label, with its group's name, in the order Hoot lists labels. */
  list(): NamedLabel[] {
    return labelOrder(this.snapshot())
  }

  /** The label with this name, without regard to case, if any. */
  findByName(name: string): NamedLabel | undefined {
    const row = this.statements.labelByKey.get(nameKey(labelName(name))) as LabelRow | undefined
    return row ? this.named(row) : undefined
  }

  /** The labels an issue carries, in the order Hoot lists labels. */
  labelsOf(issueId: number): NamedLabel[] {
    const carried = new Set(this.carriedBy(issueId))
    return this.list().filter((label) => carried.has(label.id))
  }

  /** The label with this id, if any. */
  label(id: number): NamedLabel | undefined {
    const row = this.statements.label.get(id) as LabelRow | undefined
    return row ? this.named(row) : undefined
  }

  /** The activity of the labels of the issues Hoot shows, in the order it happened. */
  eventsOfShown(): LabelEvent[] {
    return (this.statements.shownEvents.all() as unknown as EventRow[]).map(eventFromRow)
  }

  /** Creates a group of labels, without labels. */
  createGroup(entered: string): LabelGroup {
    return transaction(this.db, () => {
      const name = savedName(entered, 'A group')
      const existing = this.statements.groupByKey.get(nameKey(name)) as GroupRow | undefined
      if (existing) throw new LabelError(`There is a group named "${existing.name}" already.`)
      const { lastInsertRowid } = this.statements.insertGroup.run(name, nameKey(name), null)
      this.changedNow = true
      return { id: Number(lastInsertRowid), name, workflow: null }
    })
  }

  /** Deletes a group; its labels stay, without a group, and the issues carrying them still do. */
  deleteGroup(id: number): void {
    transaction(this.db, () => {
      const group = this.groupRow(id)
      this.refuseWorkflowGroup(group)
      this.statements.deleteGroup.run(id)
      this.changedNow = true
    })
  }

  /**
   * Creates a label, with the color given or one Hoot picks, and gives it to
   * an issue when `issueId` names one.
   */
  createLabel(label: NewLabel, given?: { issueId: number; actor: LabelActor }): NamedLabel {
    return transaction(this.db, () => {
      const name = savedName(label.name, 'A label')
      this.refuseNameTaken(name, null)
      const color =
        label.color === undefined ? randomLabelColor(this.random) : savedColor(label.color)
      const description = savedDescription(label.description ?? '')
      const groupId = label.groupId ?? null
      if (groupId !== null) this.refuseWorkflowGroup(this.groupRow(groupId))
      const { lastInsertRowid } = this.statements.insertLabel.run(
        name,
        nameKey(name),
        color,
        description,
        groupId,
      )
      const id = Number(lastInsertRowid)
      this.changedNow = true
      if (given) this.changeIssueLabels(given.issueId, { add: [id] }, given.actor)
      return this.label(id)!
    })
  }

  /**
   * Changes a label's name, color, description and group. Refused for a
   * label of a workflow's group, a name another label has, a color that is
   * not one, a workflow's group, and a group that an issue carrying the label
   * carries another label of.
   */
  editLabel(id: number, changes: LabelChanges): NamedLabel {
    return transaction(this.db, () => {
      const row = this.labelRow(id)
      this.refuseWorkflowLabel(row)
      const name = changes.name === undefined ? row.name : savedName(changes.name, 'A label')
      if (nameKey(name) !== nameKey(row.name)) this.refuseNameTaken(name, id)
      const color = changes.color === undefined ? row.color : savedColor(changes.color)
      const description =
        changes.description === undefined ? row.description : savedDescription(changes.description)
      const groupId = changes.groupId === undefined ? row.group_id : changes.groupId
      if (groupId !== null && groupId !== row.group_id) {
        const group = this.groupRow(groupId)
        this.refuseWorkflowGroup(group)
        this.refuseTwoOfGroup(row, name, group)
      }
      this.statements.updateLabel.run(name, nameKey(name), color, description, groupId, id)
      this.changedNow = true
      return this.label(id)!
    })
  }

  /**
   * Deletes a label, which every issue carrying it no longer does, those of
   * removed projects included; their activity gets no entry for it.
   * Refused for a label of a workflow's group.
   */
  deleteLabel(id: number): void {
    transaction(this.db, () => {
      const row = this.labelRow(id)
      this.refuseWorkflowLabel(row)
      this.statements.deleteLabel.run(id)
      this.changedNow = true
    })
  }

  /**
   * Gives an issue labels, in order, and takes others off it, as `actor`
   * does: a label of a group takes off the issue the other label of that
   * group it carries. A label it carries already, or one it does not carry,
   * changes nothing. Each label given and taken off gets an entry in the
   * issue's activity. Refused for an issue or a label there is not, and a
   * label both given and taken off.
   */
  changeIssueLabels(
    issueId: number,
    { add = [], remove = [] }: IssueLabelChange,
    actor: LabelActor,
  ) {
    transaction(this.db, () => {
      if (this.statements.issue.get(issueId) === undefined) {
        throw new LabelError('The issue no longer exists.')
      }
      const rows = new Map<number, LabelRow>()
      for (const id of [...add, ...remove]) rows.set(id, this.labelRow(id))
      for (const id of remove) {
        if (add.includes(id)) {
          const row = rows.get(id)!
          throw new LabelError(
            `${this.written(row)} cannot both be given to ${issueIdentifier(issueId)} and taken off it.`,
          )
        }
      }
      const carried = new Set(this.carriedBy(issueId))
      const at = this.now()
      const takeOff = (row: LabelRow) => {
        this.statements.uncarry.run(issueId, row.id)
        carried.delete(row.id)
        this.record(issueId, 'removed', row, actor, at)
      }
      for (const id of remove) {
        if (carried.has(id)) takeOff(rows.get(id)!)
      }
      for (const id of add) {
        if (carried.has(id)) continue
        const row = rows.get(id)!
        if (row.group_id !== null) {
          for (const other of carried) {
            const otherRow = this.labelRow(other)
            if (otherRow.group_id === row.group_id) takeOff(otherRow)
          }
        }
        this.statements.carry.run(issueId, id)
        carried.add(id)
        this.record(issueId, 'added', row, actor, at)
      }
    })
  }

  /**
   * Puts a workflow's group and its labels in place, as the workflow gives
   * them: creates them when they are missing, and gives them the name,
   * colors and descriptions the workflow has. Any other label the group has,
   * one the workflow no longer has, leaves it: it becomes a label without a
   * group, which the issues carrying it still carry, and which can be changed
   * and deleted like any other. Returns the group's id and each label's id,
   * by the label's name as the workflow writes it.
   */
  ensureWorkflowGroup(
    workflow: string,
    groupName: string,
    labels: readonly WorkflowLabel[],
  ): { groupId: number; labelIds: Map<string, number> } {
    return transaction(this.db, () => {
      let group =
        (this.statements.groupOfWorkflow.get(workflow) as GroupRow | undefined) ??
        (this.statements.groupByKey.get(nameKey(groupName)) as GroupRow | undefined)
      if (group === undefined) {
        const { lastInsertRowid } = this.statements.insertGroup.run(
          groupName,
          nameKey(groupName),
          workflow,
        )
        group = { id: Number(lastInsertRowid), name: groupName, workflow }
        this.changedNow = true
      } else if (group.name !== groupName || group.workflow !== workflow) {
        this.statements.updateGroup.run(groupName, nameKey(groupName), workflow, group.id)
        this.changedNow = true
      }
      const labelIds = new Map<string, number>()
      for (const label of labels) {
        const row = this.statements.labelByKey.get(nameKey(label.name)) as LabelRow | undefined
        if (row === undefined) {
          const { lastInsertRowid } = this.statements.insertLabel.run(
            label.name,
            nameKey(label.name),
            label.color,
            label.description,
            group.id,
          )
          labelIds.set(label.name, Number(lastInsertRowid))
          this.changedNow = true
          continue
        }
        labelIds.set(label.name, row.id)
        if (
          row.name !== label.name ||
          row.color !== label.color ||
          row.description !== label.description ||
          row.group_id !== group.id
        ) {
          this.statements.updateLabel.run(
            label.name,
            nameKey(label.name),
            label.color,
            label.description,
            group.id,
            row.id,
          )
          this.changedNow = true
        }
      }
      const others = this.statements.ungroupOthers.run(
        group.id,
        JSON.stringify([...labelIds.values()]),
      )
      if (others.changes > 0) this.changedNow = true
      return { groupId: group.id, labelIds }
    })
  }

  private groups(): LabelGroup[] {
    return (this.statements.groups.all() as unknown as GroupRow[]).map((row) => ({ ...row }))
  }

  private carriedBy(issueId: number): number[] {
    return (
      this.statements.labelsOfIssue.all(issueId) as unknown as Array<{ label_id: number }>
    ).map((row) => row.label_id)
  }

  private named(row: LabelRow): NamedLabel {
    const group = row.group_id === null ? undefined : this.groupRowIfAny(row.group_id)
    return { ...labelFromRow(row), group: group?.name ?? null }
  }

  /** How a label is written now, such as `Kind › Feature`. */
  private written(row: LabelRow): string {
    return labelText(row.name, this.named(row).group)
  }

  private labelRow(id: number): LabelRow {
    const row = this.statements.label.get(id) as LabelRow | undefined
    if (row === undefined) throw new LabelError('The label no longer exists.')
    return row
  }

  private groupRowIfAny(id: number): GroupRow | undefined {
    return this.statements.group.get(id) as GroupRow | undefined
  }

  private groupRow(id: number): GroupRow {
    const row = this.groupRowIfAny(id)
    if (row === undefined) throw new LabelError('The group no longer exists.')
    return row
  }

  private refuseNameTaken(name: string, except: number | null): void {
    const existing = this.statements.labelByKey.get(nameKey(name)) as LabelRow | undefined
    if (existing && existing.id !== except) {
      throw new LabelError(
        `There is a label named "${this.written(existing)}" already: no two labels can have the same name.`,
      )
    }
  }

  private refuseWorkflowGroup(group: GroupRow): void {
    if (group.workflow !== null) {
      throw new LabelError(
        `The group ${group.name} belongs to the workflow ${group.workflow}, which alone changes it and its labels.`,
      )
    }
  }

  private refuseWorkflowLabel(row: LabelRow): void {
    const group = row.group_id === null ? undefined : this.groupRowIfAny(row.group_id)
    if (group !== undefined && group.workflow !== null) {
      throw new LabelError(
        `${this.written(row)} belongs to the workflow ${group.workflow}: it can only be given to issues and taken off them.`,
      )
    }
  }

  /**
   * Refuses to move a label into a group when an issue carrying it carries
   * another label of that group, naming the first such issue and the labels.
   */
  private refuseTwoOfGroup(row: LabelRow, name: string, group: GroupRow): void {
    const members = new Map(
      (this.statements.labels.all() as unknown as LabelRow[])
        .filter((label) => label.group_id === group.id)
        .map((label) => [label.id, label]),
    )
    for (const { issue_id: issueId } of this.statements.carriers.all(row.id) as unknown as Array<{
      issue_id: number
    }>) {
      const other = this.carriedBy(issueId)
        .map((id) => members.get(id))
        .find((label) => label !== undefined)
      if (other === undefined) continue
      const issue =
        this.statements.shownIssue.get(issueId) === undefined
          ? UNSHOWN_ISSUE
          : issueIdentifier(issueId)
      throw new LabelError(
        `${name} cannot be moved into ${group.name}: ${issue} carries it and ` +
          `${labelText(other.name, group.name)}, and an issue carries at most one label of a group.`,
      )
    }
  }

  private record(
    issueId: number,
    kind: LabelEvent['kind'],
    row: LabelRow,
    actor: LabelActor,
    at: number,
  ): void {
    const { lastInsertRowid } = this.statements.insertEvent.run(
      issueId,
      kind,
      this.written(row),
      row.color,
      actor,
      at,
    )
    this.changedNow = true
    const event = this.statements.event.get(Number(lastInsertRowid)) as unknown as EventRow
    this.eventsNow.push(eventFromRow(event))
  }
}

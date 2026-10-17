/**
 * Labels, as in Linear: marks that any issue can carry, whatever project it
 * is in, each with a name, a color and a description, and in at most one
 * group. An issue carries at most one label of a group. The labels of a
 * workflow's group mark how far an issue has come through the workflow.
 */

/** A label that issues can carry. */
export interface Label {
  id: number
  /** No other label has the same name, compared without regard to case. */
  name: string
  /** Six hexadecimal digits in lower case, without `#`, such as `ff8800`. */
  color: string
  /** May be empty. */
  description: string
  /** The group it is in, or `null` for none. */
  groupId: number | null
}

/** A group of labels, of which an issue carries at most one. Groups are not put in groups. */
export interface LabelGroup {
  id: number
  /** No other group has the same name, compared without regard to case. */
  name: string
  /**
   * The name of the workflow whose group it is, which alone changes it and
   * its labels; `null` for a group of the user's own.
   */
  workflow: string | null
}

/** That an issue carries a label. */
export interface IssueLabel {
  issueId: number
  labelId: number
}

/**
 * Every label and group, and the labels of every issue, those of removed
 * projects included. `version` grows with every change, so that the latest
 * one known wins.
 */
export interface Labels {
  version: number
  groups: LabelGroup[]
  labels: Label[]
  issueLabels: IssueLabel[]
}

/** Who changed the labels of an issue: the user, in Hoot's window, or an agent, with hoot. */
export type LabelActor = 'user' | 'agent'

/** A label that an issue was given, or that was taken off it. */
export interface LabelEvent {
  id: number
  issueId: number
  kind: 'added' | 'removed'
  /** The label as it was written then, such as `Kind › Feature`. */
  label: string
  /** Its color then. */
  color: string
  actor: LabelActor
  /** In milliseconds since the Unix epoch. */
  at: number
}

/** What goes between a group's name and the name of one of its labels. */
export const GROUP_SEPARATOR = ' › '

/** How a label is written: its name, after its group's name when it is in one. */
export function labelText(name: string, group: string | null): string {
  return group === null ? name : `${group}${GROUP_SEPARATOR}${name}`
}

/** The key two names compare by: names are the same when they are the same without regard to case. */
export function nameKey(name: string): string {
  return name.toLowerCase()
}

/** Whether two names are the same, without regard to case. */
export function sameName(a: string, b: string): boolean {
  return nameKey(a) === nameKey(b)
}

/** The longest name of a label or a group, and the longest description, in UTF-16 code units. */
export const LABEL_NAME_MAX_LENGTH = 255
export const LABEL_DESCRIPTION_MAX_LENGTH = 10_000

/** A name as Hoot saves it: on one line, without the whitespace around it. */
export function labelName(entered: string): string {
  return entered.replace(/\r\n?|\n/g, ' ').trim()
}

/** Whether text is a label's color: six hexadecimal digits, without `#`. */
export function isLabelColor(text: string): boolean {
  return /^[0-9a-f]{6}$/i.test(text)
}

/**
 * The colors Hoot offers for labels, and picks one of for a label created
 * without one, as Linear's label colors.
 */
export const LABEL_COLORS: readonly string[] = [
  '95a2b3',
  '5e6ad2',
  '26b5ce',
  '4cb782',
  'f2c94c',
  'f2994a',
  'f7c8c1',
  'eb5757',
  'bb87fc',
  '4ea7fc',
  '6b6f76',
  'a0d468',
]

/** A color of `LABEL_COLORS`, picked at random. */
export function randomLabelColor(random: () => number = Math.random): string {
  return LABEL_COLORS[Math.floor(random() * LABEL_COLORS.length) % LABEL_COLORS.length]!
}

/** A label with the name of its group, if any. */
export interface NamedLabel extends Label {
  group: string | null
}

/** Every label with its group's name. */
export function namedLabels(labels: Pick<Labels, 'groups' | 'labels'>): NamedLabel[] {
  const groups = new Map(labels.groups.map((group) => [group.id, group.name]))
  return labels.labels.map((label) => ({
    ...label,
    group: label.groupId === null ? null : (groups.get(label.groupId) ?? null),
  }))
}

/** The order of names: without regard to case, then with it. */
export function byName(a: { name: string }, b: { name: string }): number {
  return (
    a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) ||
    a.name.localeCompare(b.name, 'en')
  )
}

/**
 * The labels in the order Hoot lists them: those without a group and the
 * groups by name, without regard to case, and the labels of a group, in the
 * order they were created, where the group's name comes.
 */
export function labelOrder(labels: Pick<Labels, 'groups' | 'labels'>): NamedLabel[] {
  const named = namedLabels(labels)
  const entries: Array<{ name: string; labels: NamedLabel[] }> = [
    ...named
      .filter((label) => label.groupId === null)
      .map((label) => ({ name: label.name, labels: [label] })),
    ...labels.groups.map((group) => ({
      name: group.name,
      labels: named.filter((label) => label.groupId === group.id).toSorted((a, b) => a.id - b.id),
    })),
  ]
  return entries.toSorted(byName).flatMap((entry) => entry.labels)
}

/** The labels an issue carries, in the order Hoot lists labels. */
export function labelsOfIssue(
  labels: Pick<Labels, 'groups' | 'labels' | 'issueLabels'>,
  issueId: number,
): NamedLabel[] {
  const carried = new Set(
    labels.issueLabels.filter((entry) => entry.issueId === issueId).map((entry) => entry.labelId),
  )
  return labelOrder(labels).filter((label) => carried.has(label.id))
}

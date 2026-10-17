import { describe, expect, it } from 'vitest'
import {
  isLabelColor,
  LABEL_COLORS,
  labelName,
  labelOrder,
  labelsOfIssue,
  labelText,
  randomLabelColor,
  sameName,
  type Labels,
} from './labels'

const labels: Labels = {
  version: 1,
  groups: [
    { id: 1, name: 'Spec-driven', workflow: 'Spec-driven' },
    { id: 2, name: 'kind', workflow: null },
  ],
  labels: [
    { id: 1, name: 'Scope', color: '4ea7fc', description: '', groupId: 1 },
    { id: 2, name: 'Design', color: 'bb87fc', description: '', groupId: 1 },
    { id: 3, name: 'ui', color: 'f2c94c', description: 'The interface', groupId: null },
    { id: 4, name: 'Bug', color: 'eb5757', description: '', groupId: 2 },
    { id: 5, name: 'Area', color: '95a2b3', description: '', groupId: null },
  ],
  issueLabels: [
    { issueId: 7, labelId: 3 },
    { issueId: 7, labelId: 2 },
    { issueId: 8, labelId: 5 },
  ],
}

describe('labels', () => {
  it('are written by their name, after the name of their group', () => {
    expect(labelText('Design', 'Spec-driven')).toBe('Spec-driven › Design')
    expect(labelText('ui', null)).toBe('ui')
  })

  it('have the same name without regard to case', () => {
    expect(sameName('Feature', 'feature')).toBe(true)
    expect(sameName('Feature', 'Features')).toBe(false)
  })

  it('are saved by a name on one line, without the whitespace around it', () => {
    expect(labelName('  bug \n fix ')).toBe('bug   fix')
  })

  it('have colors of six hexadecimal digits', () => {
    expect(isLabelColor('ff8800')).toBe(true)
    expect(isLabelColor('FF8800')).toBe(true)
    for (const color of ['red', '#ff8800', 'ff880', 'ff88000', 'gg8800']) {
      expect(isLabelColor(color)).toBe(false)
    }
    for (const color of LABEL_COLORS) expect(isLabelColor(color)).toBe(true)
    expect(LABEL_COLORS).toContain(randomLabelColor(() => 0.5))
    expect(randomLabelColor(() => 0.999)).toBe(LABEL_COLORS.at(-1))
  })

  it('are listed by name with the groups, the labels of a group in the order they were created', () => {
    expect(labelOrder(labels).map((label) => labelText(label.name, label.group))).toEqual([
      'Area',
      'kind › Bug',
      'Spec-driven › Scope',
      'Spec-driven › Design',
      'ui',
    ])
  })

  it('of an issue are listed in that order', () => {
    expect(labelsOfIssue(labels, 7).map((label) => label.name)).toEqual(['Design', 'ui'])
    expect(labelsOfIssue(labels, 9)).toEqual([])
  })
})

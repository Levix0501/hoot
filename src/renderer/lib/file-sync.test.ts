import { describe, expect, it } from 'vitest'
import { applyReplacement, diskChange, positionAt, textReplacement } from './file-sync'

describe('diskChange', () => {
  it('leaves alone a file that holds what was last read or saved', () => {
    expect(diskChange({ base: 'a', local: 'a' }, 'a')).toBe('unchanged')
    expect(diskChange({ base: 'a', local: 'mine' }, 'a')).toBe('unchanged')
  })

  it('catches up with a file that holds what the editor holds', () => {
    expect(diskChange({ base: 'a', local: 'b' }, 'b')).toBe('caught-up')
  })

  it('reloads a file nothing was edited in', () => {
    expect(diskChange({ base: 'a', local: 'a' }, 'agent')).toBe('reload')
  })

  it('has the user pick when both changed', () => {
    expect(diskChange({ base: 'a', local: 'mine' }, 'agent')).toBe('conflict')
  })
})

describe('positionAt', () => {
  it('counts every kind of line break once', () => {
    expect(positionAt('ab\ncd', 4)).toEqual({ line: 1, character: 1 })
    expect(positionAt('ab\r\ncd', 5)).toEqual({ line: 1, character: 1 })
    expect(positionAt('ab\rcd', 4)).toEqual({ line: 1, character: 1 })
    expect(positionAt('ab', 0)).toEqual({ line: 0, character: 0 })
  })
})

describe('textReplacement', () => {
  const cases: Array<[string, string, string]> = [
    ['nothing in common', 'abc', 'xyz'],
    ['a changed middle', 'one\ntwo\nthree\n', 'one\nTWO\nthree\n'],
    ['an insertion', 'one\nthree\n', 'one\ntwo\nthree\n'],
    ['a deletion', 'one\ntwo\nthree\n', 'one\nthree\n'],
    ['a change at the end', 'one\ntwo', 'one\ntwo\n'],
    ['a change at the start', 'two', 'one two'],
    ['Windows line breaks', 'a\r\nb\r\nc', 'a\r\nB\r\nc'],
    ['a line break turned into Windows one', 'a\nb', 'a\r\nb'],
    ['emoji', 'a😀b', 'a😃b'],
    ['repeated text', 'aaaa', 'aaaaaa'],
    ['everything removed', 'abc', ''],
    ['everything added', '', 'abc'],
  ]
  for (const [name, from, to] of cases) {
    it(`turns one text into the other: ${name}`, () => {
      const replacement = textReplacement(from, to)
      expect(replacement).not.toBeNull()
      expect(applyReplacement(from, replacement!)).toBe(to)
    })
  }

  it('changes only what lies between the common start and end', () => {
    expect(textReplacement('one\ntwo\nthree\n', 'one\nTWO\nthree\n')).toEqual({
      range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } },
      newText: 'TWO',
    })
  })

  it('never splits a Windows line break or a character of two code units', () => {
    const lineBreak = textReplacement('a\r\nb', 'a\r\r\nb')!
    expect(lineBreak.range.start).toEqual({ line: 0, character: 1 })
    const emoji = textReplacement('😀', '😃')!
    expect(emoji).toEqual({
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } },
      newText: '😃',
    })
  })

  it('gives nothing for the same text', () => {
    expect(textReplacement('same', 'same')).toBeNull()
  })
})

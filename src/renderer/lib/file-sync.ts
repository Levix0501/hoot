/**
 * How an open file's text in the file panel and the file on disk are kept
 * together: what to do when the file on disk changes, and the edit that
 * brings the editor's text to the file's new text.
 */

/** What the panel knows of an open text file. */
export interface FileTexts {
  /** What the file held when the panel last read or saved it. */
  base: string
  /** What the editor holds, which differs from `base` while edits are unsaved. */
  local: string
}

/**
 * What a change to the file on disk, which now holds `disk`, comes to:
 * - `unchanged`: the file holds what it held when last read or saved.
 * - `caught-up`: the file holds what the editor holds, whoever wrote it.
 * - `reload`: nothing was edited, so the editor takes the file's new text.
 * - `conflict`: both changed; the user picks which to keep.
 */
export type DiskChange = 'unchanged' | 'caught-up' | 'reload' | 'conflict'

export function diskChange(texts: FileTexts, disk: string): DiskChange {
  if (disk === texts.base) return 'unchanged'
  if (disk === texts.local) return 'caught-up'
  if (texts.local === texts.base) return 'reload'
  return 'conflict'
}

/** A place in a text: a line and a character in it, both from zero, in UTF-16 code units. */
export interface TextPosition {
  line: number
  character: number
}

/** One replacement that turns a text into another. */
export interface TextReplacement {
  range: { start: TextPosition; end: TextPosition }
  newText: string
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

/**
 * Whether `offset` falls inside a character of `text` that takes two code
 * units: a `\r\n` line break, or a character outside the Basic Multilingual
 * Plane, such as an emoji.
 */
function splitsCharacter(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) return false
  const before = text.charCodeAt(offset - 1)
  return (before === 13 && text.charCodeAt(offset) === 10) || isHighSurrogate(before)
}

/** The position of `offset` in `text`, a line break being `\n`, `\r\n` or `\r`. */
export function positionAt(text: string, offset: number): TextPosition {
  let line = 0
  let lineStart = 0
  for (let index = 0; index < offset; index++) {
    const code = text.charCodeAt(index)
    // A `\r` before a `\n` is one line break with it, counted at the `\n`.
    if (code === 10 || (code === 13 && text.charCodeAt(index + 1) !== 10)) {
      line++
      lineStart = index + 1
    }
  }
  return { line, character: offset - lineStart }
}

/**
 * The replacement that turns `from` into `to` by changing only what lies
 * between their common start and their common end, so that a caret or
 * selection outside it stays where it is; `null` when they are the same. It
 * never splits a `\r\n` or a character of two code units.
 */
export function textReplacement(from: string, to: string): TextReplacement | null {
  if (from === to) return null
  const shorter = Math.min(from.length, to.length)
  let start = 0
  while (start < shorter && from.charCodeAt(start) === to.charCodeAt(start)) start++
  while (splitsCharacter(from, start) || splitsCharacter(to, start)) start--
  let end = 0
  while (
    end < shorter - start &&
    from.charCodeAt(from.length - 1 - end) === to.charCodeAt(to.length - 1 - end)
  ) {
    end++
  }
  while (
    end > 0 &&
    (splitsCharacter(from, from.length - end) || splitsCharacter(to, to.length - end))
  ) {
    end--
  }
  return {
    range: { start: positionAt(from, start), end: positionAt(from, from.length - end) },
    newText: to.slice(start, to.length - end),
  }
}

/**
 * `text` with a replacement applied, the way an editor applies it: for
 * checking what {@link textReplacement} gives.
 */
export function applyReplacement(text: string, replacement: TextReplacement): string {
  const offsetOf = ({ line, character }: TextPosition) => {
    let offset = 0
    for (let current = 0; current < line; current++) {
      const next = /\r\n|\r|\n/g
      next.lastIndex = offset
      const found = next.exec(text)
      if (found === null) return text.length
      offset = found.index + found[0].length
    }
    return offset + character
  }
  const { start, end } = replacement.range
  return text.slice(0, offsetOf(start)) + replacement.newText + text.slice(offsetOf(end))
}

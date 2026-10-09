import { describe, expect, it } from 'vitest'
import { createUnicodeProvider, isWideCharacter } from './unicode-widths'

const hex = (codePoint: number) => `U+${codePoint.toString(16).toUpperCase()}`

describe('isWideCharacter', () => {
  it('is true for East Asian Wide or Fullwidth characters and Emoji_Presentation characters', () => {
    // 中, Ａ (fullwidth), 😀, 🫠 (Unicode 14), 🫨 (Unicode 15), a regional indicator.
    const wide = [0x4e2d, 0xff21, 0x1f600, 0x1fae0, 0x1fae8, 0x1f1e8]
    expect(wide.filter((codePoint) => !isWideCharacter(codePoint)).map(hex)).toEqual([])
    // A, é, ❤ (text presentation), ⏺, ｱ (halfwidth), ─.
    const narrow = [0x41, 0xe9, 0x2764, 0x23fa, 0xff71, 0x2500]
    expect(narrow.filter((codePoint) => isWideCharacter(codePoint)).map(hex)).toEqual([])
  })
})

describe('createUnicodeProvider', () => {
  it('gives wide characters two cells, including emoji added after Unicode 13', () => {
    const provider = createUnicodeProvider()
    const wide = [0x4e2d, 0x1f600, 0x1f972, 0x1f979, 0x1fae0, 0x1fae8, 0x1fae9]
    expect(wide.map((codePoint) => [hex(codePoint), provider.wcwidth(codePoint)])).toEqual(
      wide.map((codePoint) => [hex(codePoint), 2]),
    )
    expect(provider.wcwidth(0x41)).toBe(1)
    expect(provider.wcwidth(0x2500)).toBe(1)
    // A combining mark adds no cell of its own.
    expect(provider.wcwidth(0x301)).toBe(0)
  })
})

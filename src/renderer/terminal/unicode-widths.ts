import { UnicodeGraphemesAddon } from '@xterm/addon-unicode-graphemes'
import type { IUnicodeVersionProvider, Terminal } from '@xterm/xterm'
import { eastAsianWidthType } from 'get-east-asian-width'

/** The Unicode version name the terminal uses for character widths. */
export const UNICODE_VERSION = 'current'

// Code points below this are never wide (it is the first East Asian Wide code point).
const FIRST_WIDE_CODE_POINT = 0x1100
// `charProperties` results keep the cell width in bits 1 and 2.
const WIDTH_MASK = 0b110
const WIDE = 2 << 1

const emojiPresentation = /^\p{Emoji_Presentation}$/u
const wideCodePoints = new Map<number, boolean>()

/**
 * Whether a code point is a wide character in the current Unicode data: East
 * Asian Width W or F, or Emoji_Presentation.
 */
export function isWideCharacter(codePoint: number): boolean {
  if (codePoint < FIRST_WIDE_CODE_POINT) return false
  let wide = wideCodePoints.get(codePoint)
  if (wide === undefined) {
    const type = eastAsianWidthType(codePoint)
    wide =
      type === 'wide' ||
      type === 'fullwidth' ||
      emojiPresentation.test(String.fromCodePoint(codePoint))
    wideCodePoints.set(codePoint, wide)
  }
  return wide
}

/**
 * The xterm.js grapheme-aware provider with its widths brought up to date: its
 * tables lack the wide characters added after Unicode 13 (such as most newer
 * emoji), which would otherwise take one cell instead of two.
 */
class CurrentUnicodeProvider implements IUnicodeVersionProvider {
  readonly version = UNICODE_VERSION

  constructor(private readonly base: IUnicodeVersionProvider) {}

  wcwidth(codePoint: number): 0 | 1 | 2 {
    const width = this.base.wcwidth(codePoint)
    return width === 1 && isWideCharacter(codePoint) ? 2 : width
  }

  charProperties(codePoint: number, preceding: number): number {
    const properties = this.base.charProperties(codePoint, preceding)
    if ((properties & WIDTH_MASK) >> 1 !== 1 || !isWideCharacter(codePoint)) return properties
    return (properties & ~WIDTH_MASK) | WIDE
  }
}

/** Creates the provider; the official addon keeps its provider private, so it is captured here. */
export function createUnicodeProvider(): IUnicodeVersionProvider {
  const registered = new Map<string, IUnicodeVersionProvider>()
  const capture = {
    unicode: {
      register: (provider: IUnicodeVersionProvider) => registered.set(provider.version, provider),
      activeVersion: '',
    },
  }
  new UnicodeGraphemesAddon().activate(capture as unknown as Terminal)
  const base = registered.get('15-graphemes')
  if (!base) throw new Error('The Unicode graphemes addon did not provide its provider.')
  return new CurrentUnicodeProvider(base)
}

/** Makes the terminal use current Unicode widths. */
export function applyCurrentUnicodeWidths(terminal: Terminal): void {
  terminal.unicode.register(createUnicodeProvider())
  terminal.unicode.activeVersion = UNICODE_VERSION
}

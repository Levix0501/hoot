import { describe, expect, it } from 'vitest'
import { clipboardKeyAction } from './clipboard-keys'

const C = 67
const V = 86
const INSERT = 45

function press(
  keyCode: number,
  modifiers: { shift?: boolean; alt?: boolean; meta?: boolean } = {},
) {
  return {
    keyCode,
    ctrlKey: true,
    shiftKey: modifiers.shift ?? false,
    altKey: modifiers.alt ?? false,
    metaKey: modifiers.meta ?? false,
  }
}

describe('clipboardKeyAction', () => {
  it('copies the selection with Ctrl+C, Ctrl+Shift+C and Ctrl+Insert', () => {
    expect(clipboardKeyAction(press(C), true)).toBe('copy')
    expect(clipboardKeyAction(press(C, { shift: true }), true)).toBe('copy')
    expect(clipboardKeyAction(press(INSERT), true)).toBe('copy')
  })

  it('leaves Ctrl+C to the program when nothing is selected', () => {
    expect(clipboardKeyAction(press(C), false)).toBeNull()
    expect(clipboardKeyAction(press(C, { shift: true }), false)).toBeNull()
    expect(clipboardKeyAction(press(INSERT), false)).toBeNull()
  })

  it('pastes with Ctrl+V, selection or not', () => {
    expect(clipboardKeyAction(press(V), false)).toBe('paste')
    expect(clipboardKeyAction(press(V), true)).toBe('paste')
  })

  it("leaves Ctrl+Shift+V and Shift+Insert to Chromium's own paste", () => {
    expect(clipboardKeyAction(press(V, { shift: true }), false)).toBeNull()
    expect(
      clipboardKeyAction({ ...press(INSERT), ctrlKey: false, shiftKey: true }, false),
    ).toBeNull()
  })

  it('leaves the keys alone without Ctrl, or with Alt (AltGr) or the Windows key', () => {
    expect(clipboardKeyAction({ ...press(C), ctrlKey: false }, true)).toBeNull()
    expect(clipboardKeyAction({ ...press(V), ctrlKey: false }, false)).toBeNull()
    expect(clipboardKeyAction(press(C, { alt: true }), true)).toBeNull()
    expect(clipboardKeyAction(press(V, { alt: true }), false)).toBeNull()
    expect(clipboardKeyAction(press(V, { meta: true }), false)).toBeNull()
  })

  it('leaves other Ctrl keys to the program', () => {
    expect(clipboardKeyAction(press(65), true)).toBeNull()
    expect(clipboardKeyAction(press(INSERT, { shift: true }), true)).toBeNull()
  })
})

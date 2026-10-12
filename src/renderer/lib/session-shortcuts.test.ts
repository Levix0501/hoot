import { describe, expect, it } from 'vitest'
import { sessionShortcut } from './session-shortcuts'

const press = (key: string, code: string, modifiers: { shift?: boolean; ctrl?: boolean } = {}) =>
  sessionShortcut({
    key,
    code,
    metaKey: true,
    shiftKey: modifiers.shift ?? false,
    ctrlKey: modifiers.ctrl ?? false,
    altKey: false,
    isComposing: false,
  })

describe('sessionShortcut', () => {
  it('selects the session at the place of the digit', () => {
    expect(press('1', 'Digit1')).toEqual({ kind: 'select', index: 0 })
    expect(press('9', 'Digit9')).toEqual({ kind: 'select', index: 8 })
    // A layout where the number row types other characters.
    expect(press('&', 'Digit1')).toEqual({ kind: 'select', index: 0 })
    expect(press('0', 'Digit0')).toBeNull()
  })

  it('selects the next and previous session with Shift and the brackets', () => {
    expect(press('}', 'BracketRight', { shift: true })).toEqual({ kind: 'next' })
    expect(press('{', 'BracketLeft', { shift: true })).toEqual({ kind: 'previous' })
  })

  it('goes back and forward with the brackets alone', () => {
    expect(press('[', 'BracketLeft')).toEqual({ kind: 'back' })
    expect(press(']', 'BracketRight')).toEqual({ kind: 'forward' })
    expect(press('[', 'BracketLeft', { ctrl: true })).toBeNull()
  })

  it('closes the current session with W', () => {
    expect(press('w', 'KeyW')).toEqual({ kind: 'close' })
    expect(press('W', 'KeyW')).toEqual({ kind: 'close' })
    expect(press('W', 'KeyW', { shift: true })).toBeNull()
  })

  it('shows the settings with the comma', () => {
    expect(press(',', 'Comma')).toEqual({ kind: 'settings' })
    expect(press('<', 'Comma', { shift: true })).toBeNull()
    expect(press(',', 'Comma', { ctrl: true })).toBeNull()
  })

  it('ignores other keys and other modifiers', () => {
    expect(press('a', 'KeyA')).toBeNull()
    expect(press('1', 'Digit1', { ctrl: true })).toBeNull()
    expect(
      sessionShortcut({
        key: '1',
        code: 'Digit1',
        metaKey: false,
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        isComposing: false,
      }),
    ).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { issueShortcut, type IssuesPageKind } from './issue-shortcuts'

const press = (
  key: string,
  page: IssuesPageKind = 'list',
  modifiers: { meta?: boolean; shift?: boolean; ctrl?: boolean; alt?: boolean } = {},
  options: { repeat?: boolean; composing?: boolean } = {},
) =>
  issueShortcut(
    {
      key,
      metaKey: modifiers.meta ?? false,
      shiftKey: modifiers.shift ?? false,
      ctrlKey: modifiers.ctrl ?? false,
      altKey: modifiers.alt ?? false,
      isComposing: options.composing ?? false,
      repeat: options.repeat ?? false,
    },
    page,
  )

describe('issueShortcut', () => {
  it('creates an issue, and changes the status and the priority, with C, S and P', () => {
    for (const page of ['list', 'issue'] as const) {
      expect(press('c', page)).toEqual({ kind: 'new-issue' })
      expect(press('s', page)).toEqual({ kind: 'status' })
      expect(press('p', page)).toEqual({ kind: 'priority' })
    }
    // With Caps Lock on.
    expect(press('C')).toEqual({ kind: 'new-issue' })
  })

  it('moves with J and K everywhere, and with the arrows only on a list', () => {
    expect(press('j')).toEqual({ kind: 'move', offset: 1 })
    expect(press('k')).toEqual({ kind: 'move', offset: -1 })
    expect(press('ArrowDown')).toEqual({ kind: 'move', offset: 1 })
    expect(press('ArrowUp')).toEqual({ kind: 'move', offset: -1 })
    expect(press('j', 'issue')).toEqual({ kind: 'move', offset: 1 })
    expect(press('k', 'issue')).toEqual({ kind: 'move', offset: -1 })
    // An issue's page scrolls with them.
    expect(press('ArrowDown', 'issue')).toBeNull()
    expect(press('ArrowUp', 'issue')).toBeNull()
  })

  it('deletes with ⌘⌫, and goes back to the list with Esc on an issue’s page', () => {
    expect(press('Backspace', 'list', { meta: true })).toEqual({ kind: 'delete' })
    expect(press('Backspace', 'issue', { meta: true })).toEqual({ kind: 'delete' })
    expect(press('Backspace')).toBeNull()
    expect(press('Escape', 'issue')).toEqual({ kind: 'back-to-list' })
    expect(press('Escape', 'list')).toBeNull()
  })

  it('leaves keys with other modifiers, other keys, and keys typed while composing', () => {
    expect(press('c', 'list', { meta: true })).toBeNull()
    expect(press('c', 'list', { shift: true })).toBeNull()
    expect(press('c', 'list', { ctrl: true })).toBeNull()
    expect(press('c', 'list', { alt: true })).toBeNull()
    expect(press('Backspace', 'list', { meta: true, shift: true })).toBeNull()
    expect(press('x')).toBeNull()
    expect(press('Enter')).toBeNull()
    expect(press('c', 'list', {}, { composing: true })).toBeNull()
  })

  it('repeats only the moves while a key is held', () => {
    expect(press('j', 'list', {}, { repeat: true })).toEqual({ kind: 'move', offset: 1 })
    expect(press('ArrowUp', 'list', {}, { repeat: true })).toEqual({ kind: 'move', offset: -1 })
    expect(press('c', 'list', {}, { repeat: true })).toBeNull()
    expect(press('s', 'issue', {}, { repeat: true })).toBeNull()
    expect(press('Escape', 'issue', {}, { repeat: true })).toBeNull()
    expect(press('Backspace', 'list', { meta: true }, { repeat: true })).toBeNull()
  })
})

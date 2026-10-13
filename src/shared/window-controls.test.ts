import { describe, expect, it } from 'vitest'
import {
  windowControlsArgument,
  windowControlsFor,
  windowControlsFromArguments,
  type WindowControls,
} from './window-controls'

describe('windowControlsFor', () => {
  it('has Windows draw its buttons over the top row, with or without the switch', () => {
    expect(windowControlsFor('win32', false)).toBe('overlay')
    expect(windowControlsFor('win32', true)).toBe('overlay')
  })

  it('keeps the traffic lights on macOS, leaving the room of the buttons of Windows only with the switch', () => {
    expect(windowControlsFor('darwin', false)).toBe('traffic-lights')
    expect(windowControlsFor('darwin', true)).toBe('placeholder')
  })
})

describe('windowControlsFromArguments', () => {
  it('reads back what the argument passes on', () => {
    for (const controls of ['traffic-lights', 'overlay', 'placeholder'] as WindowControls[]) {
      expect(windowControlsFromArguments(['--foo', windowControlsArgument(controls)])).toBe(
        controls,
      )
    }
  })

  it("takes macOS's traffic lights without the argument or with a value it does not know", () => {
    expect(windowControlsFromArguments(['--hoot-test-hooks'])).toBe('traffic-lights')
    expect(windowControlsFromArguments(['--hoot-window-controls=menu'])).toBe('traffic-lights')
  })
})

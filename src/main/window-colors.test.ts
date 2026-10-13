import { describe, expect, it } from 'vitest'
import { titleBarOverlay, windowBackground } from './window-colors'

describe('window colors', () => {
  it('give the window the background of the page in each appearance', () => {
    expect(windowBackground(false)).toBe('#ffffff')
    expect(windowBackground(true)).toBe('#181818')
  })

  it('draw the buttons of Windows on that background, with symbols in the text color', () => {
    expect(titleBarOverlay(false)).toEqual({ color: '#ffffff', symbolColor: '#1a1c1f', height: 44 })
    expect(titleBarOverlay(true)).toEqual({ color: '#181818', symbolColor: '#ffffff', height: 44 })
  })
})

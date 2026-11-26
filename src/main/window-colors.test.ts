import { describe, expect, it } from 'vitest'
import { windowBackground } from './window-colors'

describe('window colors', () => {
  it('give the window the background of the page in each appearance', () => {
    expect(windowBackground(false)).toBe('#ffffff')
    expect(windowBackground(true)).toBe('#181818')
  })
})

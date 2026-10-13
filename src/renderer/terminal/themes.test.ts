import { describe, expect, it } from 'vitest'
import { ANSI_COLOR_KEYS, darkTheme, lightTheme, terminalTheme } from './themes'

const ansiColors = (scheme: 'dark' | 'light') =>
  ANSI_COLOR_KEYS.map((key) => terminalTheme(scheme)[key]?.toLowerCase())

describe('terminal themes', () => {
  it('uses Ghostty 1.3.1’s default 16 colors on the dark interface colors', () => {
    expect(darkTheme.background).toBe('#181818')
    expect(darkTheme.foreground).toBe('#ffffff')
    expect(ansiColors('dark')).toEqual([
      '#1d1f21',
      '#cc6666',
      '#b5bd68',
      '#f0c674',
      '#81a2be',
      '#b294bb',
      '#8abeb7',
      '#c5c8c6',
      '#666666',
      '#d54e53',
      '#b9ca4a',
      '#e7c547',
      '#7aa6da',
      '#c397d8',
      '#70c0b1',
      '#eaeaea',
    ])
  })

  it('uses Claude Light’s 16 colors on the light interface colors', () => {
    expect(lightTheme.background).toBe('#ffffff')
    expect(lightTheme.foreground).toBe('#1a1c1f')
    expect(ansiColors('light')).toEqual([
      '#0a0a0a',
      '#a84b3a',
      '#2e7c4c',
      '#8a6220',
      '#184e95',
      '#882b4d',
      '#066049',
      '#b6b5aa',
      '#51504d',
      '#e34a4a',
      '#639900',
      '#b87700',
      '#3886e5',
      '#d55382',
      '#199f70',
      '#e2e1da',
    ])
  })

  it.each([darkTheme, lightTheme])(
    'swaps the default colors for the cursor and the selection, and draws the slider in the foreground color',
    (theme) => {
      expect(theme.cursor).toBe(theme.foreground)
      expect(theme.cursorAccent).toBe(theme.background)
      expect(theme.selectionBackground).toBe(theme.foreground)
      expect(theme.selectionForeground).toBe(theme.background)
      for (const slider of [
        theme.scrollbarSliderBackground,
        theme.scrollbarSliderHoverBackground,
        theme.scrollbarSliderActiveBackground,
      ]) {
        expect(slider?.slice(0, 7)).toBe(theme.foreground)
        expect(slider?.slice(7)).not.toMatch(/^(00|ff)$/)
      }
      expect(theme.overviewRulerBorder).toMatch(/00$/)
    },
  )
})

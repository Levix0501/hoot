/** The family name of Geist Mono, which comes with Hoot (from @fontsource-variable/geist-mono). */
export const GEIST_MONO = 'Geist Mono Variable'

export const TERMINAL_FONT_SIZE = 14

/**
 * Geist Mono first. Characters it lacks come from Menlo and the other fonts
 * Hoot's terminal used before, from a Nerd Font symbol font when one is
 * installed (for the icons many prompts use), and otherwise from the system's
 * fallback fonts (Chinese, emoji and so on).
 */
export const TERMINAL_FONT_FAMILY = [
  `"${GEIST_MONO}"`,
  'Menlo',
  'Monaco',
  '"Courier New"',
  '"Symbols Nerd Font Mono"',
  '"JetBrainsMono Nerd Font Mono"',
  '"MesloLGS NF"',
  'monospace',
].join(', ')

/**
 * Loads every face of Geist Mono. Terminals measure their cells with it when
 * they open, and the WebGL renderer draws each character with the faces loaded
 * when the character first appears.
 */
export async function loadTerminalFont(): Promise<void> {
  const faces = Array.from(document.fonts).filter(
    (face) => face.family.replaceAll('"', '') === GEIST_MONO,
  )
  await Promise.allSettled(faces.map((face) => face.load()))
}

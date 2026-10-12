/**
 * The appearance picked on the Appearance page of the settings: macOS's
 * (`system`), or always light or always dark whatever macOS uses. They are
 * also the values of Electron's `nativeTheme.themeSource` that apply them.
 */
export const APPEARANCES = ['system', 'light', 'dark'] as const

export type Appearance = (typeof APPEARANCES)[number]

/** The appearance until another one is picked: macOS's. */
export const DEFAULT_APPEARANCE: Appearance = 'system'

export function isAppearance(value: unknown): value is Appearance {
  return typeof value === 'string' && (APPEARANCES as readonly string[]).includes(value)
}

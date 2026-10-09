import Color from 'colorjs.io'

/** Hue (0–360) and chroma of a CSS color, in OKLCH. */
function hueAndChroma(color: string): { hue: number; chroma: number } {
  const [, chroma, hue] = new Color(color).to('oklch').coords
  return { hue: hue ?? 0, chroma: chroma ?? 0 }
}

export function isGreen(color: string): boolean {
  const { hue, chroma } = hueAndChroma(color)
  return chroma > 0.05 && hue >= 120 && hue <= 180
}

export function isRed(color: string): boolean {
  const { hue, chroma } = hueAndChroma(color)
  return chroma > 0.05 && (hue <= 45 || hue >= 340)
}

/** Whether a CSS color paints nothing. */
export function isTransparent(color: string): boolean {
  return new Color(color).alpha === 0
}

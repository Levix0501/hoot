import Color from 'colorjs.io'
import { PNG } from 'pngjs'

/** 8-bit sRGB channels. */
export type Rgb = readonly [red: number, green: number, blue: number]

/** The 8-bit sRGB channels of any CSS color. */
export function rgb(color: string): Rgb {
  const [red, green, blue] = new Color(color)
    .to('srgb')
    .coords.map((value) => Math.round((value ?? 0) * 255))
  return [red!, green!, blue!]
}

/** The difference of two colors: the largest difference of their red, green and blue channels. */
export function colorDifference(a: Rgb, b: Rgb): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]))
}

export function sameColor(a: Rgb, b: Rgb): boolean {
  return colorDifference(a, b) === 0
}

/** Whether every channel of `color` lies between those of `a` and `b`. */
export function isBetween(color: Rgb, a: Rgb, b: Rgb): boolean {
  return color.every(
    (value, index) =>
      value >= Math.min(a[index]!, b[index]!) && value <= Math.max(a[index]!, b[index]!),
  )
}

/** A rectangle of physical pixels: left, top, width and height. */
export interface PixelRect {
  x: number
  y: number
  width: number
  height: number
}

/** Where a terminal's grid is in the window, in physical pixels. */
export interface GridPixels {
  /** The top-left pixel of the grid. */
  x: number
  y: number
  cellWidth: number
  cellHeight: number
  /** Physical pixels per CSS pixel. */
  scale: number
}

/** The physical pixels of a cell of the grid, its row counted from the top of the viewport. */
export function cellRect(grid: GridPixels, viewportRow: number, column: number): PixelRect {
  // Cells of the DOM renderer need not start at a whole pixel.
  const x = Math.round(grid.x + column * grid.cellWidth)
  const y = Math.round(grid.y + viewportRow * grid.cellHeight)
  return {
    x,
    y,
    width: Math.round(grid.x + (column + 1) * grid.cellWidth) - x,
    height: Math.round(grid.y + (viewportRow + 1) * grid.cellHeight) - y,
  }
}

/** A screenshot of the window in physical pixels. */
export class Screenshot {
  private readonly png: PNG

  constructor(image: Buffer) {
    this.png = PNG.sync.read(image)
  }

  get width(): number {
    return this.png.width
  }

  get height(): number {
    return this.png.height
  }

  /** The color of the physical pixel at `x`, `y`. */
  pixel(x: number, y: number): Rgb {
    if (!Number.isInteger(x) || !Number.isInteger(y)) throw new Error(`No pixel at ${x},${y}`)
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      throw new Error(`Pixel ${x},${y} is outside the ${this.width}×${this.height} screenshot`)
    }
    const offset = (y * this.width + x) * 4
    const data = this.png.data
    return [data[offset]!, data[offset + 1]!, data[offset + 2]!]
  }

  /** Every pixel of a rectangle, row by row, with its position. */
  *pixels(rect: PixelRect): Generator<{ x: number; y: number; color: Rgb }> {
    for (let y = rect.y; y < rect.y + rect.height; y++) {
      for (let x = rect.x; x < rect.x + rect.width; x++) {
        yield { x, y, color: this.pixel(x, y) }
      }
    }
  }

  /** The color at the middle of a rectangle. */
  middle(rect: PixelRect): Rgb {
    return this.pixel(rect.x + Math.floor(rect.width / 2), rect.y + Math.floor(rect.height / 2))
  }
}

/**
 * The parts of a cell that block elements fill, in eighths of the cell's
 * width and height: [left, top, right, bottom], from 0 to 8.
 */
type Eighths = readonly [left: number, top: number, right: number, bottom: number]

const UPPER_LEFT: Eighths = [0, 0, 4, 4]
const UPPER_RIGHT: Eighths = [4, 0, 8, 4]
const LOWER_LEFT: Eighths = [0, 4, 4, 8]
const LOWER_RIGHT: Eighths = [4, 4, 8, 8]

/** The parts each block element fills with its foreground color, after its Unicode glyph. */
export const BLOCK_FILLS: Readonly<Record<string, readonly Eighths[]>> = {
  '▀': [[0, 0, 8, 4]],
  '▁': [[0, 7, 8, 8]],
  '▂': [[0, 6, 8, 8]],
  '▃': [[0, 5, 8, 8]],
  '▄': [[0, 4, 8, 8]],
  '▅': [[0, 3, 8, 8]],
  '▆': [[0, 2, 8, 8]],
  '▇': [[0, 1, 8, 8]],
  '█': [[0, 0, 8, 8]],
  '▉': [[0, 0, 7, 8]],
  '▊': [[0, 0, 6, 8]],
  '▋': [[0, 0, 5, 8]],
  '▌': [[0, 0, 4, 8]],
  '▍': [[0, 0, 3, 8]],
  '▎': [[0, 0, 2, 8]],
  '▏': [[0, 0, 1, 8]],
  '▐': [[4, 0, 8, 8]],
  '▔': [[0, 0, 8, 1]],
  '▕': [[7, 0, 8, 8]],
  '▖': [LOWER_LEFT],
  '▗': [LOWER_RIGHT],
  '▘': [UPPER_LEFT],
  '▙': [UPPER_LEFT, LOWER_LEFT, LOWER_RIGHT],
  '▚': [UPPER_LEFT, LOWER_RIGHT],
  '▛': [UPPER_LEFT, UPPER_RIGHT, LOWER_LEFT],
  '▜': [UPPER_LEFT, UPPER_RIGHT, LOWER_RIGHT],
  '▝': [UPPER_RIGHT],
  '▞': [UPPER_RIGHT, LOWER_LEFT],
  '▟': [UPPER_RIGHT, LOWER_LEFT, LOWER_RIGHT],
}

/** U+2580–U+2590 and U+2594–U+259F: the block elements without the three shades. */
export const BLOCK_ELEMENTS = Object.keys(BLOCK_FILLS).join('')

/** Where a pixel lies relative to a block element's filled part. */
export type Placement = 'inside' | 'outside' | 'edge'

/**
 * Whether the physical pixel at `x`, `y` of a cell (counted from the cell's
 * top-left pixel) lies entirely inside the part `char` fills, entirely
 * outside it, or on its edge.
 */
export function blockPixelPlacement(
  char: string,
  x: number,
  y: number,
  cellWidth: number,
  cellHeight: number,
): Placement {
  const fills = BLOCK_FILLS[char]
  if (!fills) throw new Error(`${char} is not a block element`)
  // The eighths of the cell that the pixel's square overlaps.
  const overlapped = (start: number, size: number) => {
    const first = Math.floor((start * 8) / size)
    const last = Math.ceil(((start + 1) * 8) / size) - 1
    return { first, last }
  }
  const columns = overlapped(x, cellWidth)
  const rows = overlapped(y, cellHeight)
  let filled = 0
  let total = 0
  for (let row = rows.first; row <= rows.last; row++) {
    for (let column = columns.first; column <= columns.last; column++) {
      total++
      if (
        fills.some(
          ([left, top, right, bottom]) =>
            column >= left && column < right && row >= top && row < bottom,
        )
      ) {
        filled++
      }
    }
  }
  return filled === total ? 'inside' : filled === 0 ? 'outside' : 'edge'
}

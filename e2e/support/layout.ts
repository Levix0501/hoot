import Color from 'colorjs.io'
import type { Locator } from '@playwright/test'
import type { AppDriver } from './app'

/** The height of the window's top row, in CSS pixels. */
export const TOP_ROW_HEIGHT = 44

/** A rectangle of the window in CSS pixels. */
export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** Whether two CSS colors are the same color, alpha included. */
export function sameCssColor(a: string, b: string): boolean {
  const [first, second] = [new Color(a).to('srgb'), new Color(b).to('srgb')]
  return (
    first.coords.every(
      (value, index) => Math.abs((value ?? 0) - (second.coords[index] ?? 0)) < 0.5 / 255,
    ) && Math.abs(first.alpha - second.alpha) < 0.005
  )
}

/** Whether `a` and `b` differ by less than a physical pixel at the window's pixel ratio. */
export function nearly(a: number, b: number, scale: number): boolean {
  return Math.abs(a - b) < 1 / scale
}

/** An element as the page describes it, for deciding whether it draws anything. */
interface ElementReport {
  description: string
  box: Box
  ownText: string
  icon: boolean
  borders: Array<{ width: number; color: string }>
  background: string
  backgroundImage: string
  shadow: string
  /** The background colors of its ancestors, nearest first. */
  behind: string[]
  /** Inside, or itself, one of the navigation's buttons. */
  navigationButton: string | null
}

/** An element that draws something in the window. */
export interface DrawnElement {
  description: string
  box: Box
  /** The `data-testid` of the navigation button it is or is in, if any. */
  navigationButton: string | null
}

const isTransparent = (color: string) => new Color(color).alpha === 0

/**
 * Whether an element draws anything: text, an icon, a border, a shadow, or a
 * background unlike what is behind it.
 */
function draws(element: ElementReport, windowBackground: string): boolean {
  if (element.ownText !== '' || element.icon) return true
  if (element.borders.some((border) => border.width > 0 && !isTransparent(border.color))) {
    return true
  }
  if (element.shadow !== 'none' || element.backgroundImage !== 'none') return true
  if (isTransparent(element.background)) return false
  const behind = element.behind.find((background) => !isTransparent(background)) ?? windowBackground
  return !sameCssColor(element.background, behind)
}

/**
 * The elements that draw something in an area of the window, or only those
 * inside the element `inside` selects. The sidebar's own elements, which draw
 * its color and the line along its right edge, are the ground of the
 * sidebar's area and are left out, as are the descendants of icons and
 * visually hidden text.
 */
export async function drawnElements(
  app: AppDriver,
  area: Box,
  inside?: string,
): Promise<DrawnElement[]> {
  const { reports, windowBackground } = await app.page.evaluate(
    ([within, container]) => {
      const ground = new Set(['sidebar', 'sidebar-gap', 'sidebar-container', 'sidebar-inner'])
      const hidden = (element: Element) =>
        getComputedStyle(element).clip === 'rect(0px, 0px, 0px, 0px)' ||
        !element.checkVisibility({ opacityProperty: true, visibilityProperty: true })
      const found: ElementReport[] = []
      for (const element of Array.from(document.body.querySelectorAll('*'))) {
        if (container && !element.parentElement?.closest(container)) continue
        if (element.parentElement?.closest('svg')) continue
        if (ground.has(element.getAttribute('data-slot') ?? '')) continue
        let skipped = false
        for (let node: Element | null = element; node; node = node.parentElement) {
          if (hidden(node)) {
            skipped = true
            break
          }
        }
        if (skipped) continue
        const rect = element.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) continue
        if (
          rect.left >= within.right ||
          rect.right <= within.left ||
          rect.top >= within.bottom ||
          rect.bottom <= within.top
        ) {
          continue
        }
        const style = getComputedStyle(element)
        const behind: string[] = []
        for (let node = element.parentElement; node; node = node.parentElement) {
          behind.push(getComputedStyle(node).backgroundColor)
        }
        const button = element.closest('[data-testid="window-navigation"] button')
        found.push({
          description: `${element.tagName.toLowerCase()} ${element.getAttribute('data-slot') ?? ''} ${element.getAttribute('data-testid') ?? ''} ${(element.textContent ?? '').trim().slice(0, 30)}`,
          box: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
          ownText: Array.from(element.childNodes)
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent ?? '')
            .join('')
            .trim(),
          icon: element.tagName.toLowerCase() === 'svg',
          borders: (['top', 'right', 'bottom', 'left'] as const).map((side) => ({
            width: Number.parseFloat(style.getPropertyValue(`border-${side}-width`)),
            color: style.getPropertyValue(`border-${side}-color`),
          })),
          background: style.backgroundColor,
          backgroundImage: style.backgroundImage,
          shadow: style.boxShadow,
          behind,
          navigationButton: button?.getAttribute('data-testid') ?? null,
        })
      }
      return {
        reports: found,
        windowBackground: getComputedStyle(document.documentElement).getPropertyValue(
          '--background',
        ),
      }
    },
    [area, inside ?? null] as const,
  )
  return reports
    .filter((report) => draws(report, windowBackground))
    .map(({ description, box, navigationButton }) => ({ description, box, navigationButton }))
}

/**
 * Whether a point is in the window's drag area: the element there, or its
 * nearest ancestor, whose computed `app-region` is `drag` or `no-drag` says
 * which.
 */
export async function inDragArea(app: AppDriver, x: number, y: number): Promise<boolean> {
  return app.page.evaluate(
    ([pointX, pointY]) => {
      for (
        let element = document.elementFromPoint(pointX!, pointY!);
        element;
        element = element.parentElement
      ) {
        const region = getComputedStyle(element).getPropertyValue('app-region')
        if (region === 'drag' || region === 'no-drag') return region === 'drag'
      }
      return false
    },
    [x, y],
  )
}

/**
 * The points of the window's top row that show no text, icon or button but
 * are not in the drag area, checked in every column of CSS pixels along lines
 * across the row. A point shows text when it is in the box of an element with
 * text of its own; points within a physical pixel of such a box, or of an
 * icon or a button, are left out, since hit testing snaps boxes to physical
 * pixels.
 */
export async function blankPointsOutsideDragArea(app: AppDriver): Promise<string[]> {
  return app.page.evaluate((rowHeight) => {
    const margin = 1 / window.devicePixelRatio
    const shown: DOMRect[] = []
    for (const element of Array.from(document.body.querySelectorAll('*'))) {
      const ownText = Array.from(element.childNodes).some(
        (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
      )
      if (!ownText && element.tagName !== 'BUTTON' && element.tagName.toLowerCase() !== 'svg') {
        continue
      }
      const rect = element.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0 && rect.top < rowHeight) shown.push(rect)
    }
    const inDrag = (x: number, y: number) => {
      for (
        let element = document.elementFromPoint(x, y);
        element;
        element = element.parentElement
      ) {
        const region = getComputedStyle(element).getPropertyValue('app-region')
        if (region === 'drag' || region === 'no-drag') return region === 'drag'
      }
      return false
    }
    const outside: string[] = []
    for (const y of [0.5, 11, 22, 33, rowHeight - 0.5]) {
      // A quarter of a pixel into each column: elementFromPoint finds nothing
      // in the last half pixel of the window.
      for (let x = 0.25; x < window.innerWidth; x++) {
        const onSomething = shown.some(
          (rect) =>
            x > rect.left - margin &&
            x < rect.right + margin &&
            y > rect.top - margin &&
            y < rect.bottom + margin,
        )
        if (!onSomething && !inDrag(x, y)) outside.push(`${x},${y}`)
      }
    }
    return outside
  }, TOP_ROW_HEIGHT)
}

/** The boxes of the elements whose computed `app-region` is `drag`. */
export async function dragElementBoxes(
  app: AppDriver,
): Promise<Array<Box & { description: string }>> {
  return app.page.evaluate(() =>
    Array.from(document.querySelectorAll('*'))
      .filter((element) => getComputedStyle(element).getPropertyValue('app-region') === 'drag')
      .map((element) => {
        const { left, top, right, bottom } = element.getBoundingClientRect()
        return { description: element.tagName.toLowerCase(), left, top, right, bottom }
      }),
  )
}

/** Where an element is in the window. */
export async function boxOf(locator: Locator): Promise<Box> {
  return locator.evaluate((element) => {
    const { left, top, right, bottom } = element.getBoundingClientRect()
    return { left, top, right, bottom }
  })
}

/** Where the navigation's buttons are: the sidebar's trigger, Back and Forward. */
export async function navigationBoxes(app: AppDriver): Promise<Record<string, Box>> {
  return {
    toggle: await boxOf(app.toggleSidebarButton()),
    back: await boxOf(app.backButton()),
    forward: await boxOf(app.forwardButton()),
  }
}

/** Physical pixels per CSS pixel. */
export async function pixelRatio(app: AppDriver): Promise<number> {
  return app.page.evaluate(() => window.devicePixelRatio)
}

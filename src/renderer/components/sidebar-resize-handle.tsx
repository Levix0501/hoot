import type { PointerEvent as ReactPointerEvent } from 'react'
import { MAIN_AREA_MIN_WIDTH, SIDEBAR_WIDTH, draggedSidebarWidth } from '../../shared/sidebar-width'
import { sidebarSlideEnded } from '../lib/sidebar-slide'
import { useAppStore } from '../store/app-store'

/**
 * The sidebar's width as the sidebar's wrapper gives it to the sidebar:
 * `width`, or in a window too narrow for that, as much as leaves the main area
 * its narrowest width, but not less than the sidebar's narrowest width.
 */
export function sidebarWidthStyle(width: number): string {
  return `max(${SIDEBAR_WIDTH.min}px, min(${width}px, 100vw - ${MAIN_AREA_MIN_WIDTH}px))`
}

/** Resolves at the next frame, by which the window has taken in what changed before it. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

/**
 * Follows the pointer that pressed the sidebar's edge until it is let go of.
 * The edge moves as far as the pointer, within the sidebar's limits, without
 * sliding: the width is set on the sidebar's wrapper directly, and saved when
 * the pointer is let go of. Past half the sidebar's narrowest width, the
 * sidebar slides out as it does when it is hidden, and keeps the width it had
 * before; brought back, it slides in, then follows the pointer again.
 */
function dragSidebarEdge(down: ReactPointerEvent<HTMLElement>): void {
  const handle = down.currentTarget
  const wrapper = handle.closest<HTMLElement>('[data-slot="sidebar-wrapper"]')
  const container = handle.closest<HTMLElement>('[data-slot="sidebar-container"]')
  if (!wrapper || !container) return
  const { pointerId, clientX: startX } = down
  // The pointer's events keep coming to the edge wherever the pointer goes.
  handle.setPointerCapture(pointerId)
  const startWidth = container.getBoundingClientRect().width
  const store = useAppStore.getState
  const show = (width: number) =>
    wrapper.style.setProperty('--sidebar-width', sidebarWidthStyle(width))

  // The width the pointer gives the sidebar, from when the pointer first moves.
  let width: number | null = null
  // Whether the width follows the pointer, the pointer is past the collapsing
  // point, or the sidebar slides back in.
  let phase: 'resizing' | 'collapsed' | 'expanding' = 'resizing'
  let expansions = 0
  let done = false

  const onMove = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return
    const next = draggedSidebarWidth(startWidth, startX, event.clientX, window.innerWidth)
    if (next === null) {
      if (phase === 'collapsed') return
      phase = 'collapsed'
      store().setSidebarResizing(false)
      store().setSidebarOpen(false)
      return
    }
    width = next
    if (phase === 'resizing') {
      show(next)
    } else if (phase === 'collapsed') {
      phase = 'expanding'
      const expansion = ++expansions
      show(next)
      store().setSidebarOpen(true)
      // Once the slide has started and ended.
      void nextFrame()
        .then(sidebarSlideEnded)
        .then(() => {
          if (done || phase !== 'expanding' || expansion !== expansions) return
          phase = 'resizing'
          store().setSidebarResizing(true)
          if (width !== null) show(width)
        })
    }
  }

  const onUp = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return
    done = true
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
    if (phase === 'collapsed') {
      show(store().sidebarWidth)
    } else if (width !== null) {
      // Set again: while the sidebar slid back in, the wrapper kept the width it slid in at.
      show(width)
      store().setSidebarWidth(width)
    }
    store().setSidebarResizing(false)
  }

  store().setSidebarResizing(true)
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
}

/**
 * The sidebar's right edge, below the window's top row, which drags the
 * window: dragging it resizes the sidebar (see {@link dragSidebarEdge}), and
 * a double click gives the sidebar its default width back. It reaches 8
 * pixels either side of the sidebar's border, which a line covers while the
 * pointer is on the edge or drags it. Pressing it keeps the keyboard focus
 * where it is, in a terminal, say.
 */
export function SidebarResizeHandle() {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      className="group/resize absolute top-11 -right-2 bottom-0 w-4 cursor-col-resize touch-none select-none group-data-[state=collapsed]:pointer-events-none"
      onPointerDown={(event) => {
        if (event.button === 0) dragSidebarEdge(event)
      }}
      onMouseDown={(event) => event.preventDefault()}
      onDoubleClick={() => useAppStore.getState().setSidebarWidth(SIDEBAR_WIDTH.default)}
      data-testid="sidebar-resize-handle"
    >
      <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-linear-to-b from-transparent via-foreground/25 to-transparent opacity-0 group-hover/resize:opacity-100 in-data-resizing:opacity-100" />
    </div>
  )
}

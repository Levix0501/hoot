/**
 * The transitions of the space the sidebar takes beside the main area, which
 * run while the sidebar slides in or out, or slides to a new width.
 */
export function sidebarSlide(): Animation[] {
  return document.querySelector('[data-slot="sidebar-gap"]')?.getAnimations() ?? []
}

/** The slide of the file panel, which runs while it slides in or out at the window's right edge. */
export function filePanelSlide(): Animation[] {
  return document.querySelector('[data-file-panel]')?.getAnimations() ?? []
}

/** Resolves once `slide` runs no more, also when it turned back half way. */
async function slideEnded(slide: () => Animation[]): Promise<void> {
  for (let running = slide(); running.length > 0; running = slide()) {
    await Promise.allSettled(running.map((animation) => animation.finished))
  }
}

/** Resolves once the sidebar has stopped sliding, also when it turned back half way. */
export function sidebarSlideEnded(): Promise<void> {
  return slideEnded(sidebarSlide)
}

/** Resolves once the file panel has stopped sliding, also when it turned back half way. */
export function filePanelSlideEnded(): Promise<void> {
  return slideEnded(filePanelSlide)
}

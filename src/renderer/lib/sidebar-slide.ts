/**
 * The transitions of the space the sidebar takes beside the main area, which
 * run while the sidebar slides in or out, or slides to a new width.
 */
export function sidebarSlide(): Animation[] {
  return document.querySelector('[data-slot="sidebar-gap"]')?.getAnimations() ?? []
}

/** Resolves once the sidebar has stopped sliding, also when it turned back half way. */
export async function sidebarSlideEnded(): Promise<void> {
  for (let slide = sidebarSlide(); slide.length > 0; slide = sidebarSlide()) {
    await Promise.allSettled(slide.map((animation) => animation.finished))
  }
}

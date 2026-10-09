import { WebglAddon } from '@xterm/addon-webgl'
import type { IDisposable } from '@xterm/xterm'
import type { SessionTerminal } from './session-terminal'

/**
 * Draws a terminal with the WebGL renderer of xterm.js until the returned
 * disposable is disposed. That renderer draws block elements and box drawing
 * characters itself, so that they fill their cells and join their neighbors.
 *
 * A page keeps only a few WebGL contexts, so only the terminal on screen
 * draws with WebGL. Where WebGL is not available, or once its context is
 * lost, the terminal is drawn by the DOM renderer that xterm.js has built in.
 * The two renderers' cells differ in size: fit the terminal after calling
 * this; after a lost context it is fitted again here.
 */
export function drawWithWebgl({ terminal, fit }: SessionTerminal): IDisposable {
  const addon = new WebglAddon()
  try {
    terminal.loadAddon(addon)
  } catch (error) {
    addon.dispose()
    console.warn('The terminal is drawn without WebGL.', error)
    return addon
  }
  // When the context is lost, xterm.js waits a few seconds for it to come
  // back and shows no text meanwhile; the DOM renderer takes over at once
  // instead. The event does not bubble, so it is caught on its way to the
  // renderer's canvas.
  const element = terminal.element!
  const useDomRenderer = () => {
    addon.dispose()
    fit.fit()
  }
  element.addEventListener('webglcontextlost', useDomRenderer, { capture: true, once: true })
  return {
    dispose() {
      element.removeEventListener('webglcontextlost', useDomRenderer, { capture: true })
      addon.dispose()
    },
  }
}

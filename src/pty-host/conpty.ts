import type { IWindowsPtyForkOptions } from 'node-pty'

/**
 * Starts sessions on Windows in the ConPTY that comes with node-pty, from
 * Windows Terminal, as VS Code does, rather than in the older one of Windows.
 * That one keeps a screen of its own and, whenever the terminal is resized,
 * reflows it and draws it all again over the screen xterm.js has reflowed
 * itself, which repeats lines, drops some and breaks others apart. node-pty's
 * leaves reflowing to the terminal, and closing its console ends every
 * program still attached to it. Other systems ignore it.
 */
export const CONPTY_OPTIONS: IWindowsPtyForkOptions = { useConptyDll: true }

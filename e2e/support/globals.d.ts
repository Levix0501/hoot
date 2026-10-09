import type { Terminal } from '@xterm/xterm'
import type { HootApi } from '../../src/shared/ipc'

declare global {
  interface Window {
    /** What the preload script gives the window. */
    hoot: HootApi
    /** Exposed by Hoot when it runs with test hooks. */
    hootTestHooks?: {
      /** The terminal of the current session. */
      readonly terminal: Terminal | undefined
      /** The terminal of any session, shown or not. */
      terminalOf(sessionId: string): Terminal | undefined
    }
  }
}

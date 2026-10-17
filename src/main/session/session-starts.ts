import { randomUUID } from 'node:crypto'
import type { SessionStartAnswer, SessionStartRequest } from '../../shared/ipc'

/** How long hoot's request for a session waits for the window to start it. */
const START_TIMEOUT_MS = 5 * 60_000

/**
 * The sessions hoot asks for, which the window starts as an issue's start
 * button does: each request goes to the window under an id of its own, and
 * settles with the window's answer under that id, or after a while without
 * one.
 */
export class SessionStartRequests {
  private readonly pending = new Map<string, (answer: SessionStartAnswer) => void>()

  constructor(
    /** Sends a request to the window; false when there is no window to send it to. */
    private readonly send: (request: SessionStartRequest) => boolean,
    private readonly timeoutMs: number = START_TIMEOUT_MS,
  ) {}

  /** Asks the window to start a session for an issue; settles with how it started. */
  request(issueId: number, prompt: string | null): Promise<SessionStartAnswer> {
    const requestId = randomUUID()
    return new Promise((resolve) => {
      const settle = (answer: SessionStartAnswer) => {
        clearTimeout(timer)
        this.pending.delete(requestId)
        resolve(answer)
      }
      const timer = setTimeout(
        () => settle({ ok: false, message: 'Hoot did not start the session in time.' }),
        this.timeoutMs,
      )
      this.pending.set(requestId, settle)
      if (!this.send({ requestId, issueId, prompt })) {
        settle({ ok: false, message: "Hoot's window is not open, which starts the session." })
      }
    })
  }

  /** The window's answer to a request; one that is no longer waited for is ignored. */
  answer(requestId: string, answer: SessionStartAnswer): void {
    this.pending.get(requestId)?.(answer)
  }
}

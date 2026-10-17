import { describe, expect, it, vi } from 'vitest'
import type { SessionStartRequest } from '../../shared/ipc'
import { SessionStartRequests } from './session-starts'

describe('SessionStartRequests', () => {
  it('sends each request to the window under an id of its own, and settles with its answer', async () => {
    const sent: SessionStartRequest[] = []
    const requests = new SessionStartRequests((request) => sent.push(request) > 0)
    const first = requests.request(3, null)
    const second = requests.request(4, 'Hello')
    expect(sent.map(({ issueId, prompt }) => [issueId, prompt])).toEqual([
      [3, null],
      [4, 'Hello'],
    ])
    expect(sent[0]!.requestId).not.toBe(sent[1]!.requestId)
    requests.answer(sent[1]!.requestId, { ok: false, message: 'No.' })
    requests.answer(sent[0]!.requestId, { ok: true, worktreePath: '/w' })
    // An answer no longer waited for changes nothing.
    requests.answer(sent[0]!.requestId, { ok: false, message: 'Late.' })
    expect(await first).toEqual({ ok: true, worktreePath: '/w' })
    expect(await second).toEqual({ ok: false, message: 'No.' })
  })

  it('says so when there is no window, or it does not answer in time', async () => {
    expect(await new SessionStartRequests(() => false).request(3, null)).toEqual({
      ok: false,
      message: "Hoot's window is not open, which starts the session.",
    })
    vi.useFakeTimers()
    try {
      const pending = new SessionStartRequests(() => true, 1_000).request(3, null)
      vi.advanceTimersByTime(1_000)
      expect(await pending).toEqual({
        ok: false,
        message: 'Hoot did not start the session in time.',
      })
    } finally {
      vi.useRealTimers()
    }
  })
})

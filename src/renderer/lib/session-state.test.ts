import { describe, expect, it } from 'vitest'
import type { HookEvent } from '../../shared/hoot-cli'
import type { SessionExit } from '../../shared/session'
import {
  afterHookEvent,
  afterTitle,
  projectSummary,
  sessionState,
  stateLabel,
  stateTooltip,
  type StateSource,
} from './session-state'

const claude = (changes: Partial<StateSource> = {}): StateSource => ({
  toolId: 'claude',
  status: 'running',
  exit: null,
  title: '✳ Claude Code',
  attention: null,
  unread: false,
  ...changes,
})

const exit = (changes: Partial<SessionExit>): SessionExit => ({
  code: null,
  signal: null,
  abnormal: false,
  ...changes,
})

/** A session after its program set the titles, the hooks reported the events, and so on. */
function play(
  session: StateSource,
  ...steps: Array<{ title: string; viewed?: boolean } | { event: HookEvent }>
): StateSource {
  let current = session
  for (const step of steps) {
    const change =
      'title' in step
        ? afterTitle(current, step.title, step.viewed ?? false)
        : afterHookEvent(current, step.event)
    current = { ...current, ...change, ...('title' in step ? { title: step.title } : {}) }
  }
  return current
}

describe('sessionState', () => {
  it('is starting until the process runs, then running for any session but Claude Code', () => {
    for (const toolId of ['shell', 'codex', 'opencode', 'claude'] as const) {
      expect(sessionState({ ...claude(), toolId, status: 'starting' })).toBe('starting')
    }
    for (const toolId of ['shell', 'codex', 'opencode'] as const) {
      expect(sessionState({ ...claude({ title: '◐ Working' }), toolId })).toBe('running')
      expect(sessionState({ ...claude({ attention: 'waiting', unread: true }), toolId })).toBe(
        'running',
      )
    }
  })

  it('is ended, or ended unexpectedly when the terminal host stopped, for every tool', () => {
    for (const toolId of ['shell', 'claude'] as const) {
      const ended = { ...claude({ attention: 'waiting', title: '◐ x' }), toolId }
      expect(sessionState({ ...ended, status: 'exited', exit: exit({ code: 3 }) })).toBe('ended')
      expect(sessionState({ ...ended, status: 'exited', exit: exit({ signal: 'SIGKILL' }) })).toBe(
        'ended',
      )
      expect(sessionState({ ...ended, status: 'exited', exit: exit({ abnormal: true }) })).toBe(
        'ended-unexpectedly',
      )
    }
  })

  it('is, for Claude Code, waiting or stopped by an error first, then working, done or idle', () => {
    expect(sessionState(claude())).toBe('idle')
    expect(sessionState(claude({ title: '' }))).toBe('idle')
    expect(sessionState(claude({ title: '◐ Fix' }))).toBe('working')
    expect(sessionState(claude({ title: '◑ Fix' }))).toBe('working')
    expect(sessionState(claude({ unread: true }))).toBe('done')
    expect(sessionState(claude({ attention: 'waiting', unread: true }))).toBe('waiting')
    expect(sessionState(claude({ attention: 'error', unread: true }))).toBe('error')
  })
})

describe('what a Claude Code session does', () => {
  it('is idle until its first turn, and works while its title says so', () => {
    const started = play(claude({ title: '' }), { title: '✳ Claude Code' })
    expect(sessionState(started)).toBe('idle')
    const working = play(started, { title: '◐ Fix' }, { title: '◑ Fix' })
    expect(sessionState(working)).toBe('working')
  })

  it('is idle after a turn the user saw end, and done after one they did not, until they view it', () => {
    const working = play(claude(), { title: '◐ Fix' })
    expect(sessionState(play(working, { title: '✳ Fix', viewed: true }))).toBe('idle')
    const done = play(working, { title: '✳ Fix', viewed: false })
    expect(sessionState(done)).toBe('done')
    // A title that is not a working one, set again, changes nothing.
    expect(sessionState(play(done, { title: '✳ Renamed', viewed: true }))).toBe('done')
    // Viewing it is up to the window, which marks it read.
    expect(sessionState({ ...done, unread: false })).toBe('idle')
    // The next turn starts.
    expect(play(done, { title: '◐ Fix' })).toMatchObject({ unread: false })
  })

  it('waits for the user while a dialog does, viewed or not, until Claude Code works again', () => {
    for (const viewed of [true, false]) {
      const asked = play(
        claude(),
        { title: '◐ Fix' },
        { title: '✳ Fix', viewed },
        { event: 'PermissionRequest' },
      )
      expect(sessionState(asked)).toBe('waiting')
      // Answered: Claude Code goes on, and ends its turn.
      const approved = play(asked, { title: '◐ Fix' })
      expect(sessionState(approved)).toBe('working')
      expect(
        sessionState(play(approved, { event: 'Stop' }, { title: '✳ Fix', viewed: true })),
      ).toBe('idle')
    }
    const elicited = play(
      claude(),
      { title: '◐ Fix' },
      { title: '✳ Fix' },
      { event: 'Elicitation' },
    )
    expect(sessionState(elicited)).toBe('waiting')
    // Denied: nothing is reported, and it waits until the next turn starts.
    expect(sessionState(play(elicited, { title: '✳ Fix', viewed: true }))).toBe('waiting')
    expect(sessionState(play(elicited, { title: '◐ Next' }))).toBe('working')
  })

  it('stops waiting when the turn ends, as after a dialog answered before it was reported', () => {
    const late = play(
      claude(),
      { title: '◐ Fix' },
      { title: '✳ Fix' },
      { title: '◐ Fix' },
      { event: 'PermissionRequest' },
    )
    expect(sessionState(late)).toBe('waiting')
    // The next change of the working title, or the end of the turn, sets it right.
    expect(sessionState(play(late, { title: '◑ Fix' }))).toBe('working')
    expect(sessionState(play(late, { title: '✳ Fix', viewed: true }, { event: 'Stop' }))).toBe(
      'idle',
    )
    expect(sessionState(play(late, { title: '✳ Fix', viewed: false }, { event: 'Stop' }))).toBe(
      'done',
    )
  })

  it('has stopped by an error, viewed or not, until its next turn starts', () => {
    for (const viewed of [true, false]) {
      const failed = play(
        claude(),
        { title: '◐ Fix' },
        { title: '✳ Fix', viewed },
        { event: 'StopFailure' },
      )
      expect(sessionState(failed)).toBe('error')
      expect(sessionState({ ...failed, unread: false })).toBe('error')
      expect(sessionState(play(failed, { title: '✳ Fix', viewed: true }))).toBe('error')
      expect(sessionState(play(failed, { title: '◐ Retry' }))).toBe('working')
    }
  })

  it('takes no event of a hook for a session that is not running Claude Code', () => {
    for (const event of ['PermissionRequest', 'Elicitation', 'StopFailure'] as const) {
      expect(afterHookEvent({ ...claude(), toolId: 'shell' }, event)).toEqual({})
      expect(afterHookEvent(claude({ status: 'starting' }), event)).toEqual({})
      expect(afterHookEvent(claude({ status: 'exited', exit: exit({ code: 1 }) }), event)).toEqual(
        {},
      )
    }
    expect(afterHookEvent(claude({ attention: 'error' }), 'Stop')).toEqual({})
    expect(afterTitle({ ...claude({ title: '◐ x' }), toolId: 'shell' }, '✳ x', false)).toEqual({})
  })
})

describe('stateTooltip and stateLabel', () => {
  it("name a running session's state, and tell how an ended one ended", () => {
    const names = {
      starting: 'Starting',
      working: 'Working',
      waiting: 'Waiting for you',
      done: 'Done',
      idle: 'Idle',
      error: 'Stopped by an error',
      running: 'Running',
    } as const
    for (const [state, name] of Object.entries(names)) {
      expect(stateTooltip(state as keyof typeof names, null)).toBe(name)
      expect(stateLabel(state as keyof typeof names, null)).toBe(name)
    }
    expect(stateTooltip('ended', exit({ code: 3 }))).toBe('Process exited with code 3.')
    expect(stateLabel('ended', exit({ code: 3 }))).toBe('Exited (3)')
    expect(stateTooltip('ended', exit({ signal: 'SIGKILL' }))).toBe(
      'Process terminated by signal SIGKILL.',
    )
    expect(stateLabel('ended', exit({ signal: 'SIGKILL' }))).toBe('Terminated (SIGKILL)')
    expect(stateTooltip('ended-unexpectedly', exit({ abnormal: true }))).toBe(
      'The terminal host stopped unexpectedly. The session has ended.',
    )
    expect(stateLabel('ended-unexpectedly', exit({ abnormal: true }))).toBe('Ended unexpectedly')
  })
})

describe('projectSummary', () => {
  it('shows nothing while no session needs the user', () => {
    expect(projectSummary([])).toBeNull()
    expect(projectSummary(['working', 'idle', 'running', 'starting'])).toBeNull()
  })

  it('shows the light of the state that needs the user most, and counts the sessions in each', () => {
    expect(projectSummary(['done', 'working'])).toEqual({
      state: 'done',
      tooltip: '1 session done',
    })
    expect(projectSummary(['done', 'waiting', 'idle'])).toEqual({
      state: 'waiting',
      tooltip: '1 session waiting for you, 1 session done',
    })
    expect(projectSummary(['done', 'ended', 'waiting', 'running'])).toEqual({
      state: 'waiting',
      tooltip: '1 session waiting for you, 1 session ended, 1 session done',
    })
    expect(projectSummary(['done', 'ended', 'error', 'waiting'])).toEqual({
      state: 'waiting',
      tooltip:
        '1 session waiting for you, 1 session stopped by an error, 1 session ended, 1 session done',
    })
    expect(projectSummary(['done', 'ended', 'error', 'done'])).toEqual({
      state: 'error',
      tooltip: '1 session stopped by an error, 1 session ended, 2 sessions done',
    })
    expect(
      projectSummary(['ended-unexpectedly', 'ended', 'ended-unexpectedly', 'ended-unexpectedly']),
    ).toEqual({
      state: 'ended-unexpectedly',
      tooltip: '3 sessions ended unexpectedly, 1 session ended',
    })
    expect(projectSummary(['waiting', 'waiting', 'error', 'error', 'ended', 'ended'])).toEqual({
      state: 'waiting',
      tooltip: '2 sessions waiting for you, 2 sessions stopped by an error, 2 sessions ended',
    })
  })
})

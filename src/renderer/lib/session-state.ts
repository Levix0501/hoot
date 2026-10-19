import type { HookEvent } from '../../shared/hoot-cli'
import {
  describeExit,
  describeExitShort,
  isClaudeCodeWorkingTitle,
  type SessionExit,
} from '../../shared/session'
import type { ToolId } from '../../shared/tools'

/**
 * What the hooks of a Claude Code session last said it stopped for, until its
 * next turn starts: a dialog that waits for the user, or an API error.
 */
export type Attention = 'waiting' | 'error' | null

/** What a session's state comes from. */
export interface StateSource {
  toolId: ToolId
  status: 'starting' | 'running' | 'exited'
  exit: SessionExit | null
  /** The terminal title the session's program set last. */
  title: string
  attention: Attention
  /**
   * Claude Code stopped working while the session was not being viewed, and
   * the user has not viewed it since.
   */
  unread: boolean
}

/**
 * The state of a session, which its light shows: starting, until its process
 * runs; ended, or ended unexpectedly when the terminal host stopped; and,
 * while it runs, running, or for Claude Code what it is doing.
 */
export type SessionState =
  | 'starting'
  | 'working'
  | 'waiting'
  | 'done'
  | 'idle'
  | 'error'
  | 'running'
  | 'ended'
  | 'ended-unexpectedly'

/**
 * The state of a session. A running Claude Code session waits for the user
 * while one of its dialogs does, has stopped on an error until its next turn
 * starts, works while its title says so, is done once it stopped working
 * while it was not viewed, until it is viewed, and is idle otherwise.
 */
export function sessionState(session: StateSource): SessionState {
  if (session.status === 'starting') return 'starting'
  if (session.status === 'exited') return session.exit?.abnormal ? 'ended-unexpectedly' : 'ended'
  if (session.toolId !== 'claude') return 'running'
  if (session.attention === 'waiting') return 'waiting'
  if (session.attention === 'error') return 'error'
  if (isClaudeCodeWorkingTitle(session.title)) return 'working'
  return session.unread ? 'done' : 'idle'
}

/** What changes about where a session's state comes from. */
export type StateChange = Partial<Pick<StateSource, 'attention' | 'unread'>>

/**
 * What changes about a session's state when its program sets `title`, given
 * whether the user is viewing the session. Claude Code working again ends
 * what it stopped for: a dialog answered, or an error followed by the next
 * turn. When it stops working, it is done unless the user is viewing it.
 */
export function afterTitle(session: StateSource, title: string, viewed: boolean): StateChange {
  if (session.toolId !== 'claude') return {}
  if (isClaudeCodeWorkingTitle(title)) return { attention: null, unread: false }
  if (isClaudeCodeWorkingTitle(session.title)) return { unread: !viewed }
  return {}
}

/**
 * What changes about a running Claude Code session's state when one of its
 * hooks reports an event: a dialog that waits for the user opened, a turn
 * stopped on an API error, or a turn ended, which no dialog waits on any more.
 */
export function afterHookEvent(session: StateSource, event: HookEvent): StateChange {
  if (session.toolId !== 'claude' || session.status !== 'running') return {}
  switch (event) {
    case 'PermissionRequest':
    case 'Elicitation':
      return { attention: 'waiting' }
    case 'StopFailure':
      return { attention: 'error' }
    case 'Stop':
      return session.attention === 'waiting' ? { attention: null } : {}
  }
}

/** The names of the states of running sessions. */
const STATE_NAMES: Record<Exclude<SessionState, 'ended' | 'ended-unexpectedly'>, string> = {
  starting: 'Starting',
  working: 'Working',
  waiting: 'Waiting for you',
  done: 'Done',
  idle: 'Idle',
  error: 'Stopped by an error',
  running: 'Running',
}

/**
 * What the tooltip of a session's light says: the name of its state, or for
 * a session that ended, how it ended, in a sentence.
 */
export function stateTooltip(state: SessionState, exit: SessionExit | null): string {
  if (state === 'ended' || state === 'ended-unexpectedly') {
    return exit ? describeExit(exit) : 'The session has ended.'
  }
  return STATE_NAMES[state]
}

/**
 * What the session header says right of the light: the name of the
 * session's state, or for a session that ended, how it ended, in a few words.
 */
export function stateLabel(state: SessionState, exit: SessionExit | null): string {
  if (state === 'ended' || state === 'ended-unexpectedly') {
    return exit ? describeExitShort(exit) : 'Ended'
  }
  return STATE_NAMES[state]
}

/**
 * The states a collapsed project's row sums up, from the one that needs the
 * user most, each with how the row's tooltip counts its sessions: for one
 * session, and for more.
 */
const SUMMED_UP: ReadonlyArray<[SessionState, string, string]> = [
  ['waiting', 'session waiting for you', 'sessions waiting for you'],
  ['ended-unexpectedly', 'session ended unexpectedly', 'sessions ended unexpectedly'],
  ['error', 'session stopped by an error', 'sessions stopped by an error'],
  ['ended', 'session ended', 'sessions ended'],
  ['done', 'session done', 'sessions done'],
]

/** What a collapsed project's row shows of its sessions: a light, and its tooltip. */
export interface ProjectSummary {
  state: SessionState
  tooltip: string
}

/**
 * What a collapsed project's row shows of the states of its sessions, those
 * of its worktrees included: the light of the state first in `SUMMED_UP`
 * that one of them is in, and a tooltip that counts the sessions in each of
 * those states, in that order; `null` when none is in one.
 */
export function projectSummary(states: readonly SessionState[]): ProjectSummary | null {
  const counted = SUMMED_UP.flatMap(([state, one, more]) => {
    const count = states.filter((candidate) => candidate === state).length
    if (count === 0) return []
    return [{ state, text: count === 1 ? `1 ${one}` : `${count} ${more}` }]
  })
  if (counted.length === 0) return null
  return { state: counted[0]!.state, tooltip: counted.map(({ text }) => text).join(', ') }
}

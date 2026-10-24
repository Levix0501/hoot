import type { HookEventReport } from '../../shared/hoot-cli'
import {
  describeExit,
  describeExitShort,
  isClaudeCodeWorkingTitle,
  type SessionExit,
} from '../../shared/session'
import type { ToolId } from '../../shared/tools'

/**
 * What the hooks of a Claude Code session last said waits for the user, until
 * Claude Code works again: a dialog of its own agent, or one of a subagent's,
 * which can stay open after the turn ends.
 */
export type Attention = 'waiting' | 'subagent-waiting' | null

/**
 * A turn of a Claude Code session's main agent that stopped on an API error,
 * by the id Claude Code gives it; `null` when its hook gave none.
 */
export interface Failure {
  turn: string | null
}

/** How many of a session's latest turns `StateSource.turns` keeps. */
const KEPT_TURNS = 16

/** What a session's state comes from. */
export interface StateSource {
  toolId: ToolId
  status: 'starting' | 'running' | 'exited'
  exit: SessionExit | null
  /** The terminal title the session's program set last. */
  title: string
  /**
   * When the output arrived that last set a working title after one that is
   * not, in milliseconds since the Unix epoch; `null` until there was one.
   */
  workingSince: number | null
  attention: Attention
  /**
   * The turns of the main agent that its hooks told of, by their start or
   * whatever event of the turn they reported first, by the ids Claude Code
   * gives them, oldest first: the latest `KEPT_TURNS` of them.
   */
  turns: readonly string[]
  /** The turn that stopped on an API error, until a later one starts. */
  failure: Failure | null
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
 * while one of its dialogs does, works while its title says so, has stopped
 * on an error otherwise once a turn of its main agent did, until a later turn
 * starts (while a background agent goes on, its dialogs and its work show
 * first), is done once it stopped working while it was not viewed, until it
 * is viewed, and is idle otherwise.
 */
export function sessionState(session: StateSource): SessionState {
  if (session.status === 'starting') return 'starting'
  if (session.status === 'exited') return session.exit?.abnormal ? 'ended-unexpectedly' : 'ended'
  if (session.toolId !== 'claude') return 'running'
  if (session.attention === 'waiting' || session.attention === 'subagent-waiting') return 'waiting'
  if (isClaudeCodeWorkingTitle(session.title)) return 'working'
  if (session.failure !== null) return 'error'
  return session.unread ? 'done' : 'idle'
}

/** What changes about where a session's state comes from. */
export type StateChange = Partial<
  Pick<StateSource, 'workingSince' | 'attention' | 'turns' | 'failure' | 'unread'>
>

/**
 * What changes about a session's state when its program sets `title`, in
 * output that arrived at `arrivedAt`, given whether the user is viewing the
 * session. Claude Code working again ends the dialog it waited on, which the
 * user answered. When it stops working, it is done unless the user is
 * viewing it.
 */
export function afterTitle(
  session: StateSource,
  title: string,
  viewed: boolean,
  arrivedAt: number,
): StateChange {
  if (session.toolId !== 'claude') return {}
  if (isClaudeCodeWorkingTitle(title)) {
    if (isClaudeCodeWorkingTitle(session.title)) return { attention: null, unread: false }
    return { attention: null, unread: false, workingSince: arrivedAt }
  }
  if (isClaudeCodeWorkingTitle(session.title)) return { unread: !viewed }
  return {}
}

/**
 * What changes about a running Claude Code session's state when one of its
 * hooks reports an event: a dialog that waits for the user opened; a turn
 * started, which ends an earlier turn's stop on an API error; a turn of the
 * main agent stopped on an API error (a subagent's error stops no turn: the
 * main agent takes the news of it in a turn of its own); or a turn ended,
 * which no dialog of the session's own agent waits on any more (a
 * subagent's can).
 *
 * Some turns of the main agent start without a UserPromptSubmit of their
 * own, such as the turn that answers a message the user queued while the
 * turn before it ran, or a bash-mode command: the first event of the main
 * agent's from a turn the hooks have not told of tells that it started.
 *
 * A report can arrive long after its hook ran, and after reports of later
 * hooks. A dialog or the end of a turn whose hook ran before Claude Code last
 * started working is over by now, such as a dialog the user has answered,
 * and changes nothing. Turns are told apart by their ids instead: the stop
 * of a turn older than one that has started changes nothing, nor does the
 * start of a turn whose stop came first.
 */
export function afterHookEvent(session: StateSource, report: HookEventReport): StateChange {
  if (session.toolId !== 'claude' || session.status !== 'running') return {}
  switch (report.event) {
    case 'UserPromptSubmit':
      return afterTurnStarted(session, report.turn)
    case 'StopFailure':
      return report.subagent ? {} : afterTurnFailed(session, report.turn)
  }
  if (session.workingSince !== null && report.startedAt < session.workingSince) return {}
  // A subagent's events name the main agent's turn of the moment, which tells nothing of its start.
  const started =
    report.subagent || report.turn === null ? {} : afterTurnStarted(session, report.turn)
  switch (report.event) {
    case 'SessionStart':
    case 'SessionEnd':
      return {}
    case 'PermissionRequest':
    case 'Elicitation':
      return { ...started, attention: report.subagent ? 'subagent-waiting' : 'waiting' }
    case 'Stop':
      return session.attention === 'waiting' ? { ...started, attention: null } : started
  }
}

/** The latest turns of a session with `turn` after them. */
function withTurn(session: StateSource, turn: string): string[] {
  return [...session.turns, turn].slice(-KEPT_TURNS)
}

/** What changes when the turn `turn` of the main agent starts: a stop of an earlier one ends. */
function afterTurnStarted(session: StateSource, turn: string | null): StateChange {
  if (turn === null) return session.failure === null ? {} : { failure: null }
  if (session.turns.includes(turn)) return {}
  return { turns: withTurn(session, turn), failure: null }
}

/** What changes when the turn `turn` of the main agent stops on an API error, unless a later one has started. */
function afterTurnFailed(session: StateSource, turn: string | null): StateChange {
  if (turn === null) return { failure: { turn } }
  if (!session.turns.includes(turn)) return { turns: withTurn(session, turn), failure: { turn } }
  if (session.turns.at(-1) !== turn) return {}
  return { failure: { turn } }
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
 * What a session's light says to screen readers: the name of its state, or
 * for a session that ended, how it ended, in a sentence.
 */
export function stateDescription(state: SessionState, exit: SessionExit | null): string {
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
 * The states the row of a collapsed project or worktree sums up, from the one
 * that needs the user most, each with how the row's description counts its
 * sessions: for one session, and for more.
 */
const SUMMED_UP: ReadonlyArray<[SessionState, string, string]> = [
  ['waiting', 'session waiting for you', 'sessions waiting for you'],
  ['ended-unexpectedly', 'session ended unexpectedly', 'sessions ended unexpectedly'],
  ['error', 'session stopped by an error', 'sessions stopped by an error'],
  ['ended', 'session ended', 'sessions ended'],
  ['done', 'session done', 'sessions done'],
]

/**
 * What the row of a collapsed project or worktree shows of its sessions: a
 * light, and what it says to screen readers.
 */
export interface SessionsSummary {
  state: SessionState
  description: string
}

/**
 * What the row of a collapsed project or worktree shows of the states of its
 * sessions (for a project, those of its worktrees included): the light of the
 * state first in `SUMMED_UP` that one of them is in, and a description that
 * counts the sessions in each of those states, in that order; `null` when
 * none is in one.
 */
export function sessionsSummary(states: readonly SessionState[]): SessionsSummary | null {
  const counted = SUMMED_UP.flatMap(([state, one, more]) => {
    const count = states.filter((candidate) => candidate === state).length
    if (count === 0) return []
    return [{ state, text: count === 1 ? `1 ${one}` : `${count} ${more}` }]
  })
  if (counted.length === 0) return null
  return { state: counted[0]!.state, description: counted.map(({ text }) => text).join(', ') }
}

import { getTool, type ToolId } from './tools'

/** How a session's process ended. */
export interface SessionExit {
  /** Exit code when the process exited on its own, otherwise `null`. */
  code: number | null
  /** Name of the terminating signal (for example `SIGKILL`), otherwise `null`. */
  signal: string | null
  /** The terminal host stopped unexpectedly while the session was running. */
  abnormal: boolean
}

export type SessionStatus = 'running' | 'exited'

export interface SessionInfo {
  id: string
  projectRoot: string
  /** The root of the project's worktree the session runs in, or `null` for the main worktree. */
  worktreePath: string | null
  toolId: ToolId
  status: SessionStatus
  exit: SessionExit | null
}

/**
 * Whether the process exited normally, with exit code 0. Such a session closes
 * on its own; a session that ended any other way stays until it is closed.
 */
export function isNormalExit(exit: SessionExit): boolean {
  return !exit.abnormal && exit.signal === null && exit.code === 0
}

/** A sentence that says how the session ended, shown below its terminal. */
export function describeExit(exit: SessionExit): string {
  if (exit.abnormal) return 'The terminal host stopped unexpectedly. The session has ended.'
  if (exit.signal) return `Process terminated by signal ${exit.signal}.`
  return `Process exited with code ${exit.code ?? 'unknown'}.`
}

/** How the session ended, in a few words for the session header. */
export function describeExitShort(exit: SessionExit): string {
  if (exit.abnormal) return 'Ended unexpectedly'
  if (exit.signal) return `Terminated (${exit.signal})`
  return `Exited (${exit.code ?? '?'})`
}

/** How the session ended, as briefly as the sidebar's session rows need it. */
export function describeExitCompact(exit: SessionExit): string {
  if (exit.abnormal) return 'Ended unexpectedly'
  if (exit.signal) return exit.signal
  return `Exited (${exit.code ?? '?'})`
}

/**
 * The marks Claude Code puts, followed by a space, before the text of the
 * terminal titles it sets: one while it is idle and two it alternates between
 * while it works.
 */
const CLAUDE_CODE_TITLE_MARKS = ['✳', '◐', '◑']

/**
 * The name of a session that the user has not named: its terminal title, with
 * Claude Code's status mark removed, or the tool's name when that leaves no text.
 */
export function defaultSessionName(toolId: ToolId, title: string): string {
  let text = title
  if (toolId === 'claude') {
    const mark = CLAUDE_CODE_TITLE_MARKS.find((candidate) => text.startsWith(`${candidate} `))
    if (mark) text = text.slice(mark.length + 1)
  }
  return text === '' ? getTool(toolId).label : text
}

/** The name Hoot shows for a session: the one the user gave it, if any. */
export function sessionName(session: {
  toolId: ToolId
  title: string
  customName: string | null
}): string {
  return session.customName ?? defaultSessionName(session.toolId, session.title)
}

/** What the quit confirmation says about the sessions that are still running. */
export function describeRunningSessions(count: number): string {
  return count === 1
    ? '1 session is still running. Quitting will end it.'
    : `${count} sessions are still running. Quitting will end them.`
}

/** The label of the button that confirms quitting. */
export function quitConfirmationLabel(count: number): string {
  return count === 1 ? 'End Session and Quit' : 'End Sessions and Quit'
}

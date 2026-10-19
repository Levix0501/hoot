import { describe, expect, it } from 'vitest'
import {
  defaultSessionName,
  describeExit,
  describeAgentOperations,
  describeExitShort,
  describeQuit,
  describeRunningSessions,
  isClaudeCodeWorkingTitle,
  isNormalExit,
  quitConfirmationLabel,
  quitQuestion,
  sessionName,
  type SessionExit,
} from './session'

const exit = (overrides: Partial<SessionExit>): SessionExit => ({
  code: null,
  signal: null,
  abnormal: false,
  ...overrides,
})

describe('describeExit', () => {
  it('reports the exit code', () => {
    expect(describeExit(exit({ code: 3 }))).toBe('Process exited with code 3.')
    expect(describeExitShort(exit({ code: 3 }))).toBe('Exited (3)')
  })

  it('reports the terminating signal', () => {
    expect(describeExit(exit({ signal: 'SIGKILL' }))).toBe('Process terminated by signal SIGKILL.')
    expect(describeExitShort(exit({ signal: 'SIGKILL' }))).toBe('Terminated (SIGKILL)')
  })

  it('marks an abnormal end', () => {
    expect(describeExit(exit({ abnormal: true }))).toBe(
      'The terminal host stopped unexpectedly. The session has ended.',
    )
    expect(describeExitShort(exit({ abnormal: true }))).toBe('Ended unexpectedly')
  })
})

describe('isNormalExit', () => {
  it('is true only for exit code 0', () => {
    expect(isNormalExit(exit({ code: 0 }))).toBe(true)
    expect(isNormalExit(exit({ code: 1 }))).toBe(false)
    expect(isNormalExit(exit({ signal: 'SIGHUP' }))).toBe(false)
    expect(isNormalExit(exit({ abnormal: true }))).toBe(false)
  })
})

describe('isClaudeCodeWorkingTitle', () => {
  it('is true for the titles Claude Code sets while it works, and only for them', () => {
    expect(isClaudeCodeWorkingTitle('◐ Fix login bug')).toBe(true)
    expect(isClaudeCodeWorkingTitle('◑ Fix login bug')).toBe(true)
    expect(isClaudeCodeWorkingTitle('◐ ')).toBe(true)
    expect(isClaudeCodeWorkingTitle('✳ Fix login bug')).toBe(false)
    expect(isClaudeCodeWorkingTitle('')).toBe(false)
    expect(isClaudeCodeWorkingTitle('Plain title')).toBe(false)
    // Only a mark followed by a space, at the start.
    expect(isClaudeCodeWorkingTitle('◐Fix')).toBe(false)
    expect(isClaudeCodeWorkingTitle('Fix ◐ login')).toBe(false)
  })
})

describe('defaultSessionName', () => {
  it('removes the status mark Claude Code puts before its titles', () => {
    expect(defaultSessionName('claude', '✳ Claude Code')).toBe('Claude Code')
    expect(defaultSessionName('claude', '◐ Fix login bug')).toBe('Fix login bug')
    expect(defaultSessionName('claude', '◑ Fix login bug')).toBe('Fix login bug')
    expect(defaultSessionName('claude', '✳ Fix login bug')).toBe('Fix login bug')
    expect(defaultSessionName('claude', 'Plain title')).toBe('Plain title')
    // Only a mark followed by a space, and only once.
    expect(defaultSessionName('claude', '✳Fix')).toBe('✳Fix')
    expect(defaultSessionName('claude', '✳ ✳ Twice')).toBe('✳ Twice')
  })

  it('uses the tool name when no text is left', () => {
    expect(defaultSessionName('claude', '')).toBe('Claude Code')
    expect(defaultSessionName('claude', '✳ ')).toBe('Claude Code')
    expect(defaultSessionName('opencode', '')).toBe('OpenCode')
    expect(defaultSessionName('shell', '')).toBe('Shell')
  })

  it('keeps the titles of other tools as they are', () => {
    expect(defaultSessionName('codex', '⠙ Fix tests | G')).toBe('⠙ Fix tests | G')
    expect(defaultSessionName('opencode', '✳ Not stripped')).toBe('✳ Not stripped')
    expect(defaultSessionName('shell', '◐ x')).toBe('◐ x')
  })
})

describe('sessionName', () => {
  it('prefers the name the user gave the session', () => {
    expect(sessionName({ toolId: 'claude', title: '✳ Topic', customName: 'Auth work' })).toBe(
      'Auth work',
    )
    expect(sessionName({ toolId: 'claude', title: '✳ Topic', customName: null })).toBe('Topic')
  })
})

describe('quit confirmation', () => {
  it('says how many sessions are running', () => {
    expect(quitQuestion('quit')).toBe('Quit Hoot?')
    expect(describeRunningSessions(1, 'quit')).toBe(
      '1 session is still running. Quitting will end it.',
    )
    expect(describeRunningSessions(2, 'quit')).toBe(
      '2 sessions are still running. Quitting will end them.',
    )
    expect(quitConfirmationLabel(1, 'quit')).toBe('End Session and Quit')
    expect(quitConfirmationLabel(3, 'quit')).toBe('End Sessions and Quit')
  })

  it('speaks of restarting before an update', () => {
    expect(quitQuestion('update')).toBe('Restart to Update?')
    expect(describeRunningSessions(1, 'update')).toBe(
      '1 session is still running. Restarting will end it.',
    )
    expect(describeRunningSessions(2, 'update')).toBe(
      '2 sessions are still running. Restarting will end them.',
    )
    expect(quitConfirmationLabel(1, 'update')).toBe('End Session and Restart')
    expect(quitConfirmationLabel(2, 'update')).toBe('End Sessions and Restart')
  })

  it('names the agents being installed or updated, and those waiting to be', () => {
    const updating = { label: 'Claude Code', kind: 'update' as const, waiting: false }
    const installing = { label: 'OpenCode', kind: 'install' as const, waiting: false }
    const waiting = { label: 'Codex', kind: 'update' as const, waiting: true }
    expect(describeAgentOperations([updating], 'quit')).toBe(
      'Claude Code is being updated. Quitting will stop it.',
    )
    expect(describeAgentOperations([installing, waiting], 'update')).toBe(
      'OpenCode is being installed and Codex is waiting to be updated. Restarting will stop them.',
    )
    expect(describeQuit(0, 'quit', [updating])).toBe(
      'Claude Code is being updated. Quitting will stop it.',
    )
    expect(describeQuit(2, 'quit', [updating])).toBe(
      'Claude Code is being updated. Quitting will stop it. ' +
        '2 sessions are still running. Quitting will end them.',
    )
    expect(describeQuit(1, 'update', [])).toBe(
      '1 session is still running. Restarting will end it.',
    )
    expect(quitConfirmationLabel(0, 'quit')).toBe('Stop and Quit')
    expect(quitConfirmationLabel(0, 'update')).toBe('Stop and Restart')
  })
})

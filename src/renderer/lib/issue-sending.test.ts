import { describe, expect, it } from 'vitest'
import type { ToolsState } from '../../shared/ipc'
import { getTool } from '../../shared/tools'
import { sendBlockers } from './issue-sending'
import { toolStatus } from './tool-status'

/** The tools state once a detection has found Claude Code, or has not. */
function detected(claude: boolean): ToolsState {
  return {
    detecting: false,
    tools: [
      { id: 'claude', available: claude, path: claude ? '/bin/claude' : null },
      { id: 'codex', available: false, path: null },
      { id: 'opencode', available: true, path: '/bin/opencode' },
      { id: 'shell', available: true, path: '/bin/zsh' },
    ],
    error: null,
  }
}

const firstDetection: ToolsState = { detecting: true, tools: [], error: null }

describe('toolStatus', () => {
  it('says a tool is being checked for until the first detection has found it or not', () => {
    expect(toolStatus(firstDetection, getTool('claude'))).toBe('checking')
    expect(toolStatus(detected(true), getTool('claude'))).toBe('available')
    expect(toolStatus(detected(false), getTool('claude'))).toBe('not-installed')
    // Detecting again leaves the last result standing.
    expect(toolStatus({ ...detected(false), detecting: true }, getTool('claude'))).toBe(
      'not-installed',
    )
  })

  it('always has the shell available', () => {
    expect(toolStatus(firstDetection, getTool('shell'))).toBe('available')
  })
})

describe('sendBlockers', () => {
  const short = { title: 'Fix the login bug', description: 'Steps' }
  const longest = { title: 'T', description: `${'a'.repeat(99_997)}😀` }
  const tooLong = { title: 'T', description: `${'a'.repeat(99_997)}😀a` }

  it('has none once Claude Code is found, for an issue up to 100,000 code units long', () => {
    expect(sendBlockers(detected(true), short)).toEqual([])
    expect(sendBlockers(detected(true), longest)).toEqual([])
  })

  it('lists every reason that holds', () => {
    expect(sendBlockers(firstDetection, short)).toEqual(['checking'])
    expect(sendBlockers(detected(false), short)).toEqual(['not-installed'])
    expect(sendBlockers(detected(true), tooLong)).toEqual(['too-long'])
    expect(sendBlockers(detected(false), tooLong)).toEqual(['not-installed', 'too-long'])
    expect(sendBlockers(firstDetection, tooLong)).toEqual(['checking', 'too-long'])
  })
})

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
  it('has none once Claude Code is found', () => {
    expect(sendBlockers(detected(true))).toEqual([])
  })

  it('says Claude Code is still being checked for, or is not installed', () => {
    expect(sendBlockers(firstDetection)).toEqual(['checking'])
    expect(sendBlockers(detected(false))).toEqual(['not-installed'])
  })
})

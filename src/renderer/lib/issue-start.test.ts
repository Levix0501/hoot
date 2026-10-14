import { describe, expect, it } from 'vitest'
import type { ToolsState } from '../../shared/ipc'
import { getTool } from '../../shared/tools'
import { startBlockers, startState } from './issue-start'
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

describe('startBlockers', () => {
  const inProject = { projectId: 1 }
  const withoutProject = { projectId: null }

  it('has none once Claude Code is found, for an issue in a project', () => {
    expect(startBlockers(detected(true), inProject)).toEqual([])
  })

  it('says Claude Code is still being checked for, or is not installed', () => {
    expect(startBlockers(firstDetection, inProject)).toEqual(['checking'])
    expect(startBlockers(detected(false), inProject)).toEqual(['not-installed'])
  })

  it('says an issue without a project has none to create its worktree in', () => {
    expect(startBlockers(detected(true), withoutProject)).toEqual(['no-project'])
    expect(startBlockers(detected(false), withoutProject)).toEqual(['not-installed', 'no-project'])
    expect(startBlockers(firstDetection, withoutProject)).toEqual(['checking', 'no-project'])
  })
})

describe('startState', () => {
  const inProject = { projectId: 1 }
  const worktreePath = '/home/.hoot/worktrees/gamma/iss-1-fix'

  it('shows the session started from the issue, whatever else holds', () => {
    for (const tools of [firstDetection, detected(false), detected(true)]) {
      for (const issue of [inProject, { projectId: null }]) {
        expect(startState(issue, { sessionId: 's1', tools, worktreePath: null })).toEqual({
          kind: 'show',
          sessionId: 's1',
        })
      }
    }
  })

  it('cannot start without Claude Code or a project, also when the issue has a worktree', () => {
    expect(
      startState(inProject, { sessionId: null, tools: detected(false), worktreePath }),
    ).toEqual({ kind: 'blocked', blockers: ['not-installed'] })
    expect(
      startState({ projectId: null }, { sessionId: null, tools: firstDetection, worktreePath }),
    ).toEqual({ kind: 'blocked', blockers: ['checking', 'no-project'] })
  })

  it("starts in the issue's worktree when it has one, and in a new one otherwise", () => {
    expect(startState(inProject, { sessionId: null, tools: detected(true), worktreePath })).toEqual(
      { kind: 'worktree', worktreePath },
    )
    expect(
      startState(inProject, { sessionId: null, tools: detected(true), worktreePath: null }),
    ).toEqual({ kind: 'new-worktree' })
  })
})

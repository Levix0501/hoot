import { describe, expect, it } from 'vitest'
import { BUILT_IN_WORKFLOW } from '../../shared/built-in-workflow'
import type { ToolsState } from '../../shared/ipc'
import { getTool } from '../../shared/tools'
import type { WorkflowProgress } from '../../shared/workflows'
import { startBlockers, startHint, startState } from './issue-start'
import { toolStatus } from './tool-status'

const notStarted: WorkflowProgress = { kind: 'not-started' }
const atDesign: WorkflowProgress = { kind: 'at-step', step: 'design', run: 2, startedAt: 0 }
const finished: WorkflowProgress = { kind: 'finished' }

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
    expect(startBlockers(detected(true), inProject, notStarted)).toEqual([])
    expect(startBlockers(detected(true), inProject, atDesign)).toEqual([])
  })

  it('says Claude Code is still being checked for, or is not installed', () => {
    expect(startBlockers(firstDetection, inProject, notStarted)).toEqual(['checking'])
    expect(startBlockers(detected(false), inProject, notStarted)).toEqual(['not-installed'])
  })

  it('says an issue without a project has none to create its worktree in', () => {
    expect(startBlockers(detected(true), withoutProject, notStarted)).toEqual(['no-project'])
    expect(startBlockers(detected(false), withoutProject, notStarted)).toEqual([
      'not-installed',
      'no-project',
    ])
    expect(startBlockers(firstDetection, withoutProject, notStarted)).toEqual([
      'checking',
      'no-project',
    ])
  })

  it('says the workflow is finished, besides any other reason', () => {
    expect(startBlockers(detected(true), inProject, finished)).toEqual(['finished'])
    expect(startBlockers(firstDetection, withoutProject, finished)).toEqual([
      'checking',
      'no-project',
      'finished',
    ])
  })
})

describe('startState', () => {
  const inProject = { projectId: 1 }
  const worktreePath = '/home/.hoot/worktrees/gamma/iss-1-fix'

  it('shows the session started from the issue, whatever else holds', () => {
    for (const tools of [firstDetection, detected(false), detected(true)]) {
      for (const issue of [inProject, { projectId: null }]) {
        for (const progress of [notStarted, atDesign, finished]) {
          expect(
            startState(issue, { sessionId: 's1', tools, worktreePath: null, progress }),
          ).toEqual({ kind: 'show', sessionId: 's1' })
        }
      }
    }
  })

  it('cannot start without Claude Code or a project, also when the issue has a worktree', () => {
    const progress = notStarted
    expect(
      startState(inProject, { sessionId: null, tools: detected(false), worktreePath, progress }),
    ).toEqual({ kind: 'blocked', blockers: ['not-installed'] })
    expect(
      startState(
        { projectId: null },
        { sessionId: null, tools: firstDetection, worktreePath, progress },
      ),
    ).toEqual({ kind: 'blocked', blockers: ['checking', 'no-project'] })
  })

  it('cannot start once the workflow is finished', () => {
    expect(
      startState(inProject, {
        sessionId: null,
        tools: detected(true),
        worktreePath,
        progress: finished,
      }),
    ).toEqual({ kind: 'blocked', blockers: ['finished'] })
  })

  it("starts in the issue's worktree when it has one, and in a new one otherwise", () => {
    for (const progress of [notStarted, atDesign]) {
      expect(
        startState(inProject, { sessionId: null, tools: detected(true), worktreePath, progress }),
      ).toEqual({ kind: 'worktree', worktreePath })
      expect(
        startState(inProject, {
          sessionId: null,
          tools: detected(true),
          worktreePath: null,
          progress,
        }),
      ).toEqual({ kind: 'new-worktree' })
    }
  })
})

describe('startHint', () => {
  const worktree = { kind: 'worktree', worktreePath: '/w' } as const
  const newWorktree = { kind: 'new-worktree' } as const

  it('says that it shows the session started from the issue', () => {
    for (const progress of [notStarted, atDesign, finished]) {
      expect(startHint({ kind: 'show', sessionId: 's1' }, progress, BUILT_IN_WORKFLOW)).toBe(
        'Show the Claude Code session started from this issue',
      )
    }
  })

  it("starts the workflow's first step, in the issue's worktree or a new one", () => {
    expect(startHint(worktree, notStarted, BUILT_IN_WORKFLOW)).toBe(
      "Start Scope with Claude Code in this issue's worktree",
    )
    expect(startHint(newWorktree, notStarted, BUILT_IN_WORKFLOW)).toBe(
      'Start Scope with Claude Code in a new worktree',
    )
  })

  it('continues the step the issue is at, by its name in the workflow', () => {
    expect(startHint(worktree, atDesign, BUILT_IN_WORKFLOW)).toBe(
      "Continue Design with Claude Code in this issue's worktree",
    )
    const implement: WorkflowProgress = { kind: 'at-step', step: 'implement', run: 5, startedAt: 0 }
    expect(startHint(newWorktree, implement, BUILT_IN_WORKFLOW)).toBe(
      'Continue Implement with Claude Code in a new worktree',
    )
    const renamed = {
      name: 'Other',
      steps: [{ ...BUILT_IN_WORKFLOW.steps[0]!, id: 'look', name: 'Look', outcomes: [] }],
    }
    expect(startHint(worktree, notStarted, renamed)).toBe(
      "Start Look with Claude Code in this issue's worktree",
    )
  })
})

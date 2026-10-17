import { describe, expect, it } from 'vitest'
import { BUILT_IN_WORKFLOW } from './built-in-workflow'
import type { ToolsState } from './ipc'
import { startBlockers, startBlockerText } from './start-blockers'
import { toolStatus } from './tool-status'
import { getTool } from './tools'
import type { WorkflowProgress } from './workflows'

const notStarted: WorkflowProgress = { kind: 'not-started' }
const atTriage: WorkflowProgress = { kind: 'at-step', step: BUILT_IN_WORKFLOW.steps[0]! }
const split: WorkflowProgress = { kind: 'finished', label: BUILT_IN_WORKFLOW.endLabels[1]! }

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

  it('has none once Claude Code is found, for an issue in a project that waits on nothing', () => {
    expect(startBlockers(detected(true), inProject, [], notStarted)).toEqual([])
    expect(startBlockers(detected(true), inProject, [], atTriage)).toEqual([])
  })

  it('says Claude Code is still being checked for, or is not installed', () => {
    expect(startBlockers(firstDetection, inProject, [], notStarted)).toEqual([{ kind: 'checking' }])
    expect(startBlockers(detected(false), inProject, [], notStarted)).toEqual([
      { kind: 'not-installed' },
    ])
  })

  it('says an issue without a project has none to create its worktree in', () => {
    expect(startBlockers(detected(true), withoutProject, [], notStarted)).toEqual([
      { kind: 'no-project' },
    ])
  })

  it('lists the issues it waits on, and the end label of a finished workflow, besides any other reason', () => {
    expect(startBlockers(detected(true), inProject, [3, 2], notStarted)).toEqual([
      { kind: 'waiting', issueIds: [3, 2] },
    ])
    expect(startBlockers(detected(true), inProject, [], split)).toEqual([
      { kind: 'finished', label: 'waiting on sub-issues' },
    ])
    expect(startBlockers(firstDetection, withoutProject, [4], split)).toEqual([
      { kind: 'checking' },
      { kind: 'no-project' },
      { kind: 'waiting', issueIds: [4] },
      { kind: 'finished', label: 'waiting on sub-issues' },
    ])
  })
})

describe('startBlockerText', () => {
  it('says each reason, naming the issues waited on', () => {
    expect(startBlockerText({ kind: 'checking' })).toBe(
      'Hoot is still checking whether Claude Code is installed.',
    )
    expect(startBlockerText({ kind: 'not-installed' })).toMatch(/^Claude Code is not installed/)
    expect(startBlockerText({ kind: 'no-project' })).toMatch(/^It has no project/)
    expect(startBlockerText({ kind: 'waiting', issueIds: [3] })).toBe(
      'It waits on ISS-3, which is neither done nor canceled.',
    )
    expect(startBlockerText({ kind: 'waiting', issueIds: [3, 4, 5] })).toBe(
      'It waits on ISS-3, ISS-4, and ISS-5, which are neither done nor canceled.',
    )
    expect(startBlockerText({ kind: 'finished', label: 'waiting on sub-issues' })).toBe(
      'Its workflow is finished: it has the label "waiting on sub-issues".',
    )
  })
})

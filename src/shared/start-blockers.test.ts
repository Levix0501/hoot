import { describe, expect, it } from 'vitest'
import { BUILT_IN_WORKFLOW } from './built-in-workflow'
import type { ToolsState } from './ipc'
import { startBlockers, startBlockerText } from './start-blockers'
import { toolStatus } from './tool-status'
import { getTool } from './tools'
import type { WorkflowProgress } from './workflows'

const notStarted: WorkflowProgress = { kind: 'not-started' }
const atTriage: WorkflowProgress = { kind: 'at-step', step: BUILT_IN_WORKFLOW.steps[0]! }
const readyToDesign: WorkflowProgress = { kind: 'ready', step: BUILT_IN_WORKFLOW.steps[1]! }
const split: WorkflowProgress = { kind: 'finished', label: BUILT_IN_WORKFLOW.endLabels[0]! }

/**
 * The tools state once a detection has found Claude Code, reporting
 * `version`, or has not.
 */
function detected(claude: boolean, version: string | null = '2.1.331'): ToolsState {
  return {
    detecting: false,
    tools: [
      {
        id: 'claude',
        available: claude,
        path: claude ? '/bin/claude' : null,
        version: claude ? version : null,
      },
      { id: 'codex', available: false, path: null, version: null },
      { id: 'opencode', available: true, path: '/bin/opencode', version: '2.4.2' },
      { id: 'shell', available: true, path: '/bin/zsh', version: null },
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

  it('says a coding tool older than the oldest version Hoot works with is outdated', () => {
    expect(toolStatus(detected(true, '2.1.294'), getTool('claude'))).toBe('outdated')
    expect(toolStatus(detected(true, '2.1.295'), getTool('claude'))).toBe('available')
    expect(toolStatus(detected(true, '2.1.300-beta.1'), getTool('claude'))).toBe('available')
    // One whose version could not be read is taken to be new enough.
    expect(toolStatus(detected(true, null), getTool('claude'))).toBe('available')
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
    expect(startBlockers(detected(true), inProject, [], readyToDesign)).toEqual([])
  })

  it('says Claude Code is still being checked for, is not installed, or is too old', () => {
    expect(startBlockers(firstDetection, inProject, [], notStarted)).toEqual([{ kind: 'checking' }])
    expect(startBlockers(detected(false), inProject, [], notStarted)).toEqual([
      { kind: 'not-installed' },
    ])
    expect(startBlockers(detected(true, '2.1.200'), inProject, [], notStarted)).toEqual([
      { kind: 'outdated' },
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
    expect(startBlockerText({ kind: 'outdated' })).toBe(
      'Hoot needs Claude Code 2.1.295 or later: update it in the Agents page.',
    )
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

import { describe, expect, it } from 'vitest'
import {
  defaultPermissionLevel,
  findPermissionLevel,
  PERMISSION_LEVELS,
  permissionLevelOrDefault,
} from './permission-levels'
import { CODING_TOOL_IDS } from './tools'

const levels = (tool: keyof typeof PERMISSION_LEVELS) =>
  PERMISSION_LEVELS[tool].map((level) => [level.label, level.args])

describe('permission levels', () => {
  it('gives Claude Code its five permission modes', () => {
    expect(levels('claude')).toEqual([
      ['Bypass permissions', ['--dangerously-skip-permissions']],
      ['Auto', ['--permission-mode', 'auto']],
      ['Accept edits', ['--permission-mode', 'acceptEdits']],
      ['Plan', ['--permission-mode', 'plan']],
      ['Manual', ['--permission-mode', 'manual']],
    ])
  })

  it('gives Codex its three permission presets', () => {
    expect(levels('codex')).toEqual([
      ['Full Access', ['--dangerously-bypass-approvals-and-sandbox']],
      ['Default', ['--sandbox', 'workspace-write', '--ask-for-approval', 'on-request']],
      ['Read Only', ['--sandbox', 'read-only', '--ask-for-approval', 'on-request']],
    ])
  })

  it('gives OpenCode auto-approval and its standard permissions', () => {
    expect(levels('opencode')).toEqual([
      ['Auto-approve', ['--auto']],
      ['Standard', []],
    ])
  })

  it('defaults every coding tool to its highest level', () => {
    expect(CODING_TOOL_IDS.map((tool) => defaultPermissionLevel(tool).label)).toEqual([
      'Bypass permissions',
      'Full Access',
      'Auto-approve',
    ])
  })

  it('uses ids that are unique within each tool', () => {
    const duplicates = CODING_TOOL_IDS.filter((tool) => {
      const ids = PERMISSION_LEVELS[tool].map((level) => level.id)
      return new Set(ids).size !== ids.length
    })
    expect(duplicates).toEqual([])
  })

  it('finds a level by id and falls back to the highest level for anything else', () => {
    expect(findPermissionLevel('codex', 'read-only')?.label).toBe('Read Only')
    expect(findPermissionLevel('codex', 'plan')).toBeUndefined()
    expect(findPermissionLevel('claude', 3)).toBeUndefined()
    expect(permissionLevelOrDefault('claude', 'plan').label).toBe('Plan')
    expect(permissionLevelOrDefault('claude', 'read-only').label).toBe('Bypass permissions')
    expect(permissionLevelOrDefault('opencode', undefined).label).toBe('Auto-approve')
  })
})

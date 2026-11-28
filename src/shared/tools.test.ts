import { describe, expect, it } from 'vitest'
import {
  CODING_TOOL_IDS,
  CODING_TOOLS,
  getCodingTool,
  normalizeHarnessOrder,
  orderedCodingTools,
  reorderHarnesses,
  TOOL_IDS,
  TOOLS,
} from './tools'

describe('tools', () => {
  it('defines the five tools with their commands', () => {
    expect(TOOLS.map((tool) => [tool.id, tool.label, tool.command])).toEqual([
      ['claude', 'Claude Code', 'claude'],
      ['codex', 'Codex', 'codex'],
      ['opencode', 'OpenCode', 'opencode'],
      ['antigravity', 'Antigravity CLI', 'agy'],
      ['shell', 'Terminal', null],
    ])
  })

  it('names the npm package each coding tool comes in, and whether Hoot can pick its version', () => {
    expect(CODING_TOOLS.map((tool) => [tool.id, tool.npmPackage, tool.versions])).toEqual([
      ['claude', '@anthropic-ai/claude-code', true],
      ['codex', '@openai/codex', true],
      ['opencode', '@opencode/cli', true],
      ['antigravity', null, false],
    ])
    expect(getCodingTool('codex').npmPackage).toBe('@openai/codex')
    expect(() => getCodingTool('shell' as never)).toThrow(/Unknown coding tool/)
  })

  it('works with each coding tool from the first version that reports its status', () => {
    expect(CODING_TOOLS.map((tool) => [tool.id, tool.minimumVersion])).toEqual([
      ['claude', '2.1.295'],
      ['codex', '0.163.0'],
      ['opencode', '2.1.0'],
      ['antigravity', '1.4.0'],
    ])
  })

  it('lists every tool id once', () => {
    expect(TOOLS.map((tool) => tool.id)).toEqual([...TOOL_IDS])
  })

  it('treats every tool except the shell as a coding tool', () => {
    expect([...CODING_TOOL_IDS]).toEqual(['claude', 'codex', 'opencode', 'antigravity'])
    expect(TOOLS.filter((tool) => tool.command !== null).map((tool) => tool.id)).toEqual([
      ...CODING_TOOL_IDS,
    ])
  })

  it('normalizes any harness order to every coding tool once', () => {
    expect(normalizeHarnessOrder()).toEqual(['claude', 'codex', 'opencode', 'antigravity'])
    expect(normalizeHarnessOrder(null)).toEqual(['claude', 'codex', 'opencode', 'antigravity'])
    expect(normalizeHarnessOrder(['codex', 'antigravity'])).toEqual([
      'codex',
      'antigravity',
      'claude',
      'opencode',
    ])
    expect(normalizeHarnessOrder(['opencode', 'unknown', 42, 'opencode', 'claude'])).toEqual([
      'opencode',
      'claude',
      'codex',
      'antigravity',
    ])
    expect(orderedCodingTools(['antigravity', 'codex']).map((tool) => tool.id)).toEqual([
      'antigravity',
      'codex',
      'claude',
      'opencode',
    ])
  })

  it('reorders a subset of harnesses while keeping other harnesses in place', () => {
    // Only claude, opencode and antigravity are installed; codex stays at index 1.
    expect(
      reorderHarnesses(
        ['claude', 'codex', 'opencode', 'antigravity'],
        ['antigravity', 'claude', 'opencode'],
      ),
    ).toEqual(['antigravity', 'codex', 'claude', 'opencode'])
    // Reordering all harnesses replaces the full order.
    expect(
      reorderHarnesses(
        ['claude', 'codex', 'opencode', 'antigravity'],
        ['codex', 'opencode', 'antigravity', 'claude'],
      ),
    ).toEqual(['codex', 'opencode', 'antigravity', 'claude'])
  })
})

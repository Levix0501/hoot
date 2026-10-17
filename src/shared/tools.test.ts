import { describe, expect, it } from 'vitest'
import { CODING_TOOL_IDS, CODING_TOOLS, getCodingTool, getTool, TOOL_IDS, TOOLS } from './tools'

describe('tools', () => {
  it('defines the four tools with their commands', () => {
    expect(TOOLS.map((tool) => [tool.id, tool.label, tool.command])).toEqual([
      ['claude', 'Claude Code', 'claude'],
      ['codex', 'Codex', 'codex'],
      ['opencode', 'OpenCode', 'opencode'],
      ['shell', 'Shell', null],
    ])
  })

  it('gives an install command for every tool that can be missing', () => {
    const installable = TOOLS.filter((tool) => tool.command !== null)
    expect(installable.map((tool) => tool.installCommand)).toEqual([
      'npm install -g @anthropic-ai/claude-code',
      'npm install -g @openai/codex',
      'npm install -g @opencode/cli',
    ])
    expect(getTool('opencode').installCommand).toBe('npm install -g @opencode/cli')
  })

  it('names the npm package each coding tool comes in', () => {
    expect(CODING_TOOLS.map((tool) => [tool.id, tool.npmPackage])).toEqual([
      ['claude', '@anthropic-ai/claude-code'],
      ['codex', '@openai/codex'],
      ['opencode', '@opencode/cli'],
    ])
    expect(getCodingTool('codex').npmPackage).toBe('@openai/codex')
    expect(() => getCodingTool('shell' as never)).toThrow(/Unknown coding tool/)
  })

  it('lists every tool id once', () => {
    expect(TOOLS.map((tool) => tool.id)).toEqual([...TOOL_IDS])
  })

  it('treats every tool except the shell as a coding tool', () => {
    expect([...CODING_TOOL_IDS]).toEqual(['claude', 'codex', 'opencode'])
    expect(TOOLS.filter((tool) => tool.command !== null).map((tool) => tool.id)).toEqual([
      ...CODING_TOOL_IDS,
    ])
  })
})

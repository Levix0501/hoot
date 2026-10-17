/** Tools that run an agent CLI; each has permission levels. */
export const CODING_TOOL_IDS = ['claude', 'codex', 'opencode'] as const

export const TOOL_IDS = [...CODING_TOOL_IDS, 'shell'] as const

export type CodingToolId = (typeof CODING_TOOL_IDS)[number]

export type ToolId = (typeof TOOL_IDS)[number]

export interface CodingToolDefinition {
  id: CodingToolId
  label: string
  /** Command looked up in the login shell PATH. */
  command: string
  /** The npm package the tool comes in, which Hoot installs and updates. */
  npmPackage: string
  /** Shown next to the tool when it is not available, where Hoot does not install it. */
  installCommand: string
}

export interface ShellToolDefinition {
  id: 'shell'
  label: string
  /** The user's default shell runs instead of a command. */
  command: null
  npmPackage: null
  installCommand: null
}

export type ToolDefinition = CodingToolDefinition | ShellToolDefinition

export const TOOLS: readonly ToolDefinition[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    command: 'claude',
    npmPackage: '@anthropic-ai/claude-code',
    installCommand: 'npm install -g @anthropic-ai/claude-code',
  },
  {
    id: 'codex',
    label: 'Codex',
    command: 'codex',
    npmPackage: '@openai/codex',
    installCommand: 'npm install -g @openai/codex',
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    command: 'opencode',
    npmPackage: '@opencode/cli',
    installCommand: 'npm install -g @opencode/cli',
  },
  {
    id: 'shell',
    label: 'Shell',
    command: null,
    npmPackage: null,
    installCommand: null,
  },
]

export function getTool(id: ToolId): ToolDefinition {
  const tool = TOOLS.find((candidate) => candidate.id === id)
  if (!tool) throw new Error(`Unknown tool: ${id}`)
  return tool
}

/** The coding tools, which run an agent: Claude Code, Codex and OpenCode, in this order. */
export const CODING_TOOLS: readonly CodingToolDefinition[] = TOOLS.filter(
  (tool): tool is CodingToolDefinition => tool.command !== null,
)

export function getCodingTool(id: CodingToolId): CodingToolDefinition {
  const tool = CODING_TOOLS.find((candidate) => candidate.id === id)
  if (!tool) throw new Error(`Unknown coding tool: ${id}`)
  return tool
}

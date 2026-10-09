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
  /** Shown next to the tool when it is not available. */
  installCommand: string
}

export interface ShellToolDefinition {
  id: 'shell'
  label: string
  /** The user's default shell runs instead of a command. */
  command: null
  installCommand: null
}

export type ToolDefinition = CodingToolDefinition | ShellToolDefinition

export const TOOLS: readonly ToolDefinition[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    command: 'claude',
    installCommand: 'npm install -g @anthropic-ai/claude-code',
  },
  {
    id: 'codex',
    label: 'Codex',
    command: 'codex',
    installCommand: 'npm install -g @openai/codex',
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    command: 'opencode',
    installCommand: 'npm install -g opencode-ai',
  },
  {
    id: 'shell',
    label: 'Shell',
    command: null,
    installCommand: null,
  },
]

export function getTool(id: ToolId): ToolDefinition {
  const tool = TOOLS.find((candidate) => candidate.id === id)
  if (!tool) throw new Error(`Unknown tool: ${id}`)
  return tool
}

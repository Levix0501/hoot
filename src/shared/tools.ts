/** Tools that run an agent CLI. */
export const CODING_TOOL_IDS = ['claude', 'codex', 'opencode', 'antigravity'] as const

export const TOOL_IDS = [...CODING_TOOL_IDS, 'shell'] as const

export type CodingToolId = (typeof CODING_TOOL_IDS)[number]

export type ToolId = (typeof TOOL_IDS)[number]

export interface CodingToolDefinition {
  id: CodingToolId
  label: string
  /** Command looked up in the login shell PATH. */
  command: string
  /**
   * The npm package the tool comes in, which Hoot can install and update it
   * with; `null` for one that comes in none.
   */
  npmPackage: string | null
  /**
   * Whether Hoot can install any of its versions, not only its latest, and
   * so keep it on one.
   */
  versions: boolean
  /**
   * The oldest version Hoot works with: the first that reports its status
   * over OSC 7501, which its sessions' lights follow (see `program-status.ts`
   * in the renderer). An older one starts no session until it is updated.
   */
  minimumVersion: string
}

export interface ShellToolDefinition {
  id: 'shell'
  label: string
  /** The user's default shell runs instead of a command. */
  command: null
  npmPackage: null
  versions: false
}

export type ToolDefinition = CodingToolDefinition | ShellToolDefinition

export const TOOLS: readonly ToolDefinition[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    command: 'claude',
    npmPackage: '@anthropic-ai/claude-code',
    versions: true,
    minimumVersion: '2.1.295',
  },
  {
    id: 'codex',
    label: 'Codex',
    command: 'codex',
    npmPackage: '@openai/codex',
    versions: true,
    minimumVersion: '0.163.0',
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    command: 'opencode',
    npmPackage: '@opencode/cli',
    versions: true,
    minimumVersion: '2.1.0',
  },
  {
    // Only its latest version can be installed: its installer and its own
    // `agy update` take no other.
    id: 'antigravity',
    label: 'Antigravity CLI',
    command: 'agy',
    npmPackage: null,
    versions: false,
    minimumVersion: '1.4.0',
  },
  {
    id: 'shell',
    label: 'Terminal',
    command: null,
    npmPackage: null,
    versions: false,
  },
]

export function getTool(id: ToolId): ToolDefinition {
  const tool = TOOLS.find((candidate) => candidate.id === id)
  if (!tool) throw new Error(`Unknown tool: ${id}`)
  return tool
}

/**
 * The coding tools, which run an agent: Claude Code, Codex, OpenCode and
 * Antigravity CLI, in this order.
 */
export const CODING_TOOLS: readonly CodingToolDefinition[] = TOOLS.filter(
  (tool): tool is CodingToolDefinition => tool.command !== null,
)

export function getCodingTool(id: CodingToolId): CodingToolDefinition {
  const tool = CODING_TOOLS.find((candidate) => candidate.id === id)
  if (!tool) throw new Error(`Unknown coding tool: ${id}`)
  return tool
}
